import JSZip from "jszip";

const SECTION_RE = /^Contents\/section\d+\.xml$/;
const SLOT_RE = /^#(\d+)$/;
const SEQUENTIAL_MARKER = "{{QUESTIONS}}";
const EXPLANATION_MARKER = "#해설";

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) => Array.from(element.getElementsByTagNameNS("*", name));
const firstDescendant = (element, name) => descendants(element, name)[0] || null;

function parseXml(xml, label) {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  const error = documentNode.querySelector("parsererror");
  if (error) throw new Error(`${label} XML을 읽지 못했습니다.`);
  return documentNode;
}

function textOf(element) {
  return descendants(element, "t").map((node) => node.textContent || "").join("").trim();
}

function paragraphSlot(paragraph) {
  if (localName(paragraph) !== "p") return null;
  const match = textOf(paragraph).match(SLOT_RE);
  if (!match) return null;
  let tableDepth = 0;
  let ancestor = paragraph.parentElement;
  while (ancestor) {
    if (localName(ancestor) === "tbl") tableDepth += 1;
    ancestor = ancestor.parentElement;
  }
  return { number: Number(match[1]), element: paragraph, tableDepth };
}

function findSlots(root) {
  return descendants(root, "p")
    .map((paragraph) => paragraphSlot(paragraph))
    .filter(Boolean);
}

function findSequentialMarkers(root) {
  return descendants(root, "p").filter((paragraph) => textOf(paragraph) === SEQUENTIAL_MARKER);
}

function findExplanationMarkers(root) {
  return descendants(root, "p").filter((paragraph) => textOf(paragraph) === EXPLANATION_MARKER);
}

function canonicalSlots(records) {
  const byNumber = new Map();
  records.forEach((record) => {
    const current = byNumber.get(record.number);
    if (!current || record.tableDepth < current.tableDepth) byNumber.set(record.number, record);
  });
  return [...byNumber.values()].sort((left, right) => left.number - right.number);
}

function trimAfterLastPageMarker(documentNode) {
  const root = documentNode.documentElement;
  const children = Array.from(root.children);
  const markerIndex = children.findIndex((child) => (
    textOf(child).replace(/\s+/g, "").includes("마지막페이지입니다")
  ));
  if (markerIndex < 0) return 0;
  const trailing = children.slice(markerIndex + 1);
  if (trailing.some((child) => findSlots(child).length || findExplanationMarkers(child).length)) return 0;
  trailing.forEach((child) => child.remove());
  return trailing.length;
}

export async function inspectTemplateSlots(data) {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const slots = [];
  const sectionNames = Object.keys(zip.files).filter((name) => SECTION_RE.test(name)).sort();
  for (const sectionName of sectionNames) {
    const documentNode = parseXml(await zip.file(sectionName).async("string"), sectionName);
    findSlots(documentNode.documentElement).forEach((slot) => {
      slots.push({ sectionName, number: slot.number });
    });
  }
  return canonicalSlots(slots);
}

export async function inspectTemplateExplanationMarker(data) {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const sectionNames = Object.keys(zip.files).filter((name) => SECTION_RE.test(name)).sort();
  for (const sectionName of sectionNames) {
    const documentNode = parseXml(await zip.file(sectionName).async("string"), sectionName);
    if (findExplanationMarkers(documentNode.documentElement).length) return true;
  }
  return false;
}

const COLLECTIONS = [
  ["borderFills", "borderFill", "borderFillIDRef"],
  ["charProperties", "charPr", "charPrIDRef"],
  ["tabProperties", "tabPr", "tabPrIDRef"],
  ["numberings", "numbering", "numberingIDRef"],
  ["bullets", "bullet", "bulletIDRef"],
  ["paraProperties", "paraPr", "paraPrIDRef"],
  ["styles", "style", "styleIDRef"],
];

const REF_TO_MAP = {
  borderFillIDRef: "borderFillIDRef",
  charPrIDRef: "charPrIDRef",
  paraPrIDRef: "paraPrIDRef",
  tabPrIDRef: "tabPrIDRef",
  numberingIDRef: "numberingIDRef",
  bulletIDRef: "bulletIDRef",
  styleIDRef: "styleIDRef",
  nextStyleIDRef: "styleIDRef",
};

