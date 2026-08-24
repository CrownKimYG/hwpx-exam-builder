import test from "node:test";
import assert from "node:assert/strict";
import {
  createProjectSnapshot,
  difficultyFromLabel,
  normalizeQuestionCode,
  parseBankFilename,
  parseQuestionCodes,
  validateProjectSnapshot,
} from "./bank-model.js";

test("parses EBS filename metadata", () => {
  const parsed = parseBankFilename("[수능특강 유형] 2027 01.지수와 로그(02)_수학Ⅰ[36문제].hwpx");
  assert.equal(parsed.subject, "수학Ⅰ");
  assert.equal(parsed.unitNumber, "01");
  assert.equal(parsed.unitName, "지수와 로그");
  assert.equal(parsed.volume, "02");
  assert.equal(parsed.declaredQuestionCount, 36);
});

test("parses HWP filename metadata with the HWPX rule", () => {
  const parsed = parseBankFilename("[수능특강 유형] 2027 01.지수와 로그(01)_수학Ⅰ[36문제].hwp");
  assert.equal(parsed.subject, "수학Ⅰ");
  assert.equal(parsed.unitName, "지수와 로그");
  assert.equal(parsed.volume, "01");
});

test("parses every filename pattern in the 27 EBS bank folder", () => {
  const filenames = [
    "[수능특강 유형] 2027 01.지수와 로그(01)_수학Ⅰ[36문제].hwpx",
    "[수능특강 유형] 2027 02.지수함수와 로그함수(02)_수학Ⅰ[34문제].hwp",
    "[수능특강 유형] 2027 03.삼각함수(01)_수학Ⅰ[34문제].hwp",
    "[수능특강 유형] 2027 04.사인법칙과 코사인법칙(02)_수학Ⅰ[38문제].hwp",
    "[수능특강 유형] 2027 05.등차수열과 등비수열(01)_수학Ⅰ[34문제].hwp",
    "[수능특강 유형] 2027 06.수열의 합과 수학적 귀납법(02)_수학Ⅰ[35문제].hwp",
    "[수능특강 유형] 2027 01.함수의 극한(01)_수학Ⅱ [30문제].hwpx",
    "[수능특강 유형] 2027 02.함수의 연속(02)_수학Ⅱ [28문제].hwp",
    "[수능특강 유형] 2027 03.미분계수와 도함수(01)_수학Ⅱ [28문제].hwp",
    "[수능특강 유형] 2027 04.도함수의 활용(1)(02)_수학Ⅱ [28문제].hwp",
    "[수능특강 유형] 2027 05.도함수의 활용(2)(01)_수학Ⅱ [29문제].hwp",
    "[수능특강 유형] 2027 06.부정적분과 정적분(02)_수학Ⅱ [30문제].hwp",
    "[수능특강 유형] 2027 07.정적분의 활용(01)_수학Ⅱ [26문제].hwp",
  ];

  filenames.forEach((filename) => {
    const parsed = parseBankFilename(filename);
    assert.equal(parsed.parsed, true, filename);
    assert.notEqual(parsed.subject, "과목 미분류", filename);
    assert.ok(parsed.unitNumber, filename);
    assert.ok(parsed.unitName, filename);
  });

  const nested = parseBankFilename("[수능특강 유형] 2027 04.도함수의 활용(1)(02)_수학Ⅱ [28문제].hwp");
  assert.equal(nested.unitName, "도함수의 활용(1)");
  assert.equal(nested.volume, "02");
});

test("normalizes difficulty and question codes", () => {
  assert.equal(difficultyFromLabel("기초연습"), "lv1");
  assert.equal(difficultyFromLabel("예제"), "유제");
  assert.equal(normalizeQuestionCode("01-002"), "01-002");
  assert.equal(normalizeQuestionCode("1-2"), null);
  assert.deepEqual(parseQuestionCodes("01-002, 02-003"), ["01-002", "02-003"]);
  assert.throws(() => parseQuestionCodes("1-2"), /01-003 형식/);
});

test("project snapshots contain identities and settings but no source bytes", () => {
  const snapshot = createProjectSnapshot({
    files: [{
      code: "01",
      identity: { name: "bank.hwpx", relativePath: "folder/bank.hwpx", size: 123, lastModified: 456 },
      metadata: { subject: "수학Ⅰ", unitName: "지수와 로그" },
      questionOverrides: { 1: "lv3" },
      selectedRuleId: "macro-endnote-v1",
      resolvedRuleId: "macro-endnote-v1",
      bytes: new Uint8Array([1, 2, 3]),
      questions: [{ questionText: "저장하면 안 되는 문제 본문" }],
    }],
    quick: { questionCount: 1, examCount: 1, cells: {} },
    exams: [{ id: "exam-1", codes: ["01-001"], transform: "inherit" }],
    settings: { globalTransform: "original", outputType: "problem", hideEndnotes: true },
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(validateProjectSnapshot(snapshot), snapshot);
  assert.ok(!serialized.includes("저장하면 안 되는 문제 본문"));
  assert.ok(!serialized.includes("bytes"));
  assert.equal(snapshot.files[0].questionOverrides[1], "lv3");
  assert.equal(snapshot.files[0].selectedRuleId, "macro-endnote-v1");
  assert.equal(snapshot.files[0].resolvedRuleId, "macro-endnote-v1");
});
