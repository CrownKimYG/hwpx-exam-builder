import test from "node:test";
import assert from "node:assert/strict";
import { parseGradedEssayHeading, isGradedEssayFilename, GRADED_ESSAY_RULE_ID } from "./graded-essay-parser.js";
import { detectBankRuleFromFilenames, bankSubjectForRule, serializeBankAnalysis, hydrateBankAnalysis, detectBankRule } from "./bank-cache-model.js";

test("서술형 제목에서 가운데점이 있는 단원·유형과 원문 번호를 보존한다", () => {
  const q = parseGradedEssayHeading("지수·로그 · 지수·로그의 성질 · 난이도 중 | 유형 지수·로그 / 원문 09번".normalize("NFD"));
  assert.equal(q.unitName, "지수·로그");
  assert.equal(q.subtopic, "지수·로그의 성질");
  assert.equal(q.sourceNumber, 9);
  assert.equal(q.difficulty, "lv2");
  assert.equal(q.subject, "수학1");
  const integral = parseGradedEssayHeading("적분 · 넓이 · 난이도 상 | 실전 4회 / 원문 20번");
  assert.equal(integral.unitNumber, "06");
  assert.equal(integral.subject, "수학2");
  assert.equal(integral.difficulty, "lv3");
  assert.equal(parseGradedEssayHeading("117문항 · 단원 → 난이도 순"), null);
  assert.equal(parseGradedEssayHeading("정답: 3"), null);
  const ordered = parseGradedEssayHeading("삼각함수 · 삼각함수의 주기 · 난이도 하 | 유형 삼각함수 / 원문 순서06번");
  assert.equal(ordered.sourceNumber, 6);
  assert.equal(ordered.sourceNumberLabel, "순서06");
  assert.match(ordered.sourceLabel, /순서06번/u);
});

test("서술형 최종본 파일을 자동 판별하고 수학 문제은행으로 등록한다", () => {
  const name = "서술형_117문항_미주해설_너비문구수정.hwpx".normalize("NFD");
  assert.ok(isGradedEssayFilename(name));
  assert.equal(isGradedEssayFilename("다른서술형.hwpx"), false);
  assert.equal(detectBankRuleFromFilenames([{ name }]), GRADED_ESSAY_RULE_ID);
  assert.equal(bankSubjectForRule(GRADED_ESSAY_RULE_ID), "수학");
});

test("캐시 재연결 후에도 문항 단원과 채점표를 유지한다", () => {
  const question = { ...parseGradedEssayHeading("미분 · 접선 · 난이도 하 | 실전 1회 / 원문 03번"), ordinal: 1,
    points: 10, rubric: [{ criterion: "접선", points: 10 }], copyMode: "root-endnote-block", preprocessMode: GRADED_ESSAY_RULE_ID };
  const cached = hydrateBankAnalysis(serializeBankAnalysis({ questions: [question] }));
  assert.equal(cached.questions[0].unitName, "미분");
  assert.equal(cached.questions[0].difficulty, "lv1");
  assert.deepEqual(cached.questions[0].rubric, question.rubric);
  assert.equal(detectBankRule(cached), GRADED_ESSAY_RULE_ID);
});
