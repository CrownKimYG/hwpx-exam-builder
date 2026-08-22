import JSZip from "jszip";

const TITLE_RE = /❙\s*(예제|유제|기초연습|기본연습|실력완성)\s*(\d+)\s*(유사유형)?/;
const CHOICE_PARAGRAPH_IDS = new Set(["6", "16"]);
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) =>
  Array.from(element.getElementsByTagNameNS("*", name));
const firstDescendant = (element, name) => descendants(element, name)[0] || null;

export function equationScript(equation) {
  const script = firstDescendant(equation, "script");
  return script?.textContent?.trim() || "";
}

export function plainText(element, { skipNotes = false } = {}) {
  const fragments = [];
  function visit(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const name = localName(node);
    if (skipNotes && name === "endNote") return;
    if (name === "t") {
      fragments.push(node.textContent || "");
      return;
    }
    if (name === "equation") {
      const firstLine = equationScript(node).split(/\r?\n/)[0];
      if (firstLine) fragments.push(` {수식: ${firstLine}} `);
      return;
    }
    if (name === "lineBreak") fragments.push("\n");
    Array.from(node.children).forEach(visit);
  }
  visit(element);
  return fragments.join("").replace(/[ \t]+/g, " ").trim();
}

function imageRefs(element, { skipNotes = false } = {}) {
  const refs = [];
  function visit(node) {
    const name = localName(node);
    if (skipNotes && name === "endNote") return;
    if (name === "img" && node.getAttribute("binaryItemIDRef")) {
      refs.push(node.getAttribute("binaryItemIDRef"));
    }
    Array.from(node.children).forEach(visit);
  }
  visit(element);
  return refs;
}

function withoutEndnotes(element) {
  const clone = element.cloneNode(true);
  descendants(clone, "endNote").forEach((note) => note.remove());
  return clone;
}

function serializeWrapper(name, elements, attributes = {}) {
  const documentNode = document.implementation.createDocument(null, name);
  const root = documentNode.documentElement;
  Object.entries(attributes).forEach(([key, value]) => root.setAttribute(key, value));
  elements.forEach((element) => root.appendChild(documentNode.importNode(element, true)));
  return formatXml(new XMLSerializer().serializeToString(documentNode));
}

function formatXml(xml) {
  const compact = xml.replace(/>\s*</g, "><");
  let depth = 0;
  return compact
    .replace(/(<[^>]+>)/g, "$1\n")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
      const rendered = `${"  ".repeat(depth)}${line}`;
      if (/^<[^!?/][^>]*[^/]?>$/.test(line) && !line.includes("</")) depth += 1;
      return rendered;
    })
    .join("\n");
}

export async function prepareHwpxForPreview(data) {
  const zip = await JSZip.loadAsync(data);
  const sectionNames = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/.test(name));
  const watermarkSuffix = /(?:^|\r?\n)\s*from\s*\r?\n\s*={20,}[\s\S]*$/i;

  await Promise.all(sectionNames.map(async (sectionName) => {
    const xml = await zip.file(sectionName).async("string");
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    if (documentNode.querySelector("parsererror")) return;

    descendants(documentNode.documentElement, "script").forEach((script) => {
      const cleaned = (script.textContent || "").replace(watermarkSuffix, "").trim();
      if (cleaned) {
        script.textContent = cleaned;
        return;
      }
      let equation = script.parentElement;
      while (equation && localName(equation) !== "equation") equation = equation.parentElement;
      equation?.remove();
    });

    descendants(documentNode.documentElement, "t").forEach((textNode) => {
      if ((textNode.textContent || "").trim().toLowerCase() === "zb") textNode.textContent = "";
    });
    zip.file(sectionName, new XMLSerializer().serializeToString(documentNode));
  }));

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
}

async function bytesForRef(zip, ref) {
  const prefix = `BinData/${ref}.`;
  const path = Object.keys(zip.files).find((name) => name.startsWith(prefix));
  return path ? zip.file(path).async("uint8array") : null;
}

function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function answerValue(zip, answerParagraph, choiceRefs) {
  const warnings = [];
  const answerImages = imageRefs(answerParagraph);
  if (answerImages.length) {
    const answerBytes = await bytesForRef(zip, answerImages[0]);
    const choiceBytes = await Promise.all(choiceRefs.map((ref) => bytesForRef(zip, ref)));
    const matches = choiceBytes
      .map((bytes, index) => (equalBytes(bytes, answerBytes) ? index + 1 : null))
      .filter(Boolean);
    if (matches.length === 1) return ["multiple_choice", matches[0], warnings];
    warnings.push(`정답 그림과 선택지 번호 그림의 일치 항목이 ${matches.length}개입니다.`);
    return ["multiple_choice", null, warnings];
  }
  const equation = firstDescendant(answerParagraph, "equation");
  if (equation) {
    const value = equationScript(equation).split(/\r?\n/).find((line) => line.trim())?.trim();
    return ["short_answer", value || null, warnings];
  }
  const value = plainText(answerParagraph).replace("[정답]", "").trim();
  if (!value) warnings.push("정답 영역에서 그림, 수식 또는 텍스트를 찾지 못했습니다.");
  return ["short_answer", value || null, warnings];
}

