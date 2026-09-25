import test from 'node:test';
import assert from 'node:assert/strict';
import { difficultyCounts, seriesExams, seriesSignature } from './exam-series.js';
import { allocateGroupedExamSets, compileGroupedRules, initialGroupedConfig } from './grouped-generator.js';
test('난이도는 모두 직접 입력하고 합계를 맞춰야 한다', () => {
  for (const values of [undefined, {lv1:'',lv2:3,lv3:4}, {lv1:1.5,lv2:2.5,lv3:3}, {lv1:1,lv2:2,lv3:3}]) assert.throws(() => difficultyCounts(values,7));
  assert.deepEqual(difficultyCounts({lv1:'0',lv2:'3',lv3:'4'},7),{lv1:0,lv2:3,lv3:4});
});
test('여러 시험지에서 과목 비율과 난이도 수량 및 단원 중복 금지를 함께 지킨다', () => {
  const questions = ['수학1','수학2'].flatMap(subject => Array.from({length:10},(_,u)=> ['lv1','lv2','lv3'].flatMap(difficulty=>Array.from({length:4},(_,n)=>({code:`${subject}-${u}-${difficulty}-${n}`,subject,bankId:'a',unitKey:`${subject}:${u}`,difficulty})))).flat());
  const rules = {...compileGroupedRules(initialGroupedConfig(questions),7),difficultyCounts:{lv1:2,lv2:3,lv3:2}};
  const byCode = new Map(questions.map(q=>[q.code,q]));
  const results=allocateGroupedExamSets({questions,rules,examCount:4});
  assert.equal(new Set(results.flat()).size,28);
  for (const codes of results) {
    const picked=codes.map(c=>byCode.get(c));
    assert.equal(new Set(picked.map(q=>q.unitKey)).size,7);
    for (const [key,count] of Object.entries(rules.difficultyCounts)) assert.equal(picked.filter(q=>q.difficulty===key).length,count);
    assert.ok([3,4].includes(picked.filter(q=>q.subject==='수학1').length));
  }
  assert.throws(()=>allocateGroupedExamSets({questions:questions.filter(q=>q.difficulty!=='lv3'),rules,examCount:1}));
});
test('설정 또는 생성된 문항이 바뀌면 다운로드에서 제외한다',()=>{
  const state={quick:{questionCount:7,series:{인문계:{counts:{lv1:2,lv2:3,lv3:2}}}},exams:[{id:'1',codesText:'a b'}]};
  state.quick.series.인문계.result={signature:seriesSignature(state.quick,'인문계'),exams:[{...state.exams[0]}]};
  assert.equal(seriesExams(state,'인문계').length,1);
  state.quick.questionCount=8; assert.equal(seriesExams(state,'인문계').length,0);
  state.quick.questionCount=7; state.exams[0].codesText='b c'; assert.equal(seriesExams(state,'인문계').length,0);
});