function directChildrenByName(container, name) {
  return Array.from(container?.children || []).filter((child) => localName(child) === name);
}

function nextNumericId(elements) {
  return Math.max(-1, ...elements.map((element) => Number(element.getAttribute("id"))).filter(Number.isFinite)) + 1;
}

function findRefContainer(documentNode, name) {
  return firstDescendant(documentNode.documentElement, name);
}

function ensureRefContainer(sourceDocument, templateContainer, name) {
  const existing = findRefContainer(sourceDocument, name);
  if (existing) return existing;
  const refList = firstDescendant(sourceDocument.documentElement, "refList");
  if (!refList || !templateContainer) return null;
  const empty = sourceDocument.importNode(templateContainer, false);
  empty.setAttribute("itemCnt", "0");
  refList.appendChild(empty);
  return empty;
}

function planCollectionMaps(sourceDocument, templateDocument) {
  const maps = {};
  for (const [containerName, itemName, mapName] of COLLECTIONS) {
    const templateContainer = findRefContainer(templateDocument, containerName);
    if (!templateContainer) continue;
    const sourceContainer = ensureRefContainer(sourceDocument, templateContainer, containerName);
    if (!sourceContainer) continue;
    let next = nextNumericId(directChildrenByName(sourceContainer, itemName));
    const map = new Map();
    for (const item of directChildrenByName(templateContainer, itemName)) {
      const oldId = item.getAttribute("id");
      if (oldId == null) continue;
      map.set(oldId, String(next++));
    }
    maps[mapName] = map;
  }
  return maps;
}

function mergeFonts(sourceDocument, templateDocument, binaryMap) {
  const sourceFaces = findRefContainer(sourceDocument, "fontfaces");
  const templateFaces = findRefContainer(templateDocument, "fontfaces");
  const fontMaps = new Map();
  if (!sourceFaces || !templateFaces) return fontMaps;

  for (const templateFace of directChildrenByName(templateFaces, "fontface")) {
    const lang = templateFace.getAttribute("lang") || "";
    let sourceFace = directChildrenByName(sourceFaces, "fontface").find((face) => face.getAttribute("lang") === lang);
    if (!sourceFace) {
      sourceFace = sourceDocument.importNode(templateFace, false);
      sourceFace.setAttribute("fontCnt", "0");
      sourceFaces.appendChild(sourceFace);
    }
    let next = nextNumericId(directChildrenByName(sourceFace, "font"));
    const map = new Map();
    for (const templateFont of directChildrenByName(templateFace, "font")) {
      const oldId = templateFont.getAttribute("id");
      if (oldId == null) continue;
      const clone = sourceDocument.importNode(templateFont, true);
      clone.setAttribute("id", String(next));
      descendants(clone, "substFont").forEach((node) => {
        const ref = node.getAttribute("binaryItemIDRef");
        if (ref && binaryMap.has(ref)) node.setAttribute("binaryItemIDRef", binaryMap.get(ref));
      });
      sourceFace.appendChild(clone);
      map.set(oldId, String(next));
      next += 1;
    }
    sourceFace.setAttribute("fontCnt", String(directChildrenByName(sourceFace, "font").length));
    fontMaps.set(lang, map);
  }
  return fontMaps;
}

const FONT_ATTR_TO_LANG = {
  hangul: "HANGUL",
  latin: "LATIN",
  hanja: "HANJA",
  japanese: "JAPANESE",
  other: "OTHER",
  symbol: "SYMBOL",
  user: "USER",
};

function remapReferences(root, maps, fontMaps, binaryMap) {
  const all = [root, ...Array.from(root.getElementsByTagNameNS("*", "*"))];
  for (const element of all) {
    for (const [attribute, mapName] of Object.entries(REF_TO_MAP)) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      const mapped = maps[mapName]?.get(value);
      if (mapped != null) element.setAttribute(attribute, mapped);
    }
    if (element.hasAttribute("binaryItemIDRef")) {
      const value = element.getAttribute("binaryItemIDRef");
      if (binaryMap.has(value)) element.setAttribute("binaryItemIDRef", binaryMap.get(value));
    }
    if (localName(element) === "fontRef") {
      for (const [attribute, lang] of Object.entries(FONT_ATTR_TO_LANG)) {
        if (!element.hasAttribute(attribute)) continue;
        const value = element.getAttribute(attribute);
        const mapped = fontMaps.get(lang)?.get(value);
        if (mapped != null) element.setAttribute(attribute, mapped);
      }
    }
  }
}

