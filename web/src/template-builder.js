import JSZip from "jszip";

const SECTION_RE = /^Contents\/section\d+\.xml$/;
const SLOT_RE = /^#(\d+)$/;

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

function topLevelSlot(root, child) {
  if (localName(child) !== "p") return null;
  const match = textOf(child).match(SLOT_RE);
  if (!match) return null;
  return { number: Number(match[1]), element: child };
}

export async function inspectTemplateSlots(data) {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const slots = [];
  const sectionNames = Object.keys(zip.files).filter((name) => SECTION_RE.test(name)).sort();
  for (const sectionName of sectionNames) {
    const documentNode = parseXml(await zip.file(sectionName).async("string"), sectionName);
    Array.from(documentNode.documentElement.children).forEach((child) => {
      const slot = topLevelSlot(documentNode.documentElement, child);
      if (slot) slots.push({ sectionName, number: slot.number });
    });
  }
  return slots.sort((left, right) => left.number - right.number);
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

async function createOutputZip(sourceZip, overrides, additions, sectionNames) {
  const output = new JSZip();
  const mimetype = sourceZip.file("mimetype");
  if (!mimetype) throw new Error("HWPX mimetype 항목을 찾지 못했습니다.");
  output.file("mimetype", await mimetype.async("uint8array"), { binary: true, compression: "STORE" });

  for (const entry of Object.values(sourceZip.files)) {
    if (entry.dir || entry.name === "mimetype" || SECTION_RE.test(entry.name)) continue;
    if (overrides.has(entry.name)) {
      output.file(entry.name, overrides.get(entry.name), { compression: "DEFLATE" });
    } else {
      output.file(entry.name, await entry.async("uint8array"), { binary: true, compression: "DEFLATE", date: entry.date });
    }
  }
  for (const sectionName of sectionNames) output.file(sectionName, overrides.get(sectionName), { compression: "DEFLATE" });
  for (const [path, bytes] of additions) output.file(path, bytes, { binary: true, compression: "DEFLATE" });

  return output.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.hancom.hwpx",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function buildExamFromTemplateHwpx(sourceBytes, templateBytes, questions, selectedOrdinals) {
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

  const selectedQuestions = selectedOrdinals.map((ordinal) => questions.find((question) => question.ordinal === ordinal)).filter(Boolean);
  const slotRecords = [];
  const templateSections = new Map();
  for (const sectionName of templateSectionNames) {
    const documentNode = parseXml(await templateZip.file(sectionName).async("string"), sectionName);
    remapReferences(documentNode.documentElement, maps, fontMaps, binaryMap);
    Array.from(documentNode.documentElement.children).forEach((child) => {
      const slot = topLevelSlot(documentNode.documentElement, child);
      if (slot) slotRecords.push({ sectionName, number: slot.number, element: child, documentNode });
    });
    templateSections.set(sectionName, documentNode);
  }
  slotRecords.sort((left, right) => left.number - right.number);
  if (selectedQuestions.length > slotRecords.length) {
    throw new Error(`선택 문항 ${selectedQuestions.length}개에 비해 템플릿 문제 슬롯은 ${slotRecords.length}개뿐입니다.`);
  }

  for (let index = 0; index < slotRecords.length; index += 1) {
    const slot = slotRecords[index];
    const question = selectedQuestions[index];
    if (!question) {
      clearSlotMarker(slot.element);
      continue;
    }
    const sourceDocument = sourceSectionDocuments.get(question.sectionName);
    if (!sourceDocument) throw new Error(`${question.sectionName} 원문을 찾지 못했습니다.`);
    const children = Array.from(sourceDocument.documentElement.children);
    const sourceElements = children.slice(question.blockStart + 1, question.blockEnd);
    if (!sourceElements.length) throw new Error(`${question.sourceLabel || question.ordinal}의 문제 본문을 찾지 못했습니다.`);
    const clones = sourceElements.map((element) => slot.documentNode.importNode(element, true));
    clones.forEach((clone) => removeLayoutControls(clone));
    ensureLeftParagraphStyles(sourceHeaderDocument, clones);
    const parent = slot.element.parentNode;
    clones.forEach((clone) => parent.insertBefore(clone, slot.element));
    parent.removeChild(slot.element);
  }

  updateSectionsInContent(sourceContentDocument, templateSectionNames);
  const overrides = new Map([
    ["Contents/header.xml", new XMLSerializer().serializeToString(sourceHeaderDocument)],
    ["Contents/content.hpf", new XMLSerializer().serializeToString(sourceContentDocument)],
  ]);
  for (const [sectionName, documentNode] of templateSections) {
    overrides.set(sectionName, new XMLSerializer().serializeToString(documentNode));
  }
  return createOutputZip(sourceZip, overrides, additions, templateSectionNames);
}
