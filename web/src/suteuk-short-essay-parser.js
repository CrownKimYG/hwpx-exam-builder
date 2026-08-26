import JSZip from "jszip";
import { findTrimmedContentEnd, plainText } from "./parser.js";

export const SUTEUK_SHORT_ESSAY_PREPROCESS_MODE = "suteuk-short-essay-v1";
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const DIFFICULTY_BY_TYPE = Object.freeze({ 약술법: "유제", 연습문제: "유제", 기본: "lv1", 실력: "lv2", 심화: "lv3" });
const SOURCE_CODE_RE = /\[\d{5}-\d{4}\]/g;
const NON_BODY = new Set(["endNote", "footNote", "header", "footer"]);
const NESTED_LISTS = new Set(["tbl", "tc", "subList", "caption", "drawText", "textart", ...NON_BODY]);
const RENDERABLE = new Set(["equation", "pic", "tbl", "rect", "container", "line", "ellipse", "arc", "polygon", "curve", "connectLine", "ole"]);
const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
const compact = (value) => String(value || "").normalize("NFC").replace(/\s+/g, "");
const sourceCodes = (text) => [...new Set(String(text || "").match(SOURCE_CODE_RE) || [])];

export function suteukDifficultyFromType(type) {
  return DIFFICULTY_BY_TYPE[compact(type)] || "미분류";
}

// DOM에서 검증한 표제와 본문 미주만 입력한다. 표지의 단어 검색으로 분류하지 않는다.
export function parseSuteukShortEssayStructure(paragraphs, sectionName = "Contents/section0.xml") {
  const quickIndex = paragraphs.findIndex((p) => p.quickAnswer);
  const boundary = quickIndex < 0 ? paragraphs.length : quickIndex;
  const anchors = paragraphs.map((p, index) => ({ ...p, index }))
    .filter((p) => p.hasEndnote && p.index < boundary);
  if (!anchors.length) return [];
  let firstHeading = anchors[0].index - 1;
  while (firstHeading >= 0 && !paragraphs[firstHeading].hasContent && !paragraphs[firstHeading].heading) firstHeading -= 1;
  if (!paragraphs[firstHeading]?.heading) {
    throw new Error("[수학] 수능특강의 첫 문항 앞에서 약술법·연습문제·단계 표제를 찾지 못했습니다.");
  }
  let currentHeading = null;
  let pendingHeading = null;
  let pendingStart = null;
  let lessonSubtopic = "";
  const questions = [];
  for (let index = firstHeading; index < boundary; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph.heading) {
      const heading = paragraph.heading;
      if (!Object.hasOwn(DIFFICULTY_BY_TYPE, heading.type)) throw new Error("지원하지 않는 수능특강 표제입니다.");
      if (heading.type === "약술법") lessonSubtopic = heading.subtopic || "";
      if (!["약술법", "연습문제"].includes(heading.type)) lessonSubtopic = "";
      currentHeading = {
        ...heading,
        subtopic: heading.subtopic || (heading.type === "연습문제" ? lessonSubtopic : ""),
        subtopicSource: heading.subtopic ? "heading" : (heading.type === "연습문제" && lessonSubtopic ? "previous-lesson" : "none"),
      };
      pendingHeading = index;
      pendingStart ??= index;
    }
    if (!paragraph.hasEndnote) continue;
    if (paragraph.heading) throw new Error("표제와 미주가 섞인 문단의 분리가 필요합니다.");
    if (paragraph.endnoteCount > 1) throw new Error("한 문단에 미주가 여러 개 있어 문항 경계를 확정할 수 없습니다.");
    questions.push({
      sectionName,
      anchorIndex: index,
      titleStart: pendingHeading,
      blockStart: pendingStart ?? index,
      copyStart: index,
      sourceType: currentHeading.type,
      subtopic: currentHeading.subtopic,
      subtopicSource: currentHeading.subtopicSource,
      difficultyLabel: currentHeading.type,
      difficulty: suteukDifficultyFromType(currentHeading.type),
      headingCodes: pendingStart == null ? [] : paragraphs.slice(pendingStart, index).flatMap((p) => p.heading?.sourceCodes || []),
    });
    pendingHeading = null;
    pendingStart = null;
  }
  const contentFlags = paragraphs.map((p) => p.hasContent || p.hasEndnote);
  questions.forEach((question, index) => {
    const next = questions[index + 1];
    const nextBoundary = next ? next.blockStart : boundary;
    const trailingHeading = paragraphs.findIndex((p, i) => i > question.anchorIndex && i < nextBoundary && p.heading);
    const end = trailingHeading < 0 ? nextBoundary : trailingHeading;
    question.copyEnd = findTrimmedContentEnd(contentFlags, question.copyStart, end);
    question.sourceCodes = [...new Set([
      ...question.headingCodes,
      ...paragraphs.slice(question.copyStart, question.copyEnd).flatMap((p) => sourceCodes(p.text)),
    ])];
    question.sourceCode = question.sourceCodes.length === 1 ? question.sourceCodes[0] : null;
    question.warnings = question.sourceCodes.length > 1 ? ["한 문항에서 출처코드가 여러 개 발견되었습니다."] : [];
    delete question.headingCodes;
  });
  return questions;
}

