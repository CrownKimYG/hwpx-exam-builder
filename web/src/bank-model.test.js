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

test("normalizes difficulty and question codes", () => {
  assert.equal(difficultyFromLabel("기초연습"), "lv1");
  assert.equal(difficultyFromLabel("예제"), "유제");
  assert.equal(normalizeQuestionCode("1-2"), "01-002");
  assert.deepEqual(parseQuestionCodes("1-2, 02-003"), ["01-002", "02-003"]);
});

test("project snapshots contain identities and settings but no source bytes", () => {
  const snapshot = createProjectSnapshot({
    files: [{
      code: "01",
      identity: { name: "bank.hwpx", relativePath: "folder/bank.hwpx", size: 123, lastModified: 456 },
      metadata: { subject: "수학Ⅰ", unitName: "지수와 로그" },
      questionOverrides: { 1: "lv3" },
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
});