function appendTemplateCollections(sourceDocument, templateDocument, maps, fontMaps, binaryMap) {
  for (const [containerName, itemName, mapName] of COLLECTIONS) {
    const templateContainer = findRefContainer(templateDocument, containerName);
    if (!templateContainer) continue;
    const sourceContainer = ensureRefContainer(sourceDocument, templateContainer, containerName);
    if (!sourceContainer) continue;
    for (const templateItem of directChildrenByName(templateContainer, itemName)) {
      const oldId = templateItem.getAttribute("id");
      const clone = sourceDocument.importNode(templateItem, true);
      if (oldId != null && maps[mapName]?.has(oldId)) clone.setAttribute("id", maps[mapName].get(oldId));
      remapReferences(clone, maps, fontMaps, binaryMap);
      sourceContainer.appendChild(clone);
    }
    sourceContainer.setAttribute("itemCnt", String(directChildrenByName(sourceContainer, itemName).length));
  }
}

function uniqueBinaryId(sourceManifest, preferred) {
  const used = new Set(descendants(sourceManifest, "item").map((item) => item.getAttribute("id")).filter(Boolean));
  let candidate = `tpl_${preferred}`;
  let suffix = 2;
  while (used.has(candidate)) candidate = `tpl_${preferred}_${suffix++}`;
  return candidate;
}

async function importTemplateBinaryItems(sourceContentDocument, templateZip, templateContentDocument) {
  const sourceManifest = firstDescendant(sourceContentDocument.documentElement, "manifest");
  const templateManifest = firstDescendant(templateContentDocument.documentElement, "manifest");
  const binaryMap = new Map();
  const additions = new Map();
  if (!sourceManifest || !templateManifest) return { binaryMap, additions };

  for (const item of directChildrenByName(templateManifest, "item")) {
    const href = item.getAttribute("href") || "";
    if (!href.startsWith("BinData/")) continue;
    const oldId = item.getAttribute("id") || href.split("/").pop().split(".")[0];
    const entry = templateZip.file(href);
    if (!entry) continue;
    const newId = uniqueBinaryId(sourceManifest, oldId);
    const extension = href.includes(".") ? href.slice(href.lastIndexOf(".")) : "";
    const newHref = `BinData/${newId}${extension}`;
    const clone = sourceContentDocument.importNode(item, true);
    clone.setAttribute("id", newId);
    clone.setAttribute("href", newHref);
    sourceManifest.appendChild(clone);
    binaryMap.set(oldId, newId);
    additions.set(newHref, await entry.async("uint8array"));
  }
  return { binaryMap, additions };
}

function updateSectionsInContent(sourceContentDocument, sectionNames) {
  const manifest = firstDescendant(sourceContentDocument.documentElement, "manifest");
  const spine = firstDescendant(sourceContentDocument.documentElement, "spine");
  if (!manifest || !spine) throw new Error("Contents/content.hpf의 manifest/spine을 찾지 못했습니다.");

  directChildrenByName(manifest, "item").forEach((item) => {
    if (SECTION_RE.test(item.getAttribute("href") || "")) item.remove();
  });
  directChildrenByName(spine, "itemref").forEach((item) => {
    if (/^section\d+$/.test(item.getAttribute("idref") || "")) item.remove();
  });

  const namespace = manifest.namespaceURI;
  const prefix = manifest.prefix || "opf";
  sectionNames.forEach((sectionName, index) => {
    const id = `section${index}`;
    const item = sourceContentDocument.createElementNS(namespace, `${prefix}:item`);
    item.setAttribute("id", id);
    item.setAttribute("href", sectionName);
    item.setAttribute("media-type", "application/xml");
    manifest.appendChild(item);
    const itemref = sourceContentDocument.createElementNS(spine.namespaceURI, `${spine.prefix || "opf"}:itemref`);
    itemref.setAttribute("idref", id);
    itemref.setAttribute("linear", "no");
    spine.appendChild(itemref);
  });
}

