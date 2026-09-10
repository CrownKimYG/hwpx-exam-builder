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

test("문제은행별 할당량을 시험지마다 지키고 전체 묶음에서 중복을 막는다", async () => {
  const { compileBankQuotaRules } = await import("./quick-generator.js");
  const questions = ["A", "B"].flatMap((bankId) => Array.from({ length: 12 }, (_, i) => ({ bankId, code: `${bankId}-${i}`, unitKey: "동일 단원", difficulty: "lv1" })));
  const rules = compileBankQuotaRules([{ bankId: "A", count: 5 }, { bankId: "B", count: 3 }]);
  const usedCodes = new Set(["A-0"]);
  const exams = allocateExamSets({ questions, rules, examCount: 2, usedCodes, seed: "bank-quota" });
  for (const codes of exams) {
    assert.equal(codes.filter((code) => code.startsWith("A-")).length, 5);
    assert.equal(codes.filter((code) => code.startsWith("B-")).length, 3);
    assert.ok(!codes.includes("A-0"));
  }
  assert.equal(new Set(exams.flat()).size, 16);
  assert.equal(estimateMaximumExamSets({ questions, rules, usedCodes }), 2);
  assert.deepEqual(allocateExamSets({ questions, rules, examCount: 2, usedCodes, seed: "bank-quota" }), exams);
  assert.throws(() => allocateExamSets({ questions, rules, examCount: 3, usedCodes }), /중복 없이/u);
  assert.equal(compileBankQuotaRules([{ bankId: "A", count: 0 }, { bankId: "B", count: 2 }]).size, 2);
  for (const count of [-1, 1.5, NaN, 101]) assert.throws(() => compileBankQuotaRules([{ bankId: "A", count }]));
  assert.throws(() => compileBankQuotaRules([{ bankId: "A", count: 0 }]));
  assert.throws(() => compileBankQuotaRules([{ bankId: "A", count: 60 }, { bankId: "B", count: 60 }]));
});

test("은행별 조건표의 지역 문항 번호를 이어 붙이고 같은 단원명도 은행별로 구분한다", async () => {
  const { compileBankMatrixRules, questionMatches } = await import("./quick-generator.js");
  const banks = [
    { bankId: "A", name: "A은행", count: 2, cells: [
      { unitKey: "지수", difficulty: "lv1", value: "#1" },
      { unitKey: "수열", difficulty: "lv2", value: "#2" },
      { unitKey: "수열", difficulty: "lv3", value: "#2" },
    ] },
    { bankId: "B", name: "B은행", count: 1, cells: [{ unitKey: "지수", difficulty: "lv3", value: "All" }] },
    { bankId: "C", count: 0, cells: [{ value: "#99" }] },
  ];
  const rules = compileBankMatrixRules(banks);
  assert.equal(rules.size, 3);
  assert.equal(questionMatches({ bankId: "B", unitKey: "지수", difficulty: "lv1" }, rules.get(1)), false);
  assert.equal(questionMatches({ bankId: "A", unitKey: "수열", difficulty: "lv3" }, rules.get(2)), true);
  assert.equal(questionMatches({ bankId: "A", unitKey: "수열", difficulty: "lv1" }, rules.get(2)), false);
  const qs = [
    ...Array.from({ length: 2 }, (_, i) => ({ code: `A-low-${i}`, bankId: "A", unitKey: "지수", difficulty: "lv1" })),
    ...Array.from({ length: 2 }, (_, i) => ({ code: `A-high-${i}`, bankId: "A", unitKey: "수열", difficulty: "lv3" })),
    ...Array.from({ length: 2 }, (_, i) => ({ code: `B-high-${i}`, bankId: "B", unitKey: "지수", difficulty: "lv3" })),
  ];
  const exams = allocateExamSets({ questions: qs, rules, examCount: 2, seed: "matrix" });
  for (const exam of exams) { assert.match(exam[0], /^A-low/); assert.match(exam[1], /^A-high/); assert.match(exam[2], /^B-high/); }
  assert.equal(new Set(exams.flat()).size, 6);
  assert.equal(estimateMaximumExamSets({ questions: qs, rules }), 2);
  assert.throws(() => compileBankMatrixRules([{ bankId: "A", name: "A은행", count: 2, cells: [{ value: "#1" }] }]), /A은행:.*#2/u);
  assert.throws(() => compileBankMatrixRules([{ bankId: "B", name: "B은행", count: 1, cells: [{ value: "#2" }] }]), /B은행:.*범위/u);
});
