import test from "node:test";
import assert from "node:assert/strict";
import { EBSI_KOREAN_RULE_ID } from "./bank-cache-model.js";
import { collectSelectedBuildWarnings } from "./build-warnings.js";

test("국어 선택 문항의 정답·해설 누락을 시험지별로 모은다", () => {
  const questions = new Map([
    ["01-001", { code: "01-001", answerText: "②", explanationText: "", warnings: ["[해설] 표식 누락"] }],
    ["01-002", { code: "01-002", answerText: "③", explanationText: "해설" }],
  ]);
  const warnings = collectSelectedBuildWarnings([
    { title: "시험지 01", codes: ["01-001", "01-001", "01-002"] },
  ], questions, EBSI_KOREAN_RULE_ID);

  assert.deepEqual(warnings, [{
    examTitle: "시험지 01",
    code: "01-001",
    warnings: ["[해설] 표식 누락", "해설 내용 누락"],
  }]);
});

test("수학 문제은행에는 국어 누락 확인을 적용하지 않는다", () => {
  const questions = new Map([["01-001", { code: "01-001", answerText: "", explanationText: "" }]]);
  assert.deepEqual(collectSelectedBuildWarnings(
    [{ title: "시험지 01", codes: ["01-001"] }],
    questions,
    "macro-endnote-v1",
  ), []);
});
