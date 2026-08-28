// HWPUNITs, not screen pixels. Resolve widths after insertion so that template
// columns and enclosing template cells (rather than the source page) win.
const name = (node) => node.localName || node.nodeName.split(":").pop();
const children = (node, tag) => [...(node?.children || [])].filter((child) => !tag || name(child) === tag);
const child = (node, tag) => children(node, tag)[0];
const descendants = (node, tag) => [...node.getElementsByTagNameNS("*", tag)];
const number = (node, attr, fallback = 0) => {
  const raw = node?.getAttribute(attr);
  const value = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const horizontalMargins = (node) => Math.max(0, number(node, "left")) + Math.max(0, number(node, "right"));
const signedInt32 = (value) => value > 0x7fffffff && value <= 0xffffffff ? value - 0x100000000 : value;

// RHWP can serialize negative HWPUNIT shape extents as uint32. Its renderer
// tolerates those values, but Hancom Office Viewer dereferences invalid state
// while opening a package that contains them. Keep IDs and other unsigned
// fields untouched; only current shape geometry is signed in the HWP model.
function normalizeCurrentShapeSize(shape) {
  const current = child(shape, "curSz");
  if (!current) return;
  for (const attribute of ["width", "height"]) {
    const value = number(current, attribute, NaN);
    const normalized = signedInt32(value);
    if (Number.isFinite(normalized) && normalized !== value) {
      current.setAttribute(attribute, String(normalized));
    }
  }
}

export function templateTextWidth({ pageWidth, left = 0, right = 0, gutter = 0, gutterType = "LEFT_ONLY", columnCount = 1, columnGap = 0, columnWidths = [] }) {
  const body = pageWidth - left - right - (gutterType === "TOP_ONLY" ? 0 : gutter);
  if (!Number.isFinite(body) || body <= 0) return null;
  const count = Number.isFinite(columnCount) ? Math.max(1, Math.trunc(columnCount)) : 1;
  // Implicit page/column flow is determined by the editor. On unequal columns,
  // use the narrowest track so an object remains safe whichever track it enters.
  const explicit = columnWidths.filter((width) => Number.isFinite(width) && width > 0);
  const width = count > 1 && explicit.length === count
    ? Math.min(body, ...explicit)
    : (body - Math.max(0, columnGap) * (count - 1)) / count;
  return width >= 1 ? Math.floor(width) : null;
}

/** Resize a table grid by cumulative boundaries, keeping merged cells aligned. */
export function fittedTableCells(cells, columnCount, oldWidth, newWidth, spacing = 0) {
  const count = Math.trunc(columnCount);
  const oldContent = oldWidth - spacing * (count - 1);
  const newContent = newWidth - spacing * (count - 1);
  if (!Number.isFinite(count) || !Number.isFinite(oldContent) || !Number.isFinite(newContent)
    || count < 1 || count > 1000 || oldContent <= 0 || newContent < count) return null;
  const boundaries = Array(count + 1).fill(null);
  boundaries[0] = 0;
  boundaries[count] = oldContent;
  const valid = cells.filter(({ column, span, width }) => Number.isInteger(column) && Number.isInteger(span)
    && column >= 0 && span > 0 && column + span <= count && width > 0);
  for (let pass = 0; pass < count; pass += 1) {
    let changed = false;
    for (const { column, span, width } of valid) {
      const end = column + span;
      const extent = width - spacing * (span - 1);
      if (boundaries[column] != null && boundaries[end] == null) {
        boundaries[end] = boundaries[column] + extent;
        changed = true;
      } else if (boundaries[end] != null && boundaries[column] == null) {
        boundaries[column] = boundaries[end] - extent;
        changed = true;
      }
    }
    if (!changed) break;
  }
  let start = 0;
  for (let end = 1; end <= count; end += 1) {
    if (boundaries[end] == null) continue;
    if (boundaries[end] <= boundaries[start]) return null;
    for (let index = start + 1; index < end; index += 1) {
      boundaries[index] = boundaries[start] + (boundaries[end] - boundaries[start]) * (index - start) / (end - start);
    }
    start = end;
  }
  const scaled = boundaries.map((value) => Math.round(value * newContent / oldContent));
  if (scaled.some((value, index) => index > 0 && value <= scaled[index - 1])) return null;
  return cells.map(({ column, span }) => Number.isInteger(column) && Number.isInteger(span)
    && column >= 0 && span > 0 && column + span <= count
    ? scaled[column + span] - scaled[column] + spacing * (span - 1) : null);
}

function paragraphWidth(paragraph, width, styles) {
  const style = styles.get(paragraph.getAttribute("paraPrIDRef"));
  // Converted files can carry both HWPUNITCHAR and HWPUNIT alternatives.
  const margins = style ? descendants(style, "margin") : [];
  const margin = margins.find((node) => child(node, "left")?.getAttribute("unit") === "HWPUNIT") || margins[0];
  const value = (tag) => Math.max(0, number(child(margin, tag), "value"));
  return Math.max(1, width - value("left") - value("right") - value("intent"));
}

function sizeWidth(object, available) {
  const size = child(object, "sz");
  const width = number(size, "width");
  return size?.getAttribute("widthRelTo") === "ABSOLUTE" ? width
    : number(child(object, "curSz"), "width") || available * width / 10000;
}

function standalone(object) {
  let paragraph = object.parentElement;
  while (paragraph && name(paragraph) !== "p") paragraph = paragraph.parentElement;
  if (!paragraph) return false;
  let otherContent = false;
  const scan = (node) => {
    if (node === object || ["endNote", "footNote", "secPr", "colPr"].includes(name(node))) return;
    if (name(node) === "t" && (node.textContent || "").replace(/^\s*\d+[.)]\s*$/, "").trim()) otherContent = true;
    if (["tbl", "rect", "equation", "pic", "container", "line", "ellipse", "polygon", "curve"].includes(name(node))) otherContent = true;
    children(node).forEach(scan);
  };
  scan(paragraph);
  return !otherContent;
}