function ownedByRootParagraph(node, paragraph) {
  let owner = node.parentElement;
  while (owner && owner !== paragraph) {
    if (NESTED_LISTS.has(localName(owner))) return false;
    owner = owner.parentElement;
  }
  return owner === paragraph;
}

function rootNotes(paragraph) {
  if (localName(paragraph) !== "p") return [];
  return descendants(paragraph, "endNote").filter((note) => ownedByRootParagraph(note, paragraph));
}

function bodyNodes(element) {
  const result = [];
  function visit(node) {
    if (NON_BODY.has(localName(node))) return;
    result.push(node);
    Array.from(node.children).forEach(visit);
  }
  visit(element);
  return result;
}

function hasBodyContent(element) {
  return bodyNodes(element).some((node) => (
    localName(node) === "t" ? Boolean(node.textContent.trim()) : RENDERABLE.has(localName(node))
  ));
}

function ownTextNodes(paragraph) {
  return descendants(paragraph, "t").filter((node) => ownedByRootParagraph(node, paragraph));
}

function headingOf(paragraph) {
  if (localName(paragraph) !== "p") return null;
  const matches = bodyNodes(paragraph).filter((node) => (
    ["rect", "tbl"].includes(localName(node)) && ownedByRootParagraph(node, paragraph)
  )).flatMap((object) => {
    const table = localName(object) === "tbl";
    const containers = descendants(object, table ? "tc" : "drawText");
    if (containers.length !== 1) return [];
    const type = compact(plainText(containers[0], { skipNotes: true }));
    if (!(table ? ["기본", "실력", "심화"] : ["약술법", "연습문제"]).includes(type)) return [];
    return [{ type, object }];
  });
  if (matches.length !== 1) return null;
  const match = matches[0];
  const text = ownTextNodes(paragraph).map((node) => node.textContent).join("");
  return {
    ...match,
    subtopic: text.replace(SOURCE_CODE_RE, "").trim(),
    sourceCodes: sourceCodes(text),
  };
}

function clearLineCache(paragraph) {
  Array.from(paragraph.children).filter((node) => localName(node) === "linesegarray").forEach((node) => node.remove());
}

