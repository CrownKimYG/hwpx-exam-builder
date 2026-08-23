import JSZip from "jszip";

const FIELD_TYPE = "CLICK_HERE";

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) => Array.from(element.getElementsByTagNameNS("*", name));
const allDescendants = (element) => Array.from(element.getElementsByTagNameNS("*", "*"));

function parseXml(xml, label) {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  const error = documentNode.querySelector("parsererror");
  if (error) throw new Error(`${label} XML을 읽지 못했습니다.`);
  return documentNode;
}

function closestNamedAncestor(node, name) {
  let current = node?.parentElement;
  while (current && localName(current) !== name) current = current.parentElement;
  return current;
}

function fieldRange(paragraph, beginNode) {
  const beginId = beginNode.getAttribute("id");
  const ordered = allDescendants(paragraph);
  const beginIndex = ordered.indexOf(beginNode);
  const endIndex = ordered.findIndex((node, index) => (
    index > beginIndex
    && localName(node) === "fieldEnd"
    && (!beginId || node.getAttribute("beginIDRef") === beginId)
  ));
  const between = beginIndex >= 0 && endIndex > beginIndex
    ? ordered.slice(beginIndex + 1, endIndex)
    : [];
  const previousTextNode = beginIndex > 0
    ? ordered.slice(0, beginIndex).reverse().find((node) => localName(node) === "t") || null
    : null;
  return {
    endNode: endIndex >= 0 ? ordered[endIndex] : null,
    previousTextNode,
    textNodes: between.filter((node) => localName(node) === "t"),
  };
}

function fieldTextFromParagraph(paragraph, beginNode) {
  const { textNodes } = fieldRange(paragraph, beginNode);
  const visible = textNodes.map((node) => node.textContent || "").join("").trim();
  if (visible) return visible;
  const direction = descendants(beginNode, "stringParam")
    .find((node) => node.getAttribute("name") === "Direction");
  return (direction?.textContent || "").trim();
}

function ensureFieldTextNode(paragraph, beginNode, endNode) {
  const beginRun = closestNamedAncestor(beginNode, "run");
  const endRun = closestNamedAncestor(endNode, "run");
  if (!beginRun || !endRun || beginRun.parentNode !== endRun.parentNode) return null;
  const run = beginRun.cloneNode(false);
  const prefix = beginRun.prefix || "hp";
  const text = paragraph.ownerDocument.createElementNS(beginRun.namespaceURI, `${prefix}:t`);
  run.appendChild(text);
  endRun.parentNode.insertBefore(run, endRun);
  return text;
}

function flattenField(beginNode, endNode) {
  const beginControl = closestNamedAncestor(beginNode, "ctrl");
  const endControl = closestNamedAncestor(endNode, "ctrl");
  beginControl?.remove();
  if (endControl && endControl !== beginControl) endControl.remove();
}

export async function inspectTemplateFields(data) {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const sectionNames = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort();
  const grouped = new Map();

  for (const sectionName of sectionNames) {
    const documentNode = parseXml(await zip.file(sectionName).async("string"), sectionName);
    for (const begin of descendants(documentNode.documentElement, "fieldBegin")) {
      if (begin.getAttribute("type") !== FIELD_TYPE) continue;
      const name = (begin.getAttribute("name") || "").trim();
      if (!name) continue;
      let paragraph = begin.parentElement;
      while (paragraph && localName(paragraph) !== "p") paragraph = paragraph.parentElement;
      const placeholder = paragraph ? fieldTextFromParagraph(paragraph, begin) : "";
      if (!grouped.has(name)) grouped.set(name, { name, placeholder, count: 0 });
      grouped.get(name).count += 1;
    }
  }

  return [...grouped.values()];
}

function applyFieldsInParagraph(paragraph, values) {
  descendants(paragraph, "fieldBegin")
    .filter((node) => node.getAttribute("type") === FIELD_TYPE)
    .forEach((beginNode) => {
      const name = (beginNode.getAttribute("name") || "").trim();
      if (!Object.prototype.hasOwnProperty.call(values, name)) return;
      const value = String(values[name] ?? "");
      const range = fieldRange(paragraph, beginNode);
      const existingText = range.textNodes.find((text) => (text.textContent || "").trim());
      const firstText = existingText
        || ((range.previousTextNode?.textContent || "").trim() ? range.previousTextNode : null)
        || range.textNodes[0]
        || ensureFieldTextNode(paragraph, beginNode, range.endNode);
      if (!firstText) throw new Error(`${name} 누름틀의 입력 영역을 찾지 못했습니다.`);
      firstText.textContent = value;
      range.textNodes.forEach((text) => {
        if (text !== firstText) text.textContent = "";
      });
      flattenField(beginNode, range.endNode);
    });
}

async function repackHwpx(zip, overrides) {
  const output = new JSZip();
  const mimetypeEntry = zip.file("mimetype");
  if (!mimetypeEntry) throw new Error("HWPX mimetype 항목을 찾을 수 없습니다.");

  output.file("mimetype", await mimetypeEntry.async("uint8array"), {
    binary: true,
    compression: "STORE",
  });

  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name === "mimetype") continue;
    const replacement = overrides.get(entry.name);
    const content = replacement ?? await entry.async("uint8array");
    output.file(entry.name, content, {
      binary: replacement == null,
      compression: "DEFLATE",
      date: entry.date,
    });
  }

  return output.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.hancom.hwpx",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function applyTemplateFieldValues(data, values) {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const overrides = new Map();
  const sectionNames = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort();

  for (const sectionName of sectionNames) {
    const documentNode = parseXml(await zip.file(sectionName).async("string"), sectionName);
    descendants(documentNode.documentElement, "p").forEach((paragraph) => applyFieldsInParagraph(paragraph, values));
    overrides.set(sectionName, new XMLSerializer().serializeToString(documentNode));
  }

  return repackHwpx(zip, overrides);
}
