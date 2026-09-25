import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateExamSets, compileBankQuotaRules, compileSlotRules, questionMatches } from './quick-generator.js';
import { compileMixedRules } from './mixed-generator.js';

const makePool = sizes => sizes.flatMap((size, u) => Array.from({ length: size }, (_, i) => ({
  code: `${u}-${i}`, bankId: 'a', unitKey: `U${u}`, difficulty: i % 2 ? 'lv1' : 'lv2',
})));
const modes = {
  banks: count => compileBankQuotaRules([{ bankId: 'a', count }]),
  matrix: count => compileSlotRules([{ value: 'All' }], count),
  mixed: count => compileMixedRules([{ bankId: 'a', count }], [{ count }]),
};
const spread = counts => Math.max(...counts) - Math.min(...counts);

for (const [mode, makeRules] of Object.entries(modes)) {
  test(`${mode}: 문항 수가 달라도 매 부와 전체 묶음의 단원을 균등 배분하고 새로 추첨한다`, () => {
    const questions = makePool([200, 100, 80, 60]);
    const lookup = new Map(questions.map(q => [q.code, q]));
    const rules = makeRules(7);
    const run = seed => allocateExamSets({ questions, rules, examCount: 12, seed });
    for (const seed of ['balance', 'another', 'third']) {
      const exams = run(seed);
      assert.deepEqual(exams, run(seed));
      assert.equal(new Set(exams.flat()).size, 84);
      const totals = [0, 0, 0, 0];
      const layouts = exams.map(exam => exam.map(code => lookup.get(code).unitKey));
      for (const layout of layouts) {
        const counts = totals.map((_, u) => layout.filter(unit => unit === `U${u}`).length);
        assert.ok(spread(counts) <= 1, JSON.stringify(counts));
        counts.forEach((count, u) => totals[u] += count);
      }
      assert.ok(spread(totals) <= 1, JSON.stringify(totals));
      assert.ok(new Set(layouts.map(layout => layout.join(','))).size > 1);
    }
    assert.notDeepEqual(run('balance'), run('another'));
  });

  test(`${mode}: 부족한 단원은 남은 단원으로 채우고 사용 문항을 제외한다`, () => {
    const questions = makePool([2, 30, 30]);
    const usedCodes = new Set(['0-0', '1-0']);
    const exams = allocateExamSets({ questions, rules: makeRules(5), examCount: 4, usedCodes, seed: 'shortage' });
    assert.equal(exams.flat().length, 20);
    assert.equal(new Set(exams.flat()).size, 20);
    assert.ok(exams.flat().every(code => !usedCodes.has(code)));
    assert.ok(exams.flat().includes('0-1'));
    for (const exam of exams) {
      assert.ok(Math.abs(exam.filter(c => c.startsWith('1-')).length - exam.filter(c => c.startsWith('2-')).length) <= 1);
    }
  });
}

test('조건표: 단원·난이도 고정을 지키며 나머지 단원을 분산한다', () => {
  const questions = makePool([60, 60, 60]);
  const rules = compileSlotRules([
    { unitKey: 'U0', difficulty: 'lv1', value: '1 2' },
    { difficulty: 'lv2', value: '3~6' },
  ], 6);
  const lookup = new Map(questions.map(q => [q.code, q]));
  const exams = allocateExamSets({ questions, rules, examCount: 5, seed: 'fixed' });
  for (const exam of exams) {
    exam.forEach((code, i) => assert.ok(questionMatches(lookup.get(code), rules.get(i + 1))));
    assert.deepEqual([0, 1, 2].map(u => exam.filter(code => lookup.get(code).unitKey === `U${u}`).length), [2, 2, 2]);
  }
});

test('조건표: 이전 배정을 옮겨야 하는 경우에도 가능한 조합을 찾는다', () => {
  const questions = makePool([1, 1, 1]);
  const rules = compileSlotRules([
    { unitKey: 'U0', value: '1 2 3' },
    { unitKey: 'U1', value: '1 2' },
    { unitKey: 'U2', value: '3' },
  ], 3);
  for (let seed = 0; seed < 20; seed++) {
    const [exam] = allocateExamSets({ questions, rules, examCount: 1, seed });
    assert.equal(new Set(exam).size, 3);
    exam.forEach((code, i) => assert.ok(questionMatches(questions.find(q => q.code === code), rules.get(i + 1))));
  }
});

test('혼합 배치: 난이도 그룹 수가 많은 단원에 치우치지 않는다', () => {
  const questions = makePool([100, 100, 100]);
  for (const q of questions) if (q.unitKey === 'U0') q.difficulty = 'lv1';
  const rules = modes.mixed(4);
  const exams = allocateExamSets({ questions, rules, examCount: 12, seed: 'groups' });
  const totals = [0, 1, 2].map(u => exams.flat().filter(code => code.startsWith(`${u}-`)).length);
  assert.deepEqual(totals, [16, 16, 16]);
});

test('혼합 배치: 단원·난이도 지정 조건과 은행별 할당량을 유지한다', () => {
  const questions = ['a', 'b'].flatMap(bankId => makePool([80, 80, 80]).map(q => ({ ...q, bankId, code: `${bankId}-${q.code}` })));
  const lookup = new Map(questions.map(q => [q.code, q]));
  const rules = compileMixedRules([{ bankId: 'a', count: 6 }, { bankId: 'b', count: 3 }], [
    { bankId: 'a', unitKey: 'U0', difficulty: 'lv1', count: 2, range: '1-2' },
    { count: 7, range: '3-9' },
  ]);
  const exams = allocateExamSets({ questions, rules, examCount: 4, seed: 'fixed-mixed' });
  assert.equal(new Set(exams.flat()).size, 36);
  for (const exam of exams) {
    const selected = exam.map(code => lookup.get(code));
    assert.ok(selected.slice(0, 2).every(q => q.bankId === 'a' && q.unitKey === 'U0' && q.difficulty === 'lv1'));
    for (const bank of rules.banks) {
      const counts = [0, 1, 2].map(u => selected.filter(q => q.bankId === bank.bankId && q.unitKey === `U${u}`).length);
      assert.equal(counts.reduce((a, b) => a + b, 0), bank.count);
      assert.ok(spread(counts) <= 1, JSON.stringify(counts));
    }
  }
});