// 기존 혼합 표제는 확인된 표제와 미주 사이의 줄바꿈에서만 나눈다.
function splitMixedHeading(paragraph, heading, note, nextId) {
  const control = note.parentElement;
  const noteRun = control?.parentElement;
  if (localName(control) !== "ctrl" || localName(noteRun) !== "run" || noteRun.parentElement !== paragraph) {
    throw new Error("혼합 표제의 미주 위치를 안전하게 분리할 수 없습니다.");
  }
  const left = paragraph.cloneNode(false);
  const right = paragraph.cloneNode(false);
  right.setAttribute("id", nextId());
  right.setAttribute("pageBreak", "0");
  right.setAttribute("columnBreak", "0");
  let after = false;
  for (const child of Array.from(paragraph.children)) {
    if (localName(child) === "linesegarray") continue;
    if (child !== noteRun) {
      (after ? right : left).appendChild(child.cloneNode(true));
      continue;
    }
    const beforeRun = child.cloneNode(false);
    const afterRun = child.cloneNode(false);
    for (const item of Array.from(child.children)) {
      if (item === control) after = true;
      (after ? afterRun : beforeRun).appendChild(item.cloneNode(true));
    }
    if (beforeRun.children.length) left.appendChild(beforeRun);
    if (afterRun.children.length) right.appendChild(afterRun);
  }
  const leftHeading = headingOf(left);
  const lastText = ownTextNodes(left).at(-1);
  const endsWithBreak = lastText && (lastText.lastChild?.localName === "lineBreak" || /[\r\n]\s*$/.test(lastText.textContent));
  const prefixObjects = bodyNodes(left).filter((node) => RENDERABLE.has(localName(node)) && ownedByRootParagraph(node, left));
  if (!leftHeading || leftHeading.type !== heading.type || !endsWithBreak || prefixObjects.length !== 1) {
    throw new Error("표제와 문제의 경계가 모호합니다. 원본에서 표제 문단을 분리한 뒤 다시 추가하세요.");
  }
  // 이동 대상은 복제 문서뿐이며 원본 파일과 미주 내부는 바꾸지 않는다.
  paragraph.replaceWith(left, right);
}

function insertHeadingCode(paragraph, code, charPrIDRef) {
  const note = rootNotes(paragraph)[0];
  const control = note?.parentElement;
  const run = control?.parentElement;
  if (!run || localName(run) !== "run" || run.parentElement !== paragraph) {
    throw new Error("출처코드를 연결할 본문 미주를 찾지 못했습니다.");
  }
  const documentNode = paragraph.ownerDocument;
  const prefix = run.prefix || "hp";
  const codeRun = documentNode.createElementNS(run.namespaceURI, `${prefix}:run`);
  codeRun.setAttribute("charPrIDRef", charPrIDRef || run.getAttribute("charPrIDRef") || "0");
  const text = documentNode.createElementNS(run.namespaceURI, `${prefix}:t`);
  text.appendChild(documentNode.createTextNode(` ${code}`));
  text.appendChild(documentNode.createElementNS(run.namespaceURI, `${prefix}:lineBreak`));
  codeRun.appendChild(text);
  const tail = run.cloneNode(false);
  while (control.nextSibling) tail.appendChild(control.nextSibling);
  run.after(codeRun);
  if (tail.childNodes.length) codeRun.after(tail);
  clearLineCache(paragraph);
}

function paragraphIdAllocator(documentNode) {
  let next = Math.max(0, ...descendants(documentNode.documentElement, "p").map((p) => Number(p.getAttribute("id")) || 0)) + 1;
  return () => String(next++);
}

function describeParagraph(paragraph) {
  const heading = headingOf(paragraph);
  const notes = rootNotes(paragraph);
  const text = plainText(paragraph, { skipNotes: true, equationMode: "placeholder" });
  return {
    heading: heading && { type: heading.type, subtopic: heading.subtopic, sourceCodes: heading.sourceCodes },
    hasEndnote: notes.length > 0,
    endnoteCount: notes.length,
    hasContent: hasBodyContent(paragraph),
    text,
    quickAnswer: compact(ownTextNodes(paragraph).map((node) => node.textContent).join("")) === "[빠른정답]",
  };
}

