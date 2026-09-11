import { loadArchive } from "./archive.js";
import { parseHwpx, plainText, findTrimmedContentEnd, hasRenderableElementContent } from "./parser.js";

export const GRADED_ESSAY_RULE_ID = "graded-essay-v1";
const UNITS = ["지수·로그", "삼각함수", "수열", "함수의 극한·연속", "미분", "적분"];
const desc = (node, name) => [...node.getElementsByTagNameNS("*", name)];

export function isGradedEssayFilename(filename) {
  return /^서술형_\d+문항_미주해설(?:_[^/]+)?\.hwpx$/u.test(String(filename).normalize("NFC"));
}

export function parseGradedEssayHeading(text) {
  const match = String(text).normalize("NFC").trim().match(/^(.+?) · (.+?) · 난이도 (하|중|상)\s*\|\s*(.+?)\s*\/\s*원문 ((?:순서)?\d+)번$/u);
  if (!match) return null;
  const [, unitName, subtopic, difficultyLabel, sourceType, number] = match;
  const index = UNITS.indexOf(unitName);
  if (index < 0) throw new Error(`서술형 문제은행의 단원을 확인하세요: ${unitName}`);
  return {
    subject: index < 3 ? "수학1" : "수학2",
    unitNumber: String(index + 1).padStart(2, "0"), unitName, subtopic,
    subtopicSource: "heading", sourceType, sourceNumber: Number(number.replace("순서", "")), sourceNumberLabel: number,
    sourceLabel: `${unitName} · ${subtopic} · ${difficultyLabel} | ${sourceType} ${number}번`,
    difficultyLabel, difficulty: { 하: "lv1", 중: "lv2", 상: "lv3" }[difficultyLabel],
  };
}

// 원본 XML의 인덱스를 유지한다. 분류 표제는 복사 범위에서 제외하며 미주 전체를 보존한다.
export async function prepareGradedEssayHwpx(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const analysis = await parseHwpx({ name: file.name, arrayBuffer: async () => bytes });
  const zip = await loadArchive(bytes);
  const sections = new Map();
  for (const q of analysis.questions) {
    if (!sections.has(q.sectionName)) {
      const doc = new DOMParser().parseFromString(await zip.file(q.sectionName).async("string"), "application/xml");
      sections.set(q.sectionName, [...doc.documentElement.children]);
    }
    const children = sections.get(q.sectionName);
    let titleStart = q.anchorIndex - 1;
    while (titleStart >= 0 && !hasRenderableElementContent(children[titleStart])) titleStart -= 1;
    const meta = titleStart < 0 ? null : parseGradedEssayHeading(plainText(children[titleStart], { skipNotes: true }));
    if (!meta) throw new Error(`${q.ordinal}번 문항 앞의 단원·유형·난이도 표제를 읽지 못했습니다.`);
    const notes = desc(children[q.anchorIndex], "endNote");
    if (notes.length !== 1) throw new Error(`${q.ordinal}번 문항의 미주는 하나여야 합니다.`);
    const note = notes[0];
    const noteParagraphs = [...note.children[0].children];
    const rubric = desc(note, "tbl").find((table) => plainText(table).includes("채점 기준"));
    if (!rubric) throw new Error(`${q.ordinal}번 문항의 채점표를 찾지 못했습니다.`);
    const rubricRows = desc(rubric, "tr").slice(1).map((row) => {
      const cells = [...row.children].filter((cell) => cell.localName === "tc");
      return { criterion: plainText(cells[0]), points: Number(plainText(cells[1]).replace(/점\s*$/, "")) };
    });
    const points = rubricRows.reduce((sum, row) => sum + row.points, 0);
    if (points !== 10) throw new Error(`${q.ordinal}번 문항의 채점표 합계가 10점이 아닙니다.`);
    Object.assign(q, meta, {
      titleStart, blockStart: titleStart, copyStart: q.anchorIndex, contentStart: q.anchorIndex,
      preprocessMode: GRADED_ESSAY_RULE_ID, points, rubric: rubricRows,
      answerText: plainText(noteParagraphs[0]).replace(/^정답:\s*/, ""),
      explanationText: noteParagraphs.slice(1).filter((p) => !desc(p, "tbl").length)
        .map((p) => plainText(p)).filter((text) => text && text !== "약술형 채점표").join("\n"),
    });
  }
  analysis.questions.forEach((q, index) => {
    const children = sections.get(q.sectionName);
    const next = analysis.questions[index + 1];
    const end = next?.sectionName === q.sectionName ? next.titleStart : children.length;
    q.copyEnd = findTrimmedContentEnd(children.map((p) => hasRenderableElementContent(p)), q.copyStart, end);
    q.contentEnd = q.blockEnd = q.copyEnd;
    q.questionText = children.slice(q.copyStart, q.copyEnd).map((p) => plainText(p, { skipNotes: true, equationMode: "placeholder" })).filter(Boolean).join("\n");
  });
  const declared = String(file.name).normalize("NFC").match(/^서술형_(\d+)문항_/u);
  if (!analysis.questions.length || (declared && Number(declared[1]) !== analysis.questions.length)) {
    throw new Error(`서술형 문항 수가 일치하지 않습니다: ${analysis.questions.length}문항`);
  }
  return { bytes, analysis: { ...analysis, ruleId: GRADED_ESSAY_RULE_ID } };
}