function isTextBox(rectangle, available) {
  const drawText = child(rectangle, "drawText");
  if (!drawText || number(rectangle, "groupLevel") > 0 || number(child(rectangle, "rotationInfo"), "angle") !== 0) return false;
  const label = descendants(drawText, "t").map((node) => node.textContent || "").join("").trim();
  // Compact labels such as 풀이 are inline controls, not paragraph frames.
  if (sizeWidth(rectangle, available) < 6000 && label.length < 10 && !descendants(drawText, "equation").length) return false;
  return standalone(rectangle);
}

function alignToText(object) {
  const position = child(object, "pos");
  if (!position) return;
  position.setAttribute("horzOffset", "0");
  position.setAttribute("horzAlign", "LEFT");
  position.setAttribute("horzRelTo", "PARA");
}

function fitRectangle(rectangle, width) {
  const size = child(rectangle, "sz");
  const current = child(rectangle, "curSz");
  const original = child(rectangle, "orgSz");
  const oldWidth = number(current, "width") || number(size, "width");
  if (!size || oldWidth <= 0) return false;
  const factor = width / oldWidth;
  const scale = child(child(rectangle, "renderingInfo"), "scaMatrix");
  if (scale) {
    // Keep original point coordinates and all Y transforms. HWP conversions can
    // serialize negative curSz heights as uint32; do not derive Y from them.
    for (const attr of ["e1", "e2", "e3"]) {
      if (scale.hasAttribute(attr)) scale.setAttribute(attr, String(number(scale, attr) * factor));
    }
  } else if (original) {
    original.setAttribute("width", String(Math.round(number(original, "width") * factor)));
    for (const point of children(rectangle).filter((node) => /^pt[0-3]$/.test(name(node)))) {
      point.setAttribute("x", String(Math.round(number(point, "x") * factor)));
    }
  }
  if (current) current.setAttribute("width", String(width));
  const rotation = child(rectangle, "rotationInfo");
  if (rotation) rotation.setAttribute("centerX", String(Math.round(number(rotation, "centerX") * factor)));
  child(rectangle, "drawText").setAttribute("lastWidth", String(width));
  size.setAttribute("width", String(width));
  size.setAttribute("widthRelTo", "ABSOLUTE");
  alignToText(rectangle);
  return true;
}

function tableCells(table) {
  return children(table, "tr").flatMap((row) => children(row, "tc"));
}