export async function prepareSuteukShortEssayHwpx(file) {
  if (!/\.hwpx$/i.test(file.name)) throw new Error(".hwpx 파일만 사용할 수 있습니다.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
  const totalSize = Object.values(zip.files).reduce((sum, entry) => sum + (entry._data?.uncompressedSize || 0), 0);
  if (totalSize > MAX_UNCOMPRESSED_BYTES) throw new Error("압축 해제 크기가 허용 범위를 초과합니다.");
  const sections = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!sections.length) throw new Error("본문 section XML을 찾을 수 없습니다.");
  const questions = [];
  const warnings = [];
  let quickAnswerCount = null;
  for (const sectionName of sections) {
    const documentNode = new DOMParser().parseFromString(await zip.file(sectionName).async("string"), "application/xml");
    const error = documentNode.querySelector("parsererror");
    if (error) throw new Error(`XML 파싱 오류: ${error.textContent}`);
    const root = documentNode.documentElement;
    const nextId = paragraphIdAllocator(documentNode);
    for (const paragraph of Array.from(root.children)) {
      const heading = headingOf(paragraph);
      const notes = rootNotes(paragraph);
      if (heading && notes.length) splitMixedHeading(paragraph, heading, notes[0], nextId);
    }
    const children = Array.from(root.children);
    const descriptions = children.map(describeParagraph);
    const descriptors = parseSuteukShortEssayStructure(descriptions, sectionName);
    for (const descriptor of descriptors) {
      const headingParagraph = children[descriptor.titleStart];
      const heading = headingParagraph && headingOf(headingParagraph);
      if (descriptor.sourceCodes.length) {
        const bodyCodes = sourceCodes(children.slice(descriptor.copyStart, descriptor.copyEnd)
          .map((p) => plainText(p, { skipNotes: true })).join("\n"));
        const codeText = heading && ownTextNodes(headingParagraph).find((node) => sourceCodes(node.textContent).length);
        const missing = descriptor.sourceCodes.filter((code) => !bodyCodes.includes(code));
        if (missing.length) insertHeadingCode(children[descriptor.anchorIndex], missing.join(" "), codeText?.parentElement.getAttribute("charPrIDRef"));
      }
      const ordinal = questions.length + 1;
      const questionText = children.slice(descriptor.copyStart, descriptor.copyEnd)
        .map((p) => plainText(p, { skipNotes: true, equationMode: "placeholder" })).filter(Boolean).join("\n");
      const note = rootNotes(children[descriptor.anchorIndex])[0];
      if (!plainText(note).includes("풀이")) descriptor.warnings.push("원본 미주에서 풀이 표지를 찾지 못했습니다.");
      questions.push({
        ...descriptor,
        ordinal,
        sourceNumber: ordinal,
        sourceLabel: `${descriptor.sourceType} ${ordinal}${descriptor.subtopic ? ` · ${descriptor.subtopic}` : ""}`,
        blockEnd: descriptor.copyEnd,
        contentStart: descriptor.copyStart,
        contentEnd: descriptor.copyEnd,
        copyMode: "root-endnote-block",
        preprocessMode: SUTEUK_SHORT_ESSAY_PREPROCESS_MODE,
        hasEndnote: true,
        answerType: "original",
        answer: null,
        choiceCount: null,
        choiceElementIndexes: [],
        questionElements: [],
        choices: [],
        answerElement: null,
        explanationElements: [],
        questionText,
        answerText: "",
        explanationText: "",
        equations: { problem: [], answer: [], explanation: [] },
        bodyXml: "", answerXml: "", explanationXml: "", fullXml: "",
      });
    }
    const quickIndex = descriptions.findIndex((p) => p.quickAnswer);
    if (quickIndex >= 0) {
      quickAnswerCount = (quickAnswerCount || 0) + descriptions.slice(quickIndex + 1).filter((p) => p.hasContent && !p.hasEndnote).length;
    }
    zip.file(sectionName, new XMLSerializer().serializeToString(documentNode));
  }
  if (!questions.length) throw new Error("[수학] 수능특강의 표제·본문 미주 구조를 찾지 못했습니다.");
  const byCode = new Map();
  questions.forEach((question) => question.sourceCodes.forEach((code) => {
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(question);
  }));
  byCode.forEach((matches, code) => {
    if (matches.length < 2) return;
    const warning = `출처코드 ${code} 중복: ${matches.map((q) => q.ordinal).join("·")}번 (문항은 각각 유지)`;
    warnings.push(warning);
    matches.forEach((q) => q.warnings.push(warning));
  });
  if (quickAnswerCount != null && quickAnswerCount !== questions.length) {
    const warning = `빠른정답 ${quickAnswerCount}개와 본문·미주 ${questions.length}개가 다릅니다. 본문 미주를 사용합니다.`;
    warnings.push(warning);
    questions[0].warnings.push(warning);
  }
  return {
    bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 3 } }),
    analysis: { filename: file.name, ruleId: SUTEUK_SHORT_ESSAY_PREPROCESS_MODE, preprocessMode: SUTEUK_SHORT_ESSAY_PREPROCESS_MODE, questions, warnings },
  };
}
