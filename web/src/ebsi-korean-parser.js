import JSZip from "jszip";
import { hasRenderableElementContent, plainText } from "./parser.js";

export const EBSI_KOREAN_PREPROCESS_MODE = "ebsi-endnote-v1";

const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const PASSAGE_MARKER_RE = /^\[(\d{1,3})[~～](\d{1,3})\]\[지문\]$/;
const PASSAGE_METADATA_RE = /#번\d{1,3}[~～]\d{1,3}#문항코드$/;
const QUESTION_METADATA_RE = /#번(\d{1,3})#문항코드([A-Za-z0-9]+-\d+)/;

function compact(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function trimRange(texts, start, end, contentFlags = null) {
  const hasContent = (index) => (
    Boolean(String(texts[index] || "").trim()) || Boolean(contentFlags?.[index])
  );
  let first = start;
  let last = end;
  while (first < last && !hasContent(first)) first += 1;
  while (last > first && !hasContent(last - 1)) last -= 1;
  return { start: first, end: last };
}

function findExactLabel(texts, label, start, end) {
  for (let index = start; index < end; index += 1) {
    if (compact(texts[index]) === label) return index;
  }
  return -1;
}

function passageBlockStart(texts, markerIndex, previousMarkerIndex = -1) {
  const lowerBound = Math.max(previousMarkerIndex + 1, markerIndex - 5, 0);
  for (let index = markerIndex - 1; index >= lowerBound; index -= 1) {
    if (PASSAGE_METADATA_RE.test(compact(texts[index]))) return index;
  }
  return markerIndex;
}

export function parseEbsiKoreanStructure(
  texts,
  sectionName = "Contents/section0.xml",
  contentFlags = null,
) {
  const normalized = texts.map((value) => String(value || "").trim());
  const markers = normalized
    .map((value, index) => ({ index, match: compact(value).match(PASSAGE_MARKER_RE) }))
    .filter((item) => item.match);
  const groups = markers.map((marker, index) => ({
    markerIndex: marker.index,
    blockStart: passageBlockStart(normalized, marker.index, markers[index - 1]?.index),
    rangeStart: Number(marker.match[1]),
    rangeEnd: Number(marker.match[2]),
    rangeLabel: normalized[marker.index],
    passageGroupId: `${sectionName}:${marker.index}`,
  }));
  groups.forEach((group, index) => {
    group.blockEnd = groups[index + 1]?.blockStart ?? normalized.length;
  });

  const questions = [];
  const warnings = [];
  groups.forEach((group) => {
    const questionMarkers = [];
    for (let index = group.markerIndex + 1; index < group.blockEnd; index += 1) {
      const match = compact(normalized[index]).match(QUESTION_METADATA_RE);
      if (match) questionMarkers.push({ index, match });
    }
    if (!questionMarkers.length) {
      warnings.push(`${group.rangeLabel} 뒤에서 문항코드를 찾지 못했습니다.`);
      return;
    }

    const firstQuestionIndex = questionMarkers[0].index;
    const passageExplanationLabel = findExactLabel(
      normalized,
      "[해설]",
      group.markerIndex + 1,
      firstQuestionIndex,
    );
    const passage = trimRange(
      normalized,
      group.markerIndex + 1,
      passageExplanationLabel >= 0 ? passageExplanationLabel : firstQuestionIndex,
      contentFlags,
    );
    const passageExplanation = passageExplanationLabel >= 0
      ? trimRange(normalized, passageExplanationLabel, firstQuestionIndex, contentFlags)
      : { start: firstQuestionIndex, end: firstQuestionIndex };

    questionMarkers.forEach((marker, position) => {
      const nextBoundary = questionMarkers[position + 1]?.index ?? group.blockEnd;
      const problemLabel = findExactLabel(normalized, "[문제]", marker.index + 1, nextBoundary);
      const answerLabel = findExactLabel(
        normalized,
        "[정답/모범답안]",
        problemLabel >= 0 ? problemLabel + 1 : marker.index + 1,
        nextBoundary,
      );
      const explanationLabel = findExactLabel(
        normalized,
        "[해설]",
        answerLabel >= 0 ? answerLabel + 1 : marker.index + 1,
        nextBoundary,
      );
      const questionWarnings = [];
      if (problemLabel < 0) questionWarnings.push("[문제] 표식 누락");
      if (answerLabel < 0) questionWarnings.push("[정답/모범답안] 표식 누락");
      if (explanationLabel < 0) questionWarnings.push("[해설] 표식 누락");

      const problem = trimRange(
        normalized,
        problemLabel >= 0 ? problemLabel + 1 : marker.index + 1,
        answerLabel >= 0 ? answerLabel : nextBoundary,
        contentFlags,
      );
      const answer = answerLabel >= 0
        ? trimRange(
          normalized,
          answerLabel,
          explanationLabel >= 0 ? explanationLabel : nextBoundary,
          contentFlags,
        )
        : { start: nextBoundary, end: nextBoundary };
      const explanation = explanationLabel >= 0
        ? trimRange(normalized, explanationLabel, nextBoundary, contentFlags)
        : { start: nextBoundary, end: nextBoundary };

      questions.push({
        sectionName,
        passageGroupId: group.passageGroupId,
        passageRangeLabel: group.rangeLabel,
        passageStart: passage.start,
        passageEnd: passage.end,
        passageExplanationStart: passageExplanation.start,
        passageExplanationEnd: passageExplanation.end,
        metadataIndex: marker.index,
        sourceNumber: Number(marker.match[1]),
        sourceCode: marker.match[2],
        copyStart: problem.start,
        copyEnd: problem.end,
        answerStart: answer.start,
        answerEnd: answer.end,
        explanationStart: explanation.start,
        explanationEnd: explanation.end,
        blockStart: marker.index,
        blockEnd: explanation.end,
        warnings: questionWarnings,
      });
    });
  });
  return { groups, questions, warnings };
}

function textFromRange(texts, start, end, labels = []) {
  return texts.slice(start, end)
    .map((value) => String(value || "").trim())
    .filter((value) => value && !labels.includes(compact(value)))
    .join("\n")
    .trim();
}

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) => Array.from(element.getElementsByTagNameNS("*", name));