function removeLayoutControls(element) {
  descendants(element, "secPr").forEach((node) => node.remove());
  descendants(element, "colPr").forEach((node) => node.remove());
  const paragraphs = localName(element) === "p"
    ? [element, ...descendants(element, "p")]
    : descendants(element, "p");
  paragraphs.forEach((paragraph) => {
    paragraph.setAttribute("pageBreak", "0");
    paragraph.setAttribute("columnBreak", "0");
  });
}

function hasQuestionContent(elements) {
  return elements.some((element) => {
    const clone = element.cloneNode(true);
    descendants(clone, "endNote").forEach((node) => node.remove());
    return Boolean(
      textOf(clone)
      || descendants(clone, "equation").length
      || descendants(clone, "pic").length
      || descendants(clone, "tbl").length
    );
  });
}

function countNamed(elements, name) {
  return elements.reduce((sum, element) => (
    sum + (localName(element) === name ? 1 : 0) + descendants(element, name).length
  ), 0);
}

function ensureLeftParagraphStyles(sourceHeaderDocument, elements) {
  const paraProperties = findRefContainer(sourceHeaderDocument, "paraProperties");
  if (!paraProperties) return;
  const paraStyles = directChildrenByName(paraProperties, "paraPr");
  const byId = new Map(paraStyles.map((style) => [style.getAttribute("id"), style]));
  let next = nextNumericId(paraStyles);
  const mapped = new Map();

  elements.forEach((element) => {
    if (localName(element) !== "p") return;
    const oldId = element.getAttribute("paraPrIDRef");
    if (!oldId) return;
    if (!mapped.has(oldId)) {
      const sourceStyle = byId.get(oldId);
      if (!sourceStyle) return;
      const clone = sourceHeaderDocument.importNode(sourceStyle, true);
      const newId = String(next++);
      clone.setAttribute("id", newId);
      let align = firstDescendant(clone, "align");
      if (!align) {
        align = sourceHeaderDocument.createElementNS(clone.namespaceURI, `${clone.prefix || "hh"}:align`);
        clone.appendChild(align);
      }
      align.setAttribute("horizontal", "LEFT");
      paraProperties.appendChild(clone);
      mapped.set(oldId, newId);
    }
    if (mapped.has(oldId)) element.setAttribute("paraPrIDRef", mapped.get(oldId));
  });
  paraProperties.setAttribute("itemCnt", String(directChildrenByName(paraProperties, "paraPr").length));
}

function clearSlotMarker(paragraph) {
  descendants(paragraph, "t").forEach((node) => { node.textContent = ""; });
}

function replaceParagraphText(paragraph, value) {
  const textNodes = descendants(paragraph, "t");
  textNodes.forEach((node, index) => { node.textContent = index === 0 ? value : ""; });
}

function ensureHiddenEndnoteStyle(headerDocument) {
  const charProperties = findRefContainer(headerDocument, "charProperties");
  if (!charProperties) throw new Error("미주 숨김용 글자 서식을 추가할 charProperties를 찾지 못했습니다.");
  const styles = directChildrenByName(charProperties, "charPr");
  const existing = styles.find((style) => (
    style.getAttribute("height") === "100"
    && (style.getAttribute("textColor") || "").toUpperCase() === "#FFFFFF"
  ));
  if (existing) return existing.getAttribute("id");
  if (!styles.length) throw new Error("미주 숨김용 기준 글자 서식을 찾지 못했습니다.");
  const clone = headerDocument.importNode(styles[0], true);
  clone.setAttribute("id", String(nextNumericId(styles)));
  clone.setAttribute("height", "100");
  clone.setAttribute("textColor", "#FFFFFF");
  charProperties.appendChild(clone);
  charProperties.setAttribute("itemCnt", String(styles.length + 1));
  return clone.getAttribute("id");
}

function hideEndnoteFormatting(headerDocument, sectionDocuments) {
  const hiddenStyleId = ensureHiddenEndnoteStyle(headerDocument);
  sectionDocuments.forEach((documentNode) => {
    descendants(documentNode.documentElement, "endNote").forEach((note) => {
      descendants(note, "run").forEach((run) => run.setAttribute("charPrIDRef", hiddenStyleId));
      descendants(note, "equation").forEach((equation) => {
        equation.setAttribute("baseUnit", "100");
        equation.setAttribute("textColor", "#FFFFFF");
      });
    });
  });
}