function choiceFragments(block) {
  const choices = [];
  block.forEach((paragraph) => {
    if (localName(paragraph) !== "p" || !CHOICE_PARAGRAPH_IDS.has(paragraph.getAttribute("paraPrIDRef"))) return;
    let current = null;
    function visit(node) {
      const name = localName(node);
      if (name === "img" && node.getAttribute("binaryItemIDRef")) {
        current = [];
        choices.push(current);
        return;
      }
      if (current && (name === "t" || name === "equation" || name === "lineBreak")) {
        current.push(node.cloneNode(true));
        if (name !== "lineBreak") return;
      }
      Array.from(node.children).forEach(visit);
    }
    visit(paragraph);
  });
  return choices;
}

export async function parseHwpx(file) {
  if (!file.name.toLowerCase().endsWith(".hwpx")) throw new Error(".hwpx 파일만 사용할 수 있습니다.");
  const data = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const totalSize = entries.reduce((sum, entry) => sum + (entry._data?.uncompressedSize || 0), 0);
  if (totalSize > MAX_UNCOMPRESSED_BYTES) throw new Error("압축 해제 크기가 허용 범위를 초과합니다.");
  const sectionNames = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort();
  if (!sectionNames.length) throw new Error("본문 section XML을 찾을 수 없습니다.");

  const questions = [];
  for (const sectionName of sectionNames) {
    const xml = await zip.file(sectionName).async("string");
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    const parseError = documentNode.querySelector("parsererror");
    if (parseError) throw new Error(`XML 파싱 오류: ${parseError.textContent}`);
    const root = documentNode.documentElement;
    const children = Array.from(root.children);
    const anchors = children
      .map((child, index) => ({ index, child, note: firstDescendant(child, "endNote") }))
      .filter((item) => item.note);
    const metadata = anchors.map(({ index }) => {
      for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
        const match = plainText(children[candidate], { skipNotes: true }).match(TITLE_RE);
        if (match) return { start: candidate, label: match[0].trim(), type: match[1], number: Number(match[2]) };
      }
      return { start: index, label: `문항 ${questions.length + 1}`, type: "미분류", number: 0 };
    });

    for (let position = 0; position < anchors.length; position += 1) {
      const { index: anchorIndex, child: anchor, note } = anchors[position];
      const meta = metadata[position];
      const end = position + 1 < metadata.length ? metadata[position + 1].start : children.length;
      const block = children.slice(meta.start, end);
      const bodyElements = block.map(withoutEndnotes);
      const noteParagraphs = descendants(note, "p");
      const answerParagraph = noteParagraphs.find((p) => plainText(p).includes("[정답]")) || noteParagraphs[0] || note;
      const explanationStart = noteParagraphs.findIndex((p) => plainText(p).includes("[해설]"));
      const explanationParagraphs = explanationStart >= 0 ? noteParagraphs.slice(explanationStart) : [];
      const choiceRefs = block.flatMap((element) =>
        localName(element) === "p" && CHOICE_PARAGRAPH_IDS.has(element.getAttribute("paraPrIDRef"))
          ? imageRefs(element, { skipNotes: true }) : []
      );
      const [answerType, answer, warnings] = await answerValue(zip, answerParagraph, choiceRefs);
      if (answerType === "multiple_choice" && choiceRefs.length !== 5) {
        warnings.push(`객관식 선택지 번호 그림이 ${choiceRefs.length}개입니다.`);
      }
      const bodyXml = serializeWrapper("body", bodyElements, { section: sectionName, anchor: String(anchorIndex) });
      const answerXml = serializeWrapper("answer", [answerParagraph]);
      const explanationXml = serializeWrapper("explanation", explanationParagraphs);
      const fullXml = formatXml(
        `<questionBlock ordinal="${questions.length + 1}" sourceLabel="${meta.label}" answerType="${answerType}" answerValue="${answer ?? ""}">${bodyXml}${answerXml}${explanationXml}</questionBlock>`
      );
      const questionElements = block
        .slice(1)
        .filter((element) => !CHOICE_PARAGRAPH_IDS.has(element.getAttribute("paraPrIDRef")))
        .map(withoutEndnotes)
        .filter((element) => plainText(element).trim());
      questions.push({
        ordinal: questions.length + 1,
        sourceLabel: meta.label,
        sourceType: meta.type,
        sourceNumber: meta.number,
        answerType,
        answer,
        choiceCount: choiceRefs.length,
        warnings,
        questionElements,
        choices: choiceFragments(block),
        explanationElements: explanationParagraphs,
        bodyXml,
        answerXml,
        explanationXml,
        fullXml,
      });
    }
  }
  return { filename: file.name, questions };
}