function hpElement(documentNode, reference, name) {
  const namespace = reference.namespaceURI;
  const prefix = reference.prefix || "hp";
  return documentNode.createElementNS(namespace, `${prefix}:${name}`);
}

function replaceFirstLabel(elements, source, replacement) {
  const textNode = elements.flatMap((element) => descendants(element, "t"))
    .find((node) => (node.textContent || "").includes(source));
  if (textNode) {
    textNode.textContent = textNode.textContent.replace(source, replacement);
    return true;
  }
  return false;
}

function cleanEndnoteParagraph(paragraph) {
  descendants(paragraph, "secPr").forEach((node) => node.remove());
  descendants(paragraph, "colPr").forEach((node) => node.remove());
  descendants(paragraph, "linesegarray").forEach((node) => node.remove());
  paragraph.setAttribute("pageBreak", "0");
  paragraph.setAttribute("columnBreak", "0");
}

function addEndnoteNumber(documentNode, paragraph, number) {
  let run = descendants(paragraph, "run")[0];
  if (!run) {
    run = hpElement(documentNode, paragraph, "run");
    paragraph.insertBefore(run, paragraph.firstChild);
  }
  const control = hpElement(documentNode, paragraph, "ctrl");
  const autoNumber = hpElement(documentNode, paragraph, "autoNum");
  autoNumber.setAttribute("num", String(number));
  autoNumber.setAttribute("numType", "ENDNOTE");
  const format = hpElement(documentNode, paragraph, "autoNumFormat");
  format.setAttribute("type", "DIGIT");
  format.setAttribute("userChar", "");
  format.setAttribute("prefixChar", "");
  format.setAttribute("suffixChar", ")");
  format.setAttribute("supscript", "0");
  autoNumber.appendChild(format);
  control.appendChild(autoNumber);
  run.insertBefore(control, run.firstChild);
}