function pruneUnusedBinaryItems(contentDocument, roots) {
  const usedIds = new Set();
  roots.forEach((root) => {
    const all = [root.documentElement || root, ...descendants(root.documentElement || root, "*")];
    all.forEach((element) => {
      const ref = element.getAttribute?.("binaryItemIDRef");
      if (ref) usedIds.add(ref);
    });
  });

  const manifest = firstDescendant(contentDocument.documentElement, "manifest");
  const keptPaths = new Set();
  if (!manifest) return keptPaths;
  directChildrenByName(manifest, "item").forEach((item) => {
    const href = item.getAttribute("href") || "";
    if (!href.startsWith("BinData/")) return;
    if (usedIds.has(item.getAttribute("id"))) keptPaths.add(href);
    else item.remove();
  });
  return keptPaths;
}

async function createOutputZip(sourceZip, overrides, additions, sectionNames, keptBinaryPaths) {
  const output = new JSZip();
  const mimetype = sourceZip.file("mimetype");
  if (!mimetype) throw new Error("HWPX mimetype 항목을 찾지 못했습니다.");
  output.file("mimetype", await mimetype.async("uint8array"), { binary: true, compression: "STORE" });

  for (const entry of Object.values(sourceZip.files)) {
    if (entry.dir || entry.name === "mimetype" || SECTION_RE.test(entry.name)) continue;
    if (entry.name.startsWith("BinData/") && !keptBinaryPaths.has(entry.name)) continue;
    if (overrides.has(entry.name)) {
      output.file(entry.name, overrides.get(entry.name), { compression: "DEFLATE" });
    } else {
      output.file(entry.name, await entry.async("uint8array"), { binary: true, compression: "DEFLATE", date: entry.date });
    }
  }
  for (const sectionName of sectionNames) output.file(sectionName, overrides.get(sectionName), { compression: "DEFLATE" });
  for (const [path, bytes] of additions) {
    if (keptBinaryPaths.has(path)) output.file(path, bytes, { binary: true, compression: "DEFLATE" });
  }

  return output.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.hancom.hwpx",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function validateGeneratedExamHwpx(
  data,
  {
    expectedQuestionCount = 0,
    expectedEndnoteCount = expectedQuestionCount,
    expectHiddenEndnotes = false,
  } = {},
) {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const errors = [];
  if (!zip.file("mimetype")) errors.push("mimetype 항목이 없습니다.");

  const sectionNames = Object.keys(zip.files).filter((name) => SECTION_RE.test(name)).sort();
  if (!sectionNames.length) errors.push("본문 section이 없습니다.");
  const sectionDocuments = [];
  for (const sectionName of sectionNames) {
    sectionDocuments.push(parseXml(await zip.file(sectionName).async("string"), sectionName));
  }

  const remainingSlots = sectionDocuments.flatMap((documentNode) => findSlots(documentNode.documentElement));
  if (remainingSlots.length) {
    errors.push(`치환되지 않은 문제 슬롯이 ${remainingSlots.length}개 남았습니다.`);
  }
  const remainingSequentialMarkers = sectionDocuments.flatMap((documentNode) => (
    findSequentialMarkers(documentNode.documentElement)
  ));
  if (remainingSequentialMarkers.length) {
    errors.push(`치환되지 않은 연속 문제 삽입 지점이 ${remainingSequentialMarkers.length}개 남았습니다.`);
  }
  const remainingExplanationMarkers = sectionDocuments.flatMap((documentNode) => (
    findExplanationMarkers(documentNode.documentElement)
  ));
  if (remainingExplanationMarkers.length) {
    errors.push(`치환되지 않은 #해설 표식이 ${remainingExplanationMarkers.length}개 남았습니다.`);
  }
  sectionDocuments.forEach((documentNode) => {
    const children = Array.from(documentNode.documentElement.children);
    const markerIndex = children.findIndex((child) => (
      textOf(child).replace(/\s+/g, "").includes("마지막페이지입니다")
    ));
    const explanationIndex = children.findIndex((child, index) => (
      index > markerIndex && textOf(child) === "해설"
    ));
    if (markerIndex >= 0 && markerIndex + 1 < children.length && explanationIndex < 0) {
      errors.push(`마지막 페이지 표시 뒤에 문단 ${children.length - markerIndex - 1}개가 남았습니다.`);
    }
  });

  const endnotes = sectionDocuments.flatMap((documentNode) => descendants(documentNode.documentElement, "endNote"));
  if (endnotes.length !== expectedEndnoteCount) {
    errors.push(`미주는 ${expectedEndnoteCount}개여야 하지만 ${endnotes.length}개입니다.`);
  }
  const answerCount = endnotes.filter((note) => textOf(note).includes("[정답]")).length;
  const explanationCount = endnotes.filter((note) => textOf(note).includes("[해설]")).length;
  if (expectedQuestionCount && answerCount !== expectedQuestionCount) {
    errors.push(`[정답] 영역은 ${expectedQuestionCount}개여야 하지만 ${answerCount}개입니다.`);
  }
  if (expectedQuestionCount && explanationCount !== expectedQuestionCount) {
    errors.push(`[해설] 영역은 ${expectedQuestionCount}개여야 하지만 ${explanationCount}개입니다.`);
  }

  const unresolvedFields = [];
  sectionDocuments.forEach((documentNode) => {
    descendants(documentNode.documentElement, "t").forEach((node) => {
      if (/\{\{[^{}]+\}\}/.test(node.textContent || "")) unresolvedFields.push(node.textContent.trim());
    });
    descendants(documentNode.documentElement, "stringParam").forEach((node) => {
      if (node.getAttribute("name") === "Direction" && /\{\{[^{}]+\}\}/.test(node.textContent || "")) {
        unresolvedFields.push(node.textContent.trim());
      }
    });
  });
  if (unresolvedFields.length) {
    errors.push(`미치환 누름틀 값이 남았습니다: ${[...new Set(unresolvedFields)].join(", ")}`);
  }

  const contentEntry = zip.file("Contents/content.hpf");
  const headerEntry = zip.file("Contents/header.xml");
  if (!contentEntry || !headerEntry) {
    errors.push("header.xml 또는 content.hpf가 없습니다.");
  } else {
    const contentDocument = parseXml(await contentEntry.async("string"), "Contents/content.hpf");
    const headerDocument = parseXml(await headerEntry.async("string"), "Contents/header.xml");
    if (expectHiddenEndnotes) {
      const styles = new Map(
        directChildrenByName(findRefContainer(headerDocument, "charProperties"), "charPr")
          .map((style) => [style.getAttribute("id"), style]),
      );
      const visibleRuns = endnotes.flatMap((note) => descendants(note, "run")).filter((run) => {
        const style = styles.get(run.getAttribute("charPrIDRef"));
        return !style
          || style.getAttribute("height") !== "100"
          || (style.getAttribute("textColor") || "").toUpperCase() !== "#FFFFFF";
      });
      const visibleEquations = endnotes.flatMap((note) => descendants(note, "equation")).filter((equation) => (
        equation.getAttribute("baseUnit") !== "100"
        || (equation.getAttribute("textColor") || "").toUpperCase() !== "#FFFFFF"
      ));
      if (visibleRuns.length || visibleEquations.length) {
        errors.push("미주 숨김 서식(1pt·흰색)이 일부 미주 내용에 적용되지 않았습니다.");
      }
    }
    const manifest = firstDescendant(contentDocument.documentElement, "manifest");
    const binaryItems = new Map(
      directChildrenByName(manifest, "item")
        .filter((item) => (item.getAttribute("href") || "").startsWith("BinData/"))
        .map((item) => [item.getAttribute("id"), item.getAttribute("href")]),
    );
    const referencedIds = new Set();
    [headerDocument, ...sectionDocuments].forEach((documentNode) => {
      const root = documentNode.documentElement;
      [root, ...descendants(root, "*")].forEach((element) => {
        const ref = element.getAttribute?.("binaryItemIDRef");
        if (ref) referencedIds.add(ref);
      });
    });
    referencedIds.forEach((id) => {
      const href = binaryItems.get(id);
      if (!href) errors.push(`BinData manifest 참조가 없습니다: ${id}`);
      else if (!zip.file(href)) errors.push(`BinData 파일이 없습니다: ${href}`);
    });
  }

  if (errors.length) throw new Error(`생성 결과 검증 실패: ${errors.join(" ")}`);
  return {
    answerCount,
    endnoteCount: endnotes.length,
    explanationCount,
    sectionCount: sectionNames.length,
  };
}

