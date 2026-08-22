import JSZip from "jszip";

const TITLE_RE = /❙\s*(예제|유제|기초연습|기본연습|실력완성)\s*(\d+)\s*(유사유형)?/;
const CHOICE_PARAGRAPH_IDS = new Set(["6", "16"]);
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const WATERMARK_SUFFIX_RE = /(?:^|\r?\n)\s*from\s*\r?\n\s*={20,}[\s\S]*$/i;

export const DEFAULT_EXAM_TEMPLATE = Object.freeze({
  id: "basic-math-exam-v1",
  name: "기본 2단 수학 시험지",
  title: "선택 문항 시험지",
  meta: "과목: 수학    이름: ____________________    점수: __________",
  instruction: "※ 문항의 풀이 과정과 답을 답안지에 작성하세요.",
  page: {
    width: "59528",
    height: "84189",
    left: "4252",
    right: "4252",
    top: "3685",
    bottom: "3685",
    header: "2268",
    footer: "2268",
    columnGap: "2268",
  },
});

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) =>
  Array.from(element.getElementsByTagNameNS("*", name));
const firstDescendant = (element, name) => descendants(element, name)[0] || null;

export function equationScript(equation) {
  const script = firstDescendant(equation, "script");
  return script?.textContent?.trim() || "";
}

export function normalizeEquationScript(script) {
  return (script || "").replace(WATERMARK_SUFFIX_RE, "").trim();
}

export function plainText(element, { skipNotes = false, equationMode = "script" } = {}) {
  const fragments = [];
  function visit(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const name = localName(node);
    if (skipNotes && name === "endNote") return;
    if (name === "t") {
      const value = node.textContent || "";
      if (value.trim().toLowerCase() !== "zb") fragments.push(value);
      return;
    }
    if (name === "equation") {
      const firstLine = normalizeEquationScript(equationScript(node)).split(/\r?\n/)[0];
      if (firstLine && equationMode === "script") fragments.push(` {수식: ${firstLine}} `);
      if (firstLine && equationMode === "placeholder") fragments.push(" [수식] ");
      return;
    }
    if (name === "lineBreak") fragments.push("\n");
    Array.from(node.children).forEach(visit);
  }
  visit(element);
  return fragments.join("").replace(/[ \t]+/g, " ").trim();
}

function textFromElements(elements, options = {}) {
  return elements.map((element) => plainText(element, options)).filter(Boolean).join("\n").trim();
}