function instanceIdAllocator(documentNode) {
  const used = new Set();
  Array.from(documentNode.getElementsByTagName("*")).forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLowerCase() === "instid") used.add(attribute.value);
    });
  });
  let candidate = 4_000_000_000;
  return () => {
    while (used.has(String(candidate))) candidate -= 1;
    const value = String(candidate);
    used.add(value);
    candidate -= 1;
    return value;
  };
}

function attachEndnote(documentNode, children, descriptor, number, nextInstanceId) {
  const problemElements = children.slice(descriptor.copyStart, descriptor.copyEnd);
  const anchor = [...problemElements].reverse().find((element) => localName(element) === "p");
  if (!anchor) throw new Error(`${descriptor.sourceCode}의 미주를 연결할 문제 문단이 없습니다.`);
  let anchorRun = [...descendants(anchor, "run")].reverse()[0];
  if (!anchorRun) {
    anchorRun = hpElement(documentNode, anchor, "run");
    anchor.appendChild(anchorRun);
  }

  const answer = children.slice(descriptor.answerStart, descriptor.answerEnd)
    .filter((element) => localName(element) === "p")
    .map((element) => element.cloneNode(true));
  const explanation = children.slice(descriptor.explanationStart, descriptor.explanationEnd)
    .filter((element) => localName(element) === "p")
    .map((element) => element.cloneNode(true));
  const passageExplanation = children
    .slice(descriptor.passageExplanationStart, descriptor.passageExplanationEnd)
    .filter((element) => localName(element) === "p")
    .map((element) => element.cloneNode(true));
  if (!answer.length) throw new Error(`${descriptor.sourceCode}의 [정답/모범답안] 문단이 없습니다.`);
  if (!explanation.length) throw new Error(`${descriptor.sourceCode}의 [해설] 문단이 없습니다.`);
  if (!replaceFirstLabel(answer, "[정답/모범답안]", "[정답]")) {
    throw new Error(`${descriptor.sourceCode}의 정답 표식을 미주로 변환하지 못했습니다.`);
  }
  replaceFirstLabel(passageExplanation, "[해설]", "[지문 해설]");

  const paragraphs = [...answer, ...explanation, ...passageExplanation];
  paragraphs.forEach(cleanEndnoteParagraph);
  addEndnoteNumber(documentNode, paragraphs[0], number);

  const control = hpElement(documentNode, anchor, "ctrl");
  const endnote = hpElement(documentNode, anchor, "endNote");
  endnote.setAttribute("number", String(number));
  endnote.setAttribute("suffixChar", "41");
  endnote.setAttribute("instId", nextInstanceId());
  const subList = hpElement(documentNode, anchor, "subList");
  Object.entries({
    id: "",
    textDirection: "HORIZONTAL",
    lineWrap: "BREAK",
    vertAlign: "TOP",
    linkListIDRef: "0",
    linkListNextIDRef: "0",
    textWidth: "0",
    textHeight: "0",
    hasTextRef: "0",
    hasNumRef: "0",
  }).forEach(([name, value]) => subList.setAttribute(name, value));
  paragraphs.forEach((paragraph) => subList.appendChild(paragraph));
  endnote.appendChild(subList);
  control.appendChild(endnote);
  anchorRun.appendChild(control);
}

function multipleChoiceAnswer(answerText) {
  const digit = answerText.match(/^\s*([1-5])\s*$/)?.[1];
  if (digit) return digit;
  const symbol = answerText.match(/[①②③④⑤]/)?.[0];
  return symbol ? String("①②③④⑤".indexOf(symbol) + 1) : null;
}

