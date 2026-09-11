import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransformBankQuestions, DEFAULT_BANK_RULE_ID, EBSI_KOREAN_RULE_ID, SUTEUK_SHORT_ESSAY_RULE_ID } from './bank-cache-model.js';
import { GRADED_ESSAY_RULE_ID } from './graded-essay-parser.js';
import { questionTransformMode } from './template-builder.js';

test('수특변형이 포함되면 은행 개수와 순서에 관계없이 변환 선택을 제공한다', () => {
  const math={ruleId:DEFAULT_BANK_RULE_ID};
  for(const ruleId of [EBSI_KOREAN_RULE_ID,SUTEUK_SHORT_ESSAY_RULE_ID,GRADED_ESSAY_RULE_ID]) {
    assert.equal(canTransformBankQuestions([math,{ruleId}]),true);
    assert.equal(canTransformBankQuestions([{ruleId},math]),true);
    assert.equal(canTransformBankQuestions([{ruleId}]),false);
  }
  assert.equal(canTransformBankQuestions([]),false);
});

test('혼합 출제의 변환 설정은 수특변형에만 적용하고 다른 은행의 문제와 정답을 유지한다', () => {
  for(const mode of ['short','essay']) {
    assert.equal(questionTransformMode({ruleId:DEFAULT_BANK_RULE_ID},mode),mode);
    for(const ruleId of [EBSI_KOREAN_RULE_ID,SUTEUK_SHORT_ESSAY_RULE_ID,GRADED_ESSAY_RULE_ID]) {
      assert.equal(questionTransformMode({ruleId},mode),'original');
    }
    for(const preprocessMode of ['ebsi-endnote-v1',SUTEUK_SHORT_ESSAY_RULE_ID,GRADED_ESSAY_RULE_ID]) {
      assert.equal(questionTransformMode({preprocessMode},mode),'original');
    }
  }
});