function equationRecords(elements, role, ordinal) {
  let roleIndex = 0;
  return elements.flatMap((element) => descendants(element, "equation").map((equation) => {
    roleIndex += 1;
    const originalScript = equationScript(equation);
    return {
      id: `Q${String(ordinal).padStart(3, "0")}-${role.toUpperCase()}-${String(roleIndex).padStart(2, "0")}`,
      role,
      originalScript,
      normalizedScript: normalizeEquationScript(originalScript),
    };
  })).filter((record) => record.normalizedScript);
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

  await Promise.all(sectionNames.map(async (sectionName) => {
    const xml = await zip.file(sectionName).async("string");
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    if (documentNode.querySelector("parsererror")) return;

    descendants(documentNode.documentElement, "script").forEach((script) => {
      const cleaned = normalizeEquationScript(script.textContent || "");
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
      const ordinal = questions.length + 1;
      const problemEquations = equationRecords(bodyElements, "problem", ordinal);
      const answerEquations = equationRecords([answerParagraph], "answer", ordinal);
      const explanationEquations = equationRecords(explanationParagraphs, "explanation", ordinal);
      questions.push({
        ordinal,
        sourceLabel: meta.label,
        sourceType: meta.type,
        sourceNumber: meta.number,
        sectionName,
        blockStart: meta.start,
        blockEnd: end,
        answerType,
        answer,
        choiceCount: choiceRefs.length,
        warnings,
        questionElements,
        choices: choiceFragments(block),
        explanationElements: explanationParagraphs,
        questionText: textFromElements(questionElements, { skipNotes: true, equationMode: "placeholder" }),
        answerText: plainText(answerParagraph, { equationMode: "placeholder" }).replace("[정답]", "").trim(),
        explanationText: textFromElements(explanationParagraphs, { equationMode: "placeholder" }).replace("[해설]", "").trim(),
        equations: {
          problem: problemEquations,
          answer: answerEquations,
          explanation: explanationEquations,
        },
        bodyXml,
        answerXml,
        explanationXml,
        fullXml,
      });
    }
  }
  return { filename: file.name, questions };
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

function createTemplateStyles(headerDocument) {
  const root = headerDocument.documentElement;
  const charProperties = firstDescendant(root, "charProperties");
  const paraProperties = firstDescendant(root, "paraProperties");
  if (!charProperties || !paraProperties) {
    throw new Error("템플릿 서식을 추가할 header.xml 구조를 찾지 못했습니다.");
  }
  const baseChar = firstDescendant(charProperties, "charPr");
  const basePara = firstDescendant(paraProperties, "paraPr");
  if (!baseChar || !basePara) throw new Error("템플릿의 기준 글자·문단 서식을 찾지 못했습니다.");

  const nextId = (elements) => String(Math.max(...elements.map((element) => Number(element.getAttribute("id")) || 0)) + 1);
  const charElements = descendants(charProperties, "charPr");
  const paraElements = descendants(paraProperties, "paraPr");

  const addCharStyle = ({ height, color = "#000000", bold = false }) => {
    const style = baseChar.cloneNode(true);
    const id = nextId(descendants(charProperties, "charPr"));
    style.setAttribute("id", id);
    style.setAttribute("height", height);
    style.setAttribute("textColor", color);
    descendants(style, "bold").forEach((element) => element.remove());
    if (bold) style.appendChild(headerDocument.createElementNS(style.namespaceURI, `${style.prefix || "hh"}:bold`));
    charProperties.appendChild(style);
    return id;
  };

  const addParaStyle = (alignment, keepWithNext) => {
    const style = basePara.cloneNode(true);
    const id = nextId(descendants(paraProperties, "paraPr"));
    style.setAttribute("id", id);
    const align = firstDescendant(style, "align");
    align?.setAttribute("horizontal", alignment);
    const breakSetting = firstDescendant(style, "breakSetting");
    breakSetting?.setAttribute("keepWithNext", keepWithNext ? "1" : "0");
    paraProperties.appendChild(style);
    return id;
  };

  const styles = {
    titleChar: addCharStyle({ height: "1800", bold: true }),
    metaChar: addCharStyle({ height: "950", color: "#425B62" }),
    bodyChar: addCharStyle({ height: "1050" }),
    centeredPara: addParaStyle("CENTER", true),
    bodyPara: addParaStyle("LEFT", true),
  };
  charProperties.setAttribute("itemCnt", String(charElements.length + 3));
  paraProperties.setAttribute("itemCnt", String(paraElements.length + 2));
  return styles;
}

function createTextParagraph(documentNode, prototype, text, paraPrIDRef, charPrIDRef, idOffset) {
  const prefix = prototype.prefix || "hp";
  const paragraph = documentNode.createElementNS(prototype.namespaceURI, `${prefix}:p`);
  paragraph.setAttribute("id", String(1900000000 + idOffset));
  paragraph.setAttribute("paraPrIDRef", paraPrIDRef);
  paragraph.setAttribute("styleIDRef", prototype.getAttribute("styleIDRef") || "0");
  paragraph.setAttribute("pageBreak", "0");
  paragraph.setAttribute("columnBreak", "0");
  paragraph.setAttribute("merged", "0");
  const run = documentNode.createElementNS(prototype.namespaceURI, `${prefix}:run`);
  run.setAttribute("charPrIDRef", charPrIDRef);
  const textNode = documentNode.createElementNS(prototype.namespaceURI, `${prefix}:t`);
  textNode.textContent = text;
  run.appendChild(textNode);
  paragraph.appendChild(run);
  return paragraph;
}

function removeNamedDescendants(element, names) {
  names.forEach((name) => descendants(element, name).forEach((node) => node.remove()));
}

function prepareStructuralParagraph(documentNode, children, template, forceTwoColumns = false) {
  const source = children.find((child) => firstDescendant(child, "secPr")) || children[0];
  if (!source) throw new Error("구역 설정 문단을 찾을 수 없습니다.");
  const structural = source.cloneNode(true);
  descendants(structural, "t").forEach((node) => { node.textContent = ""; });
  removeNamedDescendants(structural, ["equation", "pic", "tbl"]);

  const pagePr = firstDescendant(structural, "pagePr");
  const margin = pagePr ? firstDescendant(pagePr, "margin") : null;
  if (pagePr) {
    pagePr.setAttribute("landscape", "WIDELY");
    pagePr.setAttribute("width", template.page.width);
    pagePr.setAttribute("height", template.page.height);
  }
  if (margin) {
    ["left", "right", "top", "bottom", "header", "footer"].forEach((name) => {
      margin.setAttribute(name, template.page[name]);
    });
  }
  descendants(structural, "colPr").forEach((column) => {
    column.setAttribute("type", "NEWSPAPER");
    column.setAttribute("layout", "LEFT");
    column.setAttribute("colCount", forceTwoColumns ? "2" : "1");
    column.setAttribute("sameSz", "1");
    column.setAttribute("sameGap", forceTwoColumns ? template.page.columnGap : "0");
  });
  return structural;
}

function createColumnSwitch(documentNode, prototype, paraPrIDRef, charPrIDRef, template) {
  const paragraph = createTextParagraph(documentNode, prototype, "", paraPrIDRef, charPrIDRef, 4);
  const run = firstDescendant(paragraph, "run");
  descendants(run, "t").forEach((element) => element.remove());
  const prefix = prototype.prefix || "hp";
  const control = documentNode.createElementNS(prototype.namespaceURI, `${prefix}:ctrl`);
  const column = documentNode.createElementNS(prototype.namespaceURI, `${prefix}:colPr`);
  column.setAttribute("id", "1900000004");
  column.setAttribute("type", "NEWSPAPER");
  column.setAttribute("layout", "LEFT");
  column.setAttribute("colCount", "2");
  column.setAttribute("sameSz", "1");
  column.setAttribute("sameGap", template.page.columnGap);
  control.appendChild(column);
  run.appendChild(control);
  return paragraph;
}

export async function buildExamHwpx(sourceBytes, questions, selectedOrdinals, template = DEFAULT_EXAM_TEMPLATE) {
  const selected = new Set(selectedOrdinals);
  if (!selected.size) throw new Error("시험지에 넣을 문항을 한 개 이상 선택하세요.");

  const zip = await JSZip.loadAsync(sourceBytes, { checkCRC32: true });
  const overrides = new Map();
  const headerEntry = zip.file("Contents/header.xml");
  if (!headerEntry) throw new Error("Contents/header.xml을 찾을 수 없습니다.");
  const headerDocument = new DOMParser().parseFromString(await headerEntry.async("string"), "application/xml");
  if (headerDocument.querySelector("parsererror")) throw new Error("header.xml 서식을 읽지 못했습니다.");
  const templateStyles = createTemplateStyles(headerDocument);
  overrides.set("Contents/header.xml", new XMLSerializer().serializeToString(headerDocument));
  const sectionNames = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort();

  for (const sectionName of sectionNames) {
    const ranges = questions
      .filter((question) => question.sectionName === sectionName)
      .sort((left, right) => left.blockStart - right.blockStart);
    if (!ranges.length) continue;

    const xml = await zip.file(sectionName).async("string");
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    if (documentNode.querySelector("parsererror")) throw new Error(`${sectionName} XML을 다시 조립하지 못했습니다.`);
    const root = documentNode.documentElement;
    const children = Array.from(root.children);
    const isFirstSelectedSection = sectionName === questions.find((question) => selected.has(question.ordinal))?.sectionName;
    const prototype = children.find((child) => localName(child) === "p") || children[0];
    const kept = [prepareStructuralParagraph(documentNode, children, template, !isFirstSelectedSection)];

    if (isFirstSelectedSection) {
      kept.push(
        createTextParagraph(documentNode, prototype, template.title, templateStyles.centeredPara, templateStyles.titleChar, 1),
        createTextParagraph(documentNode, prototype, template.meta, templateStyles.centeredPara, templateStyles.metaChar, 2),
        createTextParagraph(documentNode, prototype, template.instruction, templateStyles.bodyPara, templateStyles.bodyChar, 3),
        createColumnSwitch(documentNode, prototype, templateStyles.bodyPara, templateStyles.bodyChar, template),
      );
    }

    ranges.filter((question) => selected.has(question.ordinal)).forEach((question) => {
      children.slice(question.blockStart, question.blockEnd).forEach((element) => {
        const clone = element.cloneNode(true);
        removeNamedDescendants(clone, ["secPr", "colPr"]);
        kept.push(clone);
      });
    });

    while (root.firstChild) root.removeChild(root.firstChild);
    kept.forEach((element) => root.appendChild(element));
    overrides.set(sectionName, new XMLSerializer().serializeToString(documentNode));
  }

  return repackHwpx(zip, overrides);
}