export async function prepareEbsiKoreanHwpx(file) {
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
  const analysisWarnings = [];
  let endnoteNumber = 0;
  for (const sectionName of sectionNames) {
    const xml = await zip.file(sectionName).async("string");
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    const parseError = documentNode.querySelector("parsererror");
    if (parseError) throw new Error(`XML 파싱 오류: ${parseError.textContent}`);
    const children = Array.from(documentNode.documentElement.children);
    const texts = children.map((child) => plainText(child, { skipNotes: true, equationMode: "placeholder" }));
    const contentFlags = children.map((child) => hasRenderableElementContent(child, { skipNotes: true }));
    const structure = parseEbsiKoreanStructure(texts, sectionName, contentFlags);
    const nextInstanceId = instanceIdAllocator(documentNode);
    analysisWarnings.push(...structure.warnings);

    structure.questions.forEach((descriptor) => {
      endnoteNumber += 1;
      attachEndnote(documentNode, children, descriptor, endnoteNumber, nextInstanceId);
      const ordinal = questions.length + 1;
      const questionText = textFromRange(texts, descriptor.copyStart, descriptor.copyEnd);
      const answerText = textFromRange(
        texts,
        descriptor.answerStart,
        descriptor.answerEnd,
        ["[정답/모범답안]"],
      );
      const explanationText = textFromRange(
        texts,
        descriptor.explanationStart,
        descriptor.explanationEnd,
        ["[해설]"],
      );
      const choiceMatches = questionText.match(/[①②③④⑤]/g) || [];
      const uniqueChoices = new Set(choiceMatches);
      const numericAnswer = multipleChoiceAnswer(answerText);
      questions.push({
        ordinal,
        sourceLabel: descriptor.sourceCode,
        sourceType: "EBSi 국어",
        sourceNumber: descriptor.sourceNumber,
        sourceCode: descriptor.sourceCode,
        difficultyLabel: "미분류",
        difficulty: "미분류",
        sectionName,
        anchorIndex: descriptor.metadataIndex,
        titleStart: null,
        blockStart: descriptor.blockStart,
        blockEnd: descriptor.blockEnd,
        contentStart: descriptor.copyStart,
        contentEnd: descriptor.copyEnd,
        copyMode: "root-endnote-block",
        preprocessMode: EBSI_KOREAN_PREPROCESS_MODE,
        copyStart: descriptor.copyStart,
        copyEnd: descriptor.copyEnd,
        passageGroupId: descriptor.passageGroupId,
        passageRangeLabel: descriptor.passageRangeLabel,
        passageStart: descriptor.passageStart,
        passageEnd: descriptor.passageEnd,
        passageExplanationStart: descriptor.passageExplanationStart,
        passageExplanationEnd: descriptor.passageExplanationEnd,
        answerStart: descriptor.answerStart,
        answerEnd: descriptor.answerEnd,
        explanationStart: descriptor.explanationStart,
        explanationEnd: descriptor.explanationEnd,
        hasEndnote: true,
        answerType: uniqueChoices.size === 5 && numericAnswer ? "multiple_choice" : "short_answer",
        answer: numericAnswer || answerText,
        choiceCount: uniqueChoices.size || null,
        choiceElementIndexes: children
          .map((_, index) => index)
          .filter((index) => index >= descriptor.copyStart && index < descriptor.copyEnd)
          .filter((index) => /[①②③④⑤]/.test(texts[index])),
        warnings: [...descriptor.warnings],
        questionElements: [],
        choices: [],
        answerElement: null,
        explanationElements: [],
        questionText,
        answerText,
        explanationText,
        equations: { problem: [], answer: [], explanation: [] },
        bodyXml: "",
        answerXml: "",
        explanationXml: "",
        fullXml: "",
      });
    });
    zip.file(sectionName, new XMLSerializer().serializeToString(documentNode));
  }
  if (!questions.length) throw new Error("EBSi 국어의 [지문]·[문제] 구조를 찾지 못했습니다.");
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
  return {
    bytes,
    analysis: { filename: file.name, questions, warnings: analysisWarnings },
  };
}
