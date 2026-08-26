import test from "node:test";
import assert from "node:assert/strict";
import { parseSuteukShortEssayStructure, suteukDifficultyFromType } from "./suteuk-short-essay-parser.js";

const text = (value, extra = {}) => ({ text: value, hasContent: Boolean(value), ...extra });
const heading = (type, subtopic = "", codes = []) => text(type, { heading: { type, subtopic, sourceCodes: codes } });
const question = (value = "문제") => text(value, { hasEndnote: true, endnoteCount: 1 });

test("수능특강의 유형별 난이도는 기존 수학 방식과 독립적이다", () => {
  assert.deepEqual(["약술법", "연습문제", "기 본", "실 력", "심 화"].map(suteukDifficultyFromType), ["유제", "유제", "lv1", "lv2", "lv3"]);
  assert.equal(suteukDifficultyFromType("기본편"), "미분류");
});

test("표지 기본편을 제외하고 다음 표제 직전까지 문제·조건·그림을 포함한다", () => {
  const parsed = parseSuteukShortEssayStructure([
    text("기본편"), text("학습 안내"), heading("약술법", "함수의 극한"), question(),
    text("<보기>"), text("", { hasContent: true }), text(""),
    heading("연습문제"), question("[26009-0001]"), text("뒤 문단에서 시작하는 문제"), text(""),
    heading("기본"), question(), question(), text("[빠른정답]", { quickAnswer: true }), question("답 영역의 미주"),
  ]);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed.map((q) => [q.copyStart, q.copyEnd]), [[3, 6], [8, 10], [12, 13], [13, 14]]);
  assert.deepEqual(parsed.map((q) => q.difficulty), ["유제", "유제", "lv1", "lv1"]);
  assert.equal(parsed[1].subtopic, "함수의 극한");
  assert.equal(parsed[1].subtopicSource, "previous-lesson");
  assert.equal(parsed[1].sourceCode, "[26009-0001]");
  assert.equal(parsed[2].subtopic, "");
});

test("소주제가 없는 약술법과 연습문제도 각각 보존한다", () => {
  const parsed = parseSuteukShortEssayStructure([
    heading("약술법", "첫 소주제"), question(), heading("약술법"), question(),
    heading("연습문제"), question(), question(), heading("심화"), question(),
  ]);
  assert.equal(parsed.length, 5);
  assert.deepEqual(parsed.slice(1, 4).map((q) => q.subtopic), ["", "", ""]);
  assert.equal(parsed[4].difficulty, "lv3");
});

test("표제의 출처코드는 바로 뒤 문항에만 연결하고 중복 문항을 없애지 않는다", () => {
  const parsed = parseSuteukShortEssayStructure([
    heading("연습문제", "", ["[26009-0001]"]), question(), question("[26009-0001] 문제"),
    heading("실력"), question(),
  ]);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((q) => q.sourceCode), ["[26009-0001]", "[26009-0001]", null]);
});

test("분류 경계를 넘는 페이지 나누기와 여러 표제는 문항 본문으로 복사하지 않는다", () => {
  const parsed = parseSuteukShortEssayStructure([
    heading("약술법"), question(), text("다음 페이지 조건", { pageBreak: true }),
    heading("기본"), heading("실력"), question(), heading("심화"), text(""),
  ]);
  assert.deepEqual(parsed.map((q) => [q.copyStart, q.copyEnd]), [[1, 3], [5, 6]]);
  assert.equal(parsed[1].sourceType, "실력");
});

test("파일명만 같은 자료, 표지에서 떨어진 표제, 모호한 미주는 거부한다", () => {
  assert.throws(() => parseSuteukShortEssayStructure([text("기본편"), question()]), /첫 문항 앞/);
  assert.throws(() => parseSuteukShortEssayStructure([heading("기본"), text("학습 안내"), question()]), /첫 문항 앞/);
  assert.throws(() => parseSuteukShortEssayStructure([heading("기본"), question("문제"), text("문제", { hasEndnote: true, endnoteCount: 2 })]), /미주가 여러 개/);
  assert.deepEqual(parseSuteukShortEssayStructure([text("[빠른정답]", { quickAnswer: true }), text("12")]), []);
});
