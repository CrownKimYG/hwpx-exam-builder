import test from "node:test";
import assert from "node:assert/strict";
import { readExamHistory, reserveExamHistory, historyUsedCodes, clearExamHistory } from "./exam-history.js";
import { allocateExamSets, compileBankQuotaRules, compileBankMatrixRules } from "./quick-generator.js";
function storage() { const map=new Map(); return { getItem:k=>map.get(k), setItem:(k,v)=>map.set(k,v), removeItem:k=>map.delete(k) }; }
const questions=Array.from({length:12},(_,i)=>({bankId:'bank',sourcePath:'folder/math.hwpx',ordinal:i+1,code:`01-${i+1}`,unitKey:'A',difficulty:i<6?'lv1':'lv3'}));
test('문항 수·난이도·시드를 바꾸고 목록을 비운 뒤에도 기존 출제와 겹치지 않는다',()=>{
 const store=storage();
 const first=allocateExamSets({questions,rules:compileBankQuotaRules([{bankId:'bank',count:3}]),examCount:1,seed:'first'})[0];
 reserveExamHistory(store,[{historyId:'first',title:'첫 시험',codes:first}],questions);
 const usedCodes=historyUsedCodes(readExamHistory(store),questions);
 const second=allocateExamSets({questions,rules:compileBankMatrixRules([{bankId:'bank',count:2,cells:[{difficulty:'lv3',value:'All'}]}]),examCount:1,usedCodes,seed:'second'})[0];
 assert.equal(second.length,2); assert.ok(second.every(code=>!first.includes(code)));
});
test('은행 순서가 바뀌어 화면 코드가 달라져도 동일 원문 문항을 제외한다',()=>{
 const store=storage();reserveExamHistory(store,[{historyId:'x',codes:['01-1']}],questions);
 const changed=questions.map(q=>({...q,code:q.code.replace('01-','27-'),difficulty:'lv3'}));
 assert.deepEqual([...historyUsedCodes(readExamHistory(store),changed)],['27-1']);
});
test('자기 시험지 재다운로드는 허용하고 다른 시험지 재사용은 거부한다',()=>{
 const store=storage();const exam={historyId:'x',codes:['01-1']};
 reserveExamHistory(store,[exam],questions);reserveExamHistory(store,[exam],questions);
 assert.equal(readExamHistory(store).length,1);
 assert.throws(()=>reserveExamHistory(store,[{historyId:'other',codes:['01-1']}],questions),/이전에/);
 assert.equal(readExamHistory(store).length,1);
});
test('문항이 고갈되면 재사용하지 않고 실패하며 초기화 후 재사용 가능하다',()=>{
 const store=storage();reserveExamHistory(store,[{historyId:'all',codes:questions.map(q=>q.code)}],questions);
 const rules=compileBankQuotaRules([{bankId:'bank',count:1}]);
 assert.throws(()=>allocateExamSets({questions,rules,examCount:1,usedCodes:historyUsedCodes(readExamHistory(store),questions)}));
 clearExamHistory(store);assert.equal(historyUsedCodes(readExamHistory(store),questions).size,0);
});
test('저장 실패를 호출자에게 전달한다',()=>{
 assert.throws(()=>reserveExamHistory({getItem:()=>null,setItem:()=>{throw new Error('quota');}},[{historyId:'x',codes:['01-1']}],questions),/quota/);
});
