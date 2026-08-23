import JSZip from "jszip";

const FIELD_TYPE = "CLICK_HERE";

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) => Array.from(element.getElementsByTagNameNS("*", name));

function parseXml(xml, label) {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  const error = documentNode.querySelector("parsererror");
  if (error) throw new Error(`${label} XML을 읽지 못했습니다.`);
  return documentNode;
}

function fieldTextFromParagraph(paragraph, beginNode) {
  const beginId = beginNode.getAttribute("id");
  let active = false;
  const pieces = [];
  for (const run of descendants(paragraph, "run")) {
    const begin = descendants(run, "fieldBegin").find((node) => node === beginNode);
    if (begin) active = true;
    if (active) descendants(run, "t").forEach((node) => pieces.push(node.textContent || ""));
    const end = descendants(run, "fieldEnd").find((node) => !beginId || node.getAttribute("beginIDRef") === beginId);
    if (active && end) break;
  }
  return pieces.join("").trim();
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
  let active = null;
  let written = false;

  for (const run of descendants(paragraph, "run")) {
    const begin = descendants(run, "fieldBegin").find((node) => node.getAttribute("type") === FIELD_TYPE);
    if (begin) {
      const name = (begin.getAttribute("name") || "").trim();
      active = Object.prototype.hasOwnProperty.call(values, name)
        ? { id: begin.getAttribute("id"), name, value: String(values[name] ?? "") }
        : null;
      written = false;
    }

    if (active) {
      for (const text of descendants(run, "t")) {
        if (!written) {
          text.textContent = active.value;
          written = true;
        } else {
          text.textContent = "";
        }
      }
    }

    const ends = descendants(run, "fieldEnd");
    if (active && ends.some((node) => !active.id || node.getAttribute("beginIDRef") === active.id)) {
      active = null;
      written = false;
    }
  }
}

export async function applyTemplateFieldValues(data, values) {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const sectionNames = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort();

  for (const sectionName of sectionNames) {
    const documentNode = parseXml(await zip.file(sectionName).async("string"), sectionName);
    descendants(documentNode.documentElement, "p").forEach((paragraph) => applyFieldsInParagraph(paragraph, values));
    zip.file(sectionName, new XMLSerializer().serializeToString(documentNode));
  }

  return zip.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.hancom.hwpx",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