export async function buildExamFromTemplateHwpx(
  sourceBytes,
  templateBytes,
  questions,
  selectedOrdinals,
  { hideEndnotes = false } = {},
) {
  if (!selectedOrdinals.length) throw new Error("시험지에 넣을 문항을 한 개 이상 선택하세요.");
  const sourceZip = await JSZip.loadAsync(sourceBytes, { checkCRC32: true });
  const templateZip = await JSZip.loadAsync(templateBytes, { checkCRC32: true });
  const sourceHeaderEntry = sourceZip.file("Contents/header.xml");
  const templateHeaderEntry = templateZip.file("Contents/header.xml");
  const sourceContentEntry = sourceZip.file("Contents/content.hpf");
  const templateContentEntry = templateZip.file("Contents/content.hpf");
  if (!sourceHeaderEntry || !templateHeaderEntry || !sourceContentEntry || !templateContentEntry) {
    throw new Error("문제은행 또는 템플릿의 HWPX 핵심 파일을 찾지 못했습니다.");
  }

  const sourceHeaderDocument = parseXml(await sourceHeaderEntry.async("string"), "문제은행 header.xml");
  const templateHeaderDocument = parseXml(await templateHeaderEntry.async("string"), "템플릿 header.xml");
  const sourceContentDocument = parseXml(await sourceContentEntry.async("string"), "문제은행 content.hpf");
  const templateContentDocument = parseXml(await templateContentEntry.async("string"), "템플릿 content.hpf");
  const templateSectionNames = Object.keys(templateZip.files).filter((name) => SECTION_RE.test(name)).sort();
  if (!templateSectionNames.length) throw new Error("템플릿 본문 section을 찾지 못했습니다.");

  const { binaryMap, additions } = await importTemplateBinaryItems(sourceContentDocument, templateZip, templateContentDocument);
  const maps = planCollectionMaps(sourceHeaderDocument, templateHeaderDocument);
  const fontMaps = mergeFonts(sourceHeaderDocument, templateHeaderDocument, binaryMap);
  appendTemplateCollections(sourceHeaderDocument, templateHeaderDocument, maps, fontMaps, binaryMap);
  sourceHeaderDocument.documentElement.setAttribute("secCnt", String(templateSectionNames.length));

  const sourceSectionDocuments = new Map();
  for (const sectionName of new Set(questions.map((question) => question.sectionName))) {
    const entry = sourceZip.file(sectionName);
    if (entry) sourceSectionDocuments.set(sectionName, parseXml(await entry.async("string"), sectionName));
  }

  const selectedQuestions = selectedOrdinals
    .map((ordinal) => questions.find((question) => question.ordinal === ordinal))
    .filter(Boolean);
  if (selectedQuestions.length !== selectedOrdinals.length) {
    throw new Error("선택 문항 일부를 문제은행 분석 결과에서 찾지 못했습니다.");
  }
  const allSlotRecords = [];
  const sequentialRecords = [];
  const explanationRecords = [];
  const templateSections = new Map();
  for (const sectionName of templateSectionNames) {
    const documentNode = parseXml(await templateZip.file(sectionName).async("string"), sectionName);
    trimAfterLastPageMarker(documentNode);
    remapReferences(documentNode.documentElement, maps, fontMaps, binaryMap);
    findSlots(documentNode.documentElement).forEach((slot) => {
      allSlotRecords.push({ sectionName, ...slot, documentNode });
    });
    findSequentialMarkers(documentNode.documentElement).forEach((element) => {
      sequentialRecords.push({ sectionName, element, documentNode });
    });
    findExplanationMarkers(documentNode.documentElement).forEach((element) => {
      explanationRecords.push({ sectionName, element, documentNode });
    });
    templateSections.set(sectionName, documentNode);
  }
  const slotRecords = canonicalSlots(allSlotRecords);
  const canonicalElements = new Set(slotRecords.map((slot) => slot.element));
  allSlotRecords
    .filter((slot) => !canonicalElements.has(slot.element))
    .forEach((slot) => clearSlotMarker(slot.element));
  const sequentialRecord = slotRecords.length ? null : sequentialRecords[0] || null;
  sequentialRecords.slice(sequentialRecord ? 1 : 0).forEach((record) => clearSlotMarker(record.element));
  explanationRecords.forEach((record) => replaceParagraphText(record.element, "해설"));
  if (!slotRecords.length && !sequentialRecord) {
    throw new Error("템플릿에서 #1 문제 슬롯 또는 {{QUESTIONS}} 연속 삽입 지점을 찾지 못했습니다.");
  }
  if (!sequentialRecord && selectedQuestions.length > slotRecords.length) {
    throw new Error(`선택 문항 ${selectedQuestions.length}개에 비해 템플릿 문제 슬롯은 ${slotRecords.length}개뿐입니다.`);
  }

  const cloneQuestion = (question, targetDocument) => {
    const sourceDocument = sourceSectionDocuments.get(question.sectionName);
    if (!sourceDocument) throw new Error(`${question.sectionName} 원문을 찾지 못했습니다.`);
    const children = Array.from(sourceDocument.documentElement.children);
    const contentStart = Number.isInteger(question.contentStart)
      ? question.contentStart
      : question.sourceType === "미분류" ? question.blockStart : question.blockStart + 1;
    const contentEnd = Number.isInteger(question.contentEnd) ? question.contentEnd : question.blockEnd;
    const sourceElements = children.slice(contentStart, contentEnd);
    if (!sourceElements.length) throw new Error(`${question.sourceLabel || question.ordinal}의 문제 본문을 찾지 못했습니다.`);
    if (!hasQuestionContent(sourceElements)) {
      throw new Error(`${question.sourceLabel || question.ordinal}의 문제 본문이 비어 있습니다.`);
    }
    if (question.hasEndnote && countNamed(sourceElements, "endNote") === 0) {
      throw new Error(`${question.sourceLabel || question.ordinal}의 정답·해설 미주가 복사 범위에서 누락됐습니다.`);
    }
    const clones = sourceElements.map((element) => targetDocument.importNode(element, true));
    clones.forEach((clone) => removeLayoutControls(clone));
    ensureLeftParagraphStyles(sourceHeaderDocument, clones);
    return clones;
  };

  if (sequentialRecord) {
    clearSlotMarker(sequentialRecord.element);
    const parent = sequentialRecord.element.parentNode;
    const insertionPoint = sequentialRecord.element.nextSibling;
    selectedQuestions.forEach((question) => {
      cloneQuestion(question, sequentialRecord.documentNode)
        .forEach((clone) => parent.insertBefore(clone, insertionPoint));
    });
  } else {
    for (let index = 0; index < slotRecords.length; index += 1) {
      const slot = slotRecords[index];
      const question = selectedQuestions[index];
      if (!question) {
        clearSlotMarker(slot.element);
        continue;
      }
      const clones = cloneQuestion(question, slot.documentNode);
      const parent = slot.element.parentNode;
      clones.forEach((clone) => parent.insertBefore(clone, slot.element));
      parent.removeChild(slot.element);
    }
  }

  if (hideEndnotes) {
    hideEndnoteFormatting(sourceHeaderDocument, [...templateSections.values()]);
  }

  updateSectionsInContent(sourceContentDocument, templateSectionNames);
  const keptBinaryPaths = pruneUnusedBinaryItems(
    sourceContentDocument,
    [sourceHeaderDocument, ...templateSections.values()],
  );
  const overrides = new Map([
    ["Contents/header.xml", new XMLSerializer().serializeToString(sourceHeaderDocument)],
    ["Contents/content.hpf", new XMLSerializer().serializeToString(sourceContentDocument)],
  ]);
  for (const [sectionName, documentNode] of templateSections) {
    overrides.set(sectionName, new XMLSerializer().serializeToString(documentNode));
  }
  return createOutputZip(sourceZip, overrides, additions, templateSectionNames, keptBinaryPaths);
}
