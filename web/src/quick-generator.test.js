import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateExamSets,
  compileSlotRules,
  estimateMaximumExamSets,
  parseSlotReferences,
} from "./quick-generator.js";

const questions = [
  { code: "01-001", unitKey: "A", difficulty: "lv1" },
  { code: "01-002", unitKey: "A", difficulty: "lv1" },
  { code: "02-001", unitKey: "B", difficulty: "lv2" },
  { code: "02-002", unitKey: "B", difficulty: "lv2" },
];

test("same slot in multiple cells is an OR rule", () => {
  const rules = compileSlotRules([
    { unitKey: "A", difficulty: "lv1", value: "#1" },
    { unitKey: "B", difficulty: "lv2", value: "#1 #2" },
    { unitKey: null, difficulty: "lv1", value: "#2" },
  ], 2);
  const exams = allocateExamSets({ questions, rules, examCount: 2, seed: "same" });
  assert.equal(exams.length, 2);
  assert.equal(new Set(exams.flat()).size, 4);
  assert.equal(estimateMaximumExamSets({ questions, rules }), 2);
});

test("random row and column use null predicates", () => {
  const rules = compileSlotRules([
    { unitKey: "A", difficulty: null, value: "#1" },
    { unitKey: null, difficulty: "lv2", value: "#2" },
  ], 2);
  const [exam] = allocateExamSets({ questions, rules, examCount: 1, seed: "matrix" });
  assert.ok(exam[0].startsWith("01-"));
  assert.ok(exam[1].startsWith("02-"));
});

test("slot references reject partial or malformed tokens", () => {
  assert.deepEqual(parseSlotReferences("#1 2, #3", 3), [1, 2, 3]);
  assert.deepEqual(parseSlotReferences("#1~~4 #6~7", 8), [1, 2, 3, 4, 6, 7]);
  assert.deepEqual(parseSlotReferences("All", 4), [1, 2, 3, 4]);
  assert.deepEqual(parseSlotReferences("all", 3), [1, 2, 3]);
  assert.throws(() => parseSlotReferences("abc1", 3), /올바른 문항 위치/);
  assert.throws(() => parseSlotReferences("All #1", 3), /함께 입력할 수 없습니다/);
  assert.throws(() => parseSlotReferences("#3~~1", 3), /시작 번호/);
  assert.throws(() => parseSlotReferences("#1~~2 #2", 3), /중복/);
  assert.throws(() => parseSlotReferences("#1 #1", 3), /중복/);
  assert.throws(() => parseSlotReferences("#4", 3), /범위를 벗어났습니다/);
});
