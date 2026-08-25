import JSZip from "jszip";

export const HANDOFF_SCHEMA_VERSION = 1;
export const HANDOFF_METADATA_PATH = "META-INF/hwpx-exam-builder.json";
export const HANDOFF_MARKER = "{{QUESTIONS}}";

const SECTION_RE = /^Contents\/section\d+\.xml$/;

function parseXml(xml, label) {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = documentNode.querySelector("parsererror");
  if (parseError) throw new Error(`${label} XML을 읽지 못했습니다.`);
  return documentNode;
}

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) => Array.from(element.getElementsByTagNameNS("*", name));

function directChildrenByName(container, name) {
  return Array.from(container?.children || []).filter((element) => localName(element) === name);
}

function nextNumericId(elements) {
  return Math.max(-1, ...elements.map((element) => Number(element.getAttribute("id"))).filter(Number.isFinite)) + 1;
}

function ensureHiddenMarkerStyle(headerDocument) {
  const charProperties = descendants(headerDocument.documentElement, "charProperties")[0];
  if (!charProperties) throw new Error("인계 지점을 숨길 글자 서식을 찾지 못했습니다.");
  const styles = directChildrenByName(charProperties, "charPr");
  const existing = styles.find((style) => (
    style.getAttribute("height") === "100"
    && (style.getAttribute("textColor") || "").toUpperCase() === "#FFFFFF"
  ));
  if (existing) return existing.getAttribute("id");
  if (!styles.length) throw new Error("인계 지점의 기준 글자 서식이 없습니다.");
  const clone = headerDocument.importNode(styles[0], true);
  clone.setAttribute("id", String(nextNumericId(styles)));
  clone.setAttribute("height", "100");
  clone.setAttribute("textColor", "#FFFFFF");
  charProperties.appendChild(clone);
  charProperties.setAttribute("itemCnt", String(styles.length + 1));
  return clone.getAttribute("id");
}

function replaceMarkerParagraph(sectionDocument, hiddenStyleId) {
  const root = sectionDocument.documentElement;
  descendants(root, "t")
    .filter((node) => (node.textContent || "").includes(HANDOFF_MARKER))
    .forEach((node) => {
      let paragraph = node.parentElement;
      while (paragraph && localName(paragraph) !== "p") paragraph = paragraph.parentElement;
      paragraph?.remove();
    });
  const prototype = [...root.children].reverse().find((element) => localName(element) === "p");
  if (!prototype) throw new Error("인계 지점을 추가할 본문 문단이 없습니다.");
  const paragraph = sectionDocument.importNode(prototype, false);
  paragraph.setAttribute("id", String(Math.floor(1_500_000_000 + Math.random() * 500_000_000)));
  paragraph.setAttribute("pageBreak", "0");
  paragraph.setAttribute("columnBreak", "0");
  const namespace = prototype.namespaceURI;
  const prefix = prototype.prefix || "hp";
  const run = sectionDocument.createElementNS(namespace, `${prefix}:run`);
  run.setAttribute("charPrIDRef", hiddenStyleId);
  const text = sectionDocument.createElementNS(namespace, `${prefix}:t`);
  text.textContent = HANDOFF_MARKER;
  run.appendChild(text);
  paragraph.appendChild(run);
  root.appendChild(paragraph);
}

export function createHandoffMetadata({ title, includedSubjects, questionCount } = {}) {
  const subjects = [...(includedSubjects || [])].map((item) => ({
    subject: String(item.subject || "").trim(),
    questionCount: Number(item.questionCount) || 0,
  })).filter((item) => item.subject && item.questionCount > 0);
  if (!subjects.length) throw new Error("인계 파일의 과목 정보가 없습니다.");
  if (new Set(subjects.map((item) => item.subject)).size !== subjects.length) {
    throw new Error("인계 파일에 같은 과목을 두 번 넣을 수 없습니다.");
  }
  return {
    kind: "hwpx-exam-builder-handoff",
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    title: String(title || "시험지").trim() || "시험지",
    includedSubjects: subjects,
    questionCount: Number(questionCount) || subjects.reduce((sum, item) => sum + item.questionCount, 0),
    templateLocked: true,
    createdAt: new Date().toISOString(),
  };
}

export function validateHandoffMetadata(metadata) {
  if (metadata?.kind !== "hwpx-exam-builder-handoff" || metadata.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
    throw new Error("이 앱에서 만든 인계용 HWPX가 아닙니다.");
  }
  if (!Array.isArray(metadata.includedSubjects) || !metadata.includedSubjects.length) {
    throw new Error("인계용 HWPX의 과목 정보가 손상되었습니다.");
  }
  return metadata;
}

export async function createHandoffHwpx(renderedBytes, metadataInput) {
  const metadata = createHandoffMetadata(metadataInput);
  const zip = await JSZip.loadAsync(renderedBytes, { checkCRC32: true });
  const headerEntry = zip.file("Contents/header.xml");
  const sectionNames = Object.keys(zip.files).filter((name) => SECTION_RE.test(name)).sort();
  const lastSectionName = sectionNames.at(-1);
  if (!headerEntry || !lastSectionName) throw new Error("인계용 HWPX의 본문 구조를 찾지 못했습니다.");
  const headerDocument = parseXml(await headerEntry.async("string"), "header.xml");
  const hiddenStyleId = ensureHiddenMarkerStyle(headerDocument);
  const sectionDocument = parseXml(await zip.file(lastSectionName).async("string"), lastSectionName);
  replaceMarkerParagraph(sectionDocument, hiddenStyleId);
  zip.file("Contents/header.xml", new XMLSerializer().serializeToString(headerDocument));
  zip.file(lastSectionName, new XMLSerializer().serializeToString(sectionDocument));
  zip.file(HANDOFF_METADATA_PATH, JSON.stringify(metadata));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function inspectHandoffHwpx(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const entry = zip.file(HANDOFF_METADATA_PATH);
  if (!entry) throw new Error("이 앱에서 만든 인계용 HWPX가 아닙니다.");
  let metadata;
  try {
    metadata = JSON.parse(await entry.async("string"));
  } catch {
    throw new Error("인계용 HWPX의 작업 정보가 손상되었습니다.");
  }
  validateHandoffMetadata(metadata);
  const sectionNames = Object.keys(zip.files).filter((name) => SECTION_RE.test(name));
  let markerCount = 0;
  for (const name of sectionNames) {
    const xml = await zip.file(name).async("string");
    markerCount += (xml.match(/\{\{QUESTIONS\}\}/g) || []).length;
  }
  if (markerCount !== 1) throw new Error("인계용 HWPX의 이어 붙이기 지점을 찾지 못했습니다.");
  return metadata;
}

export async function finalizeHandoffHwpx(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  zip.remove(HANDOFF_METADATA_PATH);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
