import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBankMatrixRules, allocateExamSets, estimateMaximumExamSets } from './quick-generator.js';
import { createExamPreset, applyExamPreset } from './exam-presets.js';
const questions=['u1','u2','u3'].flatMap(unitKey=>['lv1','lv2'].flatMap(difficulty=>Array.from({length:3},(_,n)=>({code:`${unitKey}-${difficulty}-${n}`,bankId:'a',unitKey,difficulty}))));
const groups=[{id:'g',units:['u1','u2']}];
const cells=[{unitKey:'group:g',difficulty:'lv1',value:'1,2'},{unitKey:'u3',difficulty:null,value:'3'}];
const banks=[{bankId:'a',count:3,groups,cells}];
test('기존 번호표에 묶음을 추가하고 정확한 가능 부수와 번호 순서를 유지한다',()=>{
 const rules=compileBankMatrixRules(banks);
 const maximum=estimateMaximumExamSets({questions,rules});assert.equal(maximum,3);
 const results=allocateExamSets({questions,rules,examCount:maximum});assert.equal(new Set(results.flat()).size,9);
 const byCode=new Map(questions.map(q=>[q.code,q]));
 for(const exam of results){for(const code of exam.slice(0,2)){assert.ok(groups[0].units.includes(byCode.get(code).unitKey));assert.equal(byCode.get(code).difficulty,'lv1');}assert.equal(byCode.get(exam[2]).unitKey,'u3');}
 assert.throws(()=>allocateExamSets({questions,rules,examCount:maximum+1}));
 assert.equal(estimateMaximumExamSets({questions,rules,usedCodes:new Set(results[0])}),2);
});
test('기존처럼 같은 단원에서도 서로 다른 문항을 여러 번호에 배치한다',()=>{
 const rules=compileBankMatrixRules([{bankId:'a',count:3,cells:[{unitKey:'u1',difficulty:'lv1',value:'All'}]}]);
 assert.equal(allocateExamSets({questions,rules,examCount:1})[0].length,3);
});
test('묶음 템플릿 저장과 복원, 누락 단원 검증',()=>{
 const profiles=[{bankId:'a',displayName:'교재',ruleId:'test'}];
 const quick={bankCounts:{a:3},matrixGroups:{a:groups},cells:Object.fromEntries(cells.map(c=>[JSON.stringify(['a',c.unitKey,c.difficulty]),c.value])),examCount:1,questionCount:3,examName:'시험지'};
 const preset=createExamPreset({id:'p',name:'묶음',profiles,quick,mode:'matrix'});
 const restored=applyExamPreset(preset,profiles,{a:['u1','u2','u3']},{});
 assert.deepEqual(restored.matrixGroups,quick.matrixGroups);assert.deepEqual(restored.cells,quick.cells);
 assert.throws(()=>applyExamPreset(preset,profiles,{a:['u1','u3']},{}),/묶음/);
 assert.throws(()=>compileBankMatrixRules([{...banks[0],groups:[]}]),/묶음/);
});
