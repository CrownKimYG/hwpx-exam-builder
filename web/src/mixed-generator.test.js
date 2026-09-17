import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMixedRules} from './mixed-generator.js';
import {allocateExamSets} from './quick-generator.js';
import {createExamPreset,applyExamPreset,presetRules} from './exam-presets.js';
const banks=[{bankId:'a',name:'A',count:3},{bankId:'b',name:'B',count:3}];
const rows=[{count:2,difficulty:'lv1',range:'1-4'},{count:2,difficulty:'lv2',range:'2-5'},{count:2,difficulty:'lv3',range:'3-6'}];
const questions=['a','b'].flatMap(bankId=>['lv1','lv2','lv3'].flatMap(difficulty=>Array.from({length:10},(_,i)=>({code:`${bankId}-${difficulty}-${i}`,bankId,difficulty,unitKey:'U'}))));
const byCode=new Map(questions.map(q=>[q.code,q]));
test('여러 부의 같은 번호에서도 랜덤 단원과 난이도를 새로 추첨한다',()=>{
 const pool=['U1','U2','U3','U4'].flatMap(unitKey=>['lv1','lv2','lv3'].flatMap(difficulty=>
  Array.from({length:100},(_,i)=>({code:`${unitKey}-${difficulty}-${i}`,bankId:'a',unitKey,difficulty}))));
 const lookup=new Map(pool.map(q=>[q.code,q]));
 const rules=compileMixedRules([{bankId:'a',name:'A',count:4}],[{count:4}]);
 const run=()=>allocateExamSets({questions:pool,rules,examCount:20,seed:'slot-diversity'});
 const exams=run();
 assert.deepEqual(exams,run());
 assert.equal(new Set(exams.flat()).size,80);
 for(let slot=0;slot<4;slot++) {
  assert.ok(new Set(exams.map(exam=>lookup.get(exam[slot]).unitKey)).size>=3,`#${slot+1} 단원 반복`);
  assert.equal(new Set(exams.map(exam=>lookup.get(exam[slot]).difficulty)).size,3,`#${slot+1} 난이도 반복`);
 }
});
test('전체 번호에 은행 및 난이도별 수량·번호 범위를 함께 만족하며 여러 부 중복 없음',()=>{
 const rules=compileMixedRules(banks,rows);const usedCodes=new Set([questions[0].code]);
 const exams=allocateExamSets({questions,rules,usedCodes,examCount:3,seed:'verify'});
 assert.equal(new Set(exams.flat()).size,18);
 for(const codes of exams){
  assert.equal(codes.filter(c=>byCode.get(c).bankId==='a').length,3);
  for(const row of rows)assert.equal(codes.filter(c=>byCode.get(c).difficulty===row.difficulty).length,row.count);
  codes.forEach((c,i)=>{assert.ok(!usedCodes.has(c));assert.ok(rules.rows.find(r=>r.difficulty===byCode.get(c).difficulty).slots.includes(i+1));});
 }
});
test('시드 재현과 다른 시드의 은행 배치 변화',()=>{
 const rules=compileMixedRules(banks,rows);
 const run=seed=>allocateExamSets({questions,rules,examCount:1,seed})[0];
 assert.deepEqual(run('same'),run('same'));
 const layouts=new Set(Array.from({length:12},(_,i)=>run(String(i)).map(c=>byCode.get(c).bankId).join('')));
 assert.ok(layouts.size>1);
});
test('단원·은행 지정과 고정 번호를 유지한다',()=>{
 const rules=compileMixedRules(banks,[{count:1,bankId:'b',unitKey:'U',difficulty:'lv3',range:'1'},{count:5,range:'2-6'}]);
 const result=allocateExamSets({questions,rules,examCount:1,seed:'x'})[0];assert.equal(byCode.get(result[0]).bankId,'b');assert.equal(byCode.get(result[0]).difficulty,'lv3');
});
test('불가능한 범위·합계·고갈을 구분하여 거부',()=>{
 assert.throws(()=>compileMixedRules(banks,[{count:6,range:'1-3'}]),/허용 번호/);
 assert.throws(()=>compileMixedRules(banks,[{count:5}]),/합계/);
 assert.throws(()=>allocateExamSets({questions:[],rules:compileMixedRules(banks,rows),examCount:1}),/미사용 문항/);
 const rules=compileMixedRules(banks.map(b=>({...b,range:'1-3'})),[{count:6}]);
 assert.throws(()=>allocateExamSets({questions,rules,examCount:1}),/#4/);
});
test('혼합 템플릿 저장·적용 왕복과 기존 버전 호환',()=>{
 const profiles=banks.map(b=>({...b,displayName:b.name,ruleId:'math'}));
 const quick={bankCounts:{a:3,b:3},cells:{},examCount:1,examName:'test',mixed:{bankRanges:{b:'2-6'},rows}};
 const preset=JSON.parse(JSON.stringify(createExamPreset({id:'p',name:'mixed',profiles,quick,mode:'mixed'})));
 assert.equal(presetRules(preset).kind,'mixed');
 assert.deepEqual(applyExamPreset(preset,profiles,{a:['U'],b:['U']},{}).mixed,quick.mixed);
});
