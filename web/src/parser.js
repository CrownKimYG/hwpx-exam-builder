import JSZip from "jszip";
import { difficultyFromLabel } from "./bank-model.js";
import { coverZocboWatermark } from "./image-watermark.js";

const TITLE_RE = /❙\s*(예제|유제|기초연습|기본연습|실력완성)\s*(\d+)\s*(유사유형)?/;
const DIFFICULTY_RE = /(예제|유제|기초(?:연습)?|기본(?:연습)?|실력(?:완성)?)/;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const WATERMARK_MARKER_RE = /(?:족보닷컴\s*\(\s*zocbo\.com\s*\)|zocbo\.com)/i;
const WATERMARK_PREFIX_RE = /(?:\s+from\s*)?={20,}\s*$/i;

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
const NON_ROOT_LIST_CONTAINERS = new Set(["tbl", "tc", "subList", "caption", "drawText", "textart"]);

function rootListEndnote(element) {
  if (localName(element) !== "p") return null;
  return descendants(element, "endNote").find((note) => {
    let ancestor = note.parentElement;
    while (ancestor && ancestor !== element) {
      if (NON_ROOT_LIST_CONTAINERS.has(localName(ancestor))) return false;
      ancestor = ancestor.parentElement;
    }
    return ancestor === element;
  }) || null;
}

export function equationScript(equation) {
  const script = firstDescendant(equation, "script");
  return script?.textContent?.trim() || "";
}

export function normalizeWatermarkText(value) {
  const source = String(value || "");
  const markerIndex = source.search(WATERMARK_MARKER_RE);
  if (markerIndex < 0) return source;
  const prefix = source.slice(0, markerIndex);
  const delimiter = prefix.match(WATERMARK_PREFIX_RE);
  return prefix.slice(0, delimiter?.index ?? prefix.length).trimEnd();
}

export function normalizeEquationScript(script) {
  return normalizeWatermarkText(script).trim();
}