function fitTable(table, width, available) {
  const size = child(table, "sz");
  const cells = tableCells(table);
  const columnCount = number(table, "colCnt");
  // Relative table sizes are percentages of the *destination* column. Cell
  // sizes still describe the source grid, so use its complete first row as
  // the scaling reference instead of resolving that percentage prematurely.
  const firstRow = children(child(table, "tr"), "tc")
    .sort((a, b) => number(child(a, "cellAddr"), "colAddr") - number(child(b, "cellAddr"), "colAddr"));
  let covered = 0;
  let gridWidth = 0;
  for (const cell of firstRow) {
    if (number(child(cell, "cellAddr"), "colAddr", -1) !== covered) break;
    covered += number(child(cell, "cellSpan"), "colSpan", 1);
    gridWidth += number(child(cell, "cellSz"), "width");
  }
  gridWidth += Math.max(0, firstRow.length - 1) * number(table, "cellSpacing");
  const oldWidth = covered === columnCount && gridWidth > 0 ? gridWidth : sizeWidth(table, available);
  const widths = fittedTableCells(cells.map((cell) => ({
    column: number(child(cell, "cellAddr"), "colAddr", -1),
    span: number(child(cell, "cellSpan"), "colSpan", 1),
    width: number(child(cell, "cellSz"), "width"),
  })), columnCount, oldWidth, width, number(table, "cellSpacing"));
  if (!size || !widths || widths.some((value) => value == null)) return false;
  cells.forEach((cell, index) => child(cell, "cellSz").setAttribute("width", String(widths[index])));
  size.setAttribute("width", String(width));
  size.setAttribute("widthRelTo", "ABSOLUTE");
  alignToText(table);
  return true;
}

/** Fit copied objects only; keep the template's own frames and master pages. */
export function fitTemplateObjects(sectionDocuments, headerDocument, copiedRoots) {
  const styles = new Map(descendants(headerDocument, "paraPr").map((style) => [style.getAttribute("id"), style]));
  const visit = (node, containerWidth, copied = false, resizedContainer = false) => {
    copied ||= copiedRoots.has(node);
    const tag = name(node);
    if (["secPr", "colPr", "container", "pic"].includes(tag)) return false;
    const width = tag === "p" ? paragraphWidth(node, containerWidth, styles) : containerWidth;
    let resized = false;
    if (tag === "tbl") {
      const target = Math.floor(width - horizontalMargins(child(node, "outMargin")));
      if (copied && target > 0) resized = fitTable(node, target, width);
      for (const cell of tableCells(node)) {
        const cellSize = number(child(cell, "cellSz"), "width");
        const margin = cell.getAttribute("hasMargin") === "1" ? child(cell, "cellMargin") : child(node, "inMargin");
        const inner = Math.max(1, cellSize - horizontalMargins(margin));
        const list = child(cell, "subList");
        if (list) {
          if (resized) list.setAttribute("textWidth", String(inner));
          visit(list, inner, copied, resized);
        }
      }
      return resized;
    }
    if (tag === "rect") {
      normalizeCurrentShapeSize(node);
      const target = Math.floor(width - horizontalMargins(child(node, "outMargin")));
      if (copied && target > 0 && isTextBox(node, width)) resized = fitRectangle(node, target);
      const drawText = child(node, "drawText");
      const list = child(drawText, "subList");
      if (list) {
        const inner = Math.max(1, sizeWidth(node, width) - horizontalMargins(child(drawText, "textMargin")));
        if (resized) list.setAttribute("textWidth", String(inner));
        visit(list, inner, copied, resized);
      }
      return resized;
    }
    // Paragraph margins belong to their own text list, not to nested notes.
    for (const item of children(node)) resized = visit(item, width, copied, resizedContainer) || resized;
    if (copied && tag === "p" && (resized || resizedContainer)) {
      // Keep vertical metrics and original line breaks, especially tall math.
      for (const segment of children(child(node, "linesegarray"), "lineseg")) {
        segment.setAttribute("horzsize", String(Math.max(1, width - Math.max(0, number(segment, "horzpos")))));
      }
    }
    return resized;
  };

  for (const document of sectionDocuments) {
    let page = null;
    let columns = null;
    // Read only body controls, never a table cell's or note's local controls.
    const controls = (node) => {
      if (["tbl", "rect", "container", "endNote", "footNote", "header", "footer"].includes(name(node))) return;
      if (name(node) === "pagePr") page = node;
      if (name(node) === "colPr") columns = node;
      children(node).forEach(controls);
    };
    for (const paragraph of children(document.documentElement)) {
      controls(paragraph);
      const margin = child(page, "margin");
      const width = templateTextWidth({
        pageWidth: number(page, "width"), left: number(margin, "left"), right: number(margin, "right"),
        gutter: number(margin, "gutter"), gutterType: page?.getAttribute("gutterType"),
        columnCount: number(columns, "colCount", 1), columnGap: number(columns, "sameGap"),
        columnWidths: columns?.getAttribute("sameSz") === "0" ? children(columns, "colSz").map((column) => number(column, "width")) : [],
      });
      // Missing page metadata is not permission to invent an A4 layout.
      if (width) visit(paragraph, width);
    }
  }
}
