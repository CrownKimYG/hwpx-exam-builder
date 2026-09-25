import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateExamSets, estimateMaximumExamSets, questionMatches, seededRandom } from './quick-generator.js';
function brute(questions,rules,copies) {
 const demands=Array.from({length:copies},()=>[...rules.values()]).flat();
 const used=new Set();
 function assign(i){if(i===demands.length)return true;for(const q of questions){if(used.has(q.code)||!questionMatches(q,demands[i]))continue;used.add(q.code);if(assign(i+1))return true;used.delete(q.code);}return false;}
 return assign(0);
}
test('정확한 최대 부수가 전수 탐색 결과와 일치한다',()=>{
 const random=seededRandom('capacity');
 for(let sample=0;sample<100;sample++) {
  const questions=Array.from({length:7},(_,i)=>({code:String(i),bankId:i%2?'a':'b',unitKey:`u${i%3}`,difficulty:i%2?'lv1':'lv2'}));
  const rules=new Map(Array.from({length:3},(_,i)=>[i+1,Array.from({length:1+Math.floor(random()*2)},()=>({bankId:random()<.5?null:'a',unitKeys:random()<.5?null:['u0','u1'],difficulty:random()<.5?null:'lv1'}))]));
  let expected=0;while(brute(questions,rules,expected+1))expected++;
  assert.equal(estimateMaximumExamSets({questions,rules}),expected);
  if(expected)assert.equal(allocateExamSets({questions,rules,examCount:expected}).length,expected);
 }
});
test('겹치는 후보의 병목, 이력, 상한 및 중복 코드를 처리한다',()=>{
 const questions=Array.from({length:8},(_,i)=>({code:String(i),unitKey:i<3?'a':'b'}));
 const rules=new Map([[1,[{unitKey:'a'}]],[2,[{unitKey:'a'}]]]);
 assert.equal(estimateMaximumExamSets({questions,rules}),1);
 assert.equal(estimateMaximumExamSets({questions,rules,usedCodes:new Set(['0','1'])}),0);
 const all=new Map([[1,[{}]],[2,[{}]]]);
 assert.equal(estimateMaximumExamSets({questions:[...questions,...questions],rules:all}),4);
 assert.equal(estimateMaximumExamSets({questions,rules:all,cap:2}),2);
 assert.equal(estimateMaximumExamSets({questions,rules:new Map()}),0);
});