function isInsideNamedElement(node, boundary, name) {
  let current = node.parentElement;
  while (current && current !== boundary) {
    if (localName(current) === name) return true;
    current = current.parentElement;
  }
  return false;
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

export function hasRenderableElementContent(element, { skipNotes = true } = {}) {
  if (plainText(element, { skipNotes, equationMode: "placeholder" })) return true;
  return ["pic", "tbl"].some((name) => descendants(element, name).some((node) => (
    !skipNotes || !isInsideNamedElement(node, element, "endNote")
  )));
}

function trimmedQuestionContentEnd(children, start, end) {
  const contentFlags = children.map((element) => (
    hasRenderableElementContent(element, { skipNotes: true })
  ));
  return findTrimmedContentEnd(contentFlags, start, end);
}

export function findTrimmedContentEnd(contentFlags, start = 0, end = contentFlags.length) {
  let trimmedEnd = end;
  while (trimmedEnd > start && !contentFlags[trimmedEnd - 1]) trimmedEnd -= 1;
  return trimmedEnd;
}

function textFromElements(elements, options = {}) {
  return elements.map((element) => plainText(element, options)).filter(Boolean).join("\n").trim();
}

function withoutEndnotes(element) {
  const clone = element.cloneNode(true);
  descendants(clone, "endNote").forEach((note) => note.remove());
  return clone;
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

    descendants(documentNode.documentElement, "p").forEach((paragraph) => {
      const textNodes = descendants(paragraph, "t").filter((textNode) => {
        let owner = textNode.parentElement;
        while (owner && localName(owner) !== "p") owner = owner.parentElement;
        return owner === paragraph;
      });
      const original = textNodes.map((textNode) => textNode.textContent || "").join("");
      const cleaned = normalizeWatermarkText(original);
      if (cleaned === original) return;
      let offset = 0;
      textNodes.forEach((textNode) => {
        const value = textNode.textContent || "";
        const keep = Math.max(0, Math.min(value.length, cleaned.length - offset));
        textNode.textContent = value.slice(0, keep);
        offset += value.length;
      });
    });

    descendants(documentNode.documentElement, "t").forEach((textNode) => {
      if ((textNode.textContent || "").trim().toLowerCase() === "zb") textNode.textContent = "";
    });
    // 원본 그림은 종류나 파일명과 관계없이 그대로 유지한다.
    zip.file(sectionName, new XMLSerializer().serializeToString(documentNode));
  }));

  const imageTypes = new Map([
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
  ]);
  const imageNames = Object.keys(zip.files).filter((name) => {
    const extension = name.split(".").pop()?.toLowerCase();
    return name.startsWith("BinData/") && imageTypes.has(extension);
  });
  for (const imageName of imageNames) {
    const entry = zip.file(imageName);
    const extension = imageName.split(".").pop().toLowerCase();
    const original = await entry.async("uint8array");
    try {
      const result = await coverZocboWatermark(original, imageTypes.get(extension));
      if (result.bounds) zip.file(imageName, result.bytes);
    } catch {
      // 읽지 못하는 그림은 원본을 유지해 미리보기 전체가 실패하지 않게 한다.
    }
  }

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
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
      .map((child, index) => ({ index, child, note: rootListEndnote(child) }))
      .filter((item) => item.note);
    const metadata = anchors.map(({ index }, position) => {
      const lowerBound = position > 0 ? anchors[position - 1].index + 1 : 0;
      let title = null;
      for (let candidate = index - 1; candidate >= lowerBound; candidate -= 1) {
        const match = plainText(children[candidate], { skipNotes: true }).match(TITLE_RE);
        if (match) {
          title = {
            start: candidate,
            contentStart: candidate + 1,
            hasTitle: true,
            label: match[0].trim(),
            type: match[1],
            number: Number(match[2]),
          };
          break;
        }
      }
      let difficultyLabel = "";
      for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
        const match = plainText(children[candidate], { skipNotes: true }).match(DIFFICULTY_RE);
        if (match) {
          difficultyLabel = match[1];
          break;
        }
      }
      const fallback = {
        start: index,
        contentStart: index,
        hasTitle: false,
        label: `문항 ${questions.length + position + 1}`,
        type: "미분류",
        number: 0,
      };
      const resolved = title || fallback;
      return {
        ...resolved,
        difficultyLabel: difficultyLabel || resolved.type,
        difficulty: difficultyFromLabel(difficultyLabel || resolved.type),
      };
    });

    for (let position = 0; position < anchors.length; position += 1) {
      const { index: anchorIndex, child: anchor, note } = anchors[position];
      const meta = metadata[position];
      let end = position + 1 < metadata.length ? metadata[position + 1].start : children.length;
      if (position + 1 === metadata.length) {
        const trailingBoundary = children.findIndex((child, childIndex) => {
          if (childIndex <= anchorIndex) return false;
          if (child.getAttribute("pageBreak") === "1") return true;
          return Boolean(firstDescendant(child, "secPr"));
        });
        if (trailingBoundary >= 0) end = trailingBoundary;
      }
      const contentStart = Math.min(meta.contentStart, end);
      const contentEnd = trimmedQuestionContentEnd(children, contentStart, end);
      const copyElements = children.slice(contentStart, contentEnd);
      const questionElements = copyElements
        .map(withoutEndnotes)
        .filter((element) => hasRenderableElementContent(element, { skipNotes: true }));
      const ordinal = questions.length + 1;
      questions.push({
        ordinal,
        sourceLabel: meta.label,
        sourceType: meta.type,
        sourceNumber: meta.number,
        difficultyLabel: meta.difficultyLabel,
        difficulty: meta.difficulty,
        sectionName,
        anchorIndex,
        titleStart: meta.hasTitle ? meta.start : null,
        blockStart: meta.start,
        blockEnd: contentEnd,
        contentStart,
        contentEnd,
        copyMode: "root-endnote-block",
        copyStart: contentStart,
        copyEnd: contentEnd,
        hasEndnote: true,
        answerType: "original",
        answer: null,
        choiceCount: null,
        choiceElementIndexes: [],
        warnings: [],
        questionElements,
        choices: [],
        answerElement: null,
        explanationElements: [],
        questionText: textFromElements(questionElements, { skipNotes: true, equationMode: "placeholder" }),
        answerText: "",
        explanationText: "",
        equations: { problem: [], answer: [], explanation: [] },
        bodyXml: "",
        answerXml: "",
        explanationXml: "",
        fullXml: "",
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
