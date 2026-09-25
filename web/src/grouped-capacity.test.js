import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateGroupedCapacity } from './grouped-capacity.js';
import { initialGroupedConfig, compileGroupedRules, allocateGroupedExamSets } from './grouped-generator.js';
const questions=Array.from({length:3},(_,u)=>Array.from({length:4},(_,n)=>({subject:'수학Ⅰ',unitKey:`u${u}`,bankId:'a',difficulty:'lv1',code:`${u}-${n}`}))).flat();
const rules=compileGroupedRules(initialGroupedConfig(questions),3);
test('이미 출제된 문제를 제외하고 실제 구성 가능한 부수를 반환한다',()=>{
 assert.equal(estimateGroupedCapacity({questions,rules}).count,4);
 const usedCodes=new Set(['0-0','0-1']);
 const result=estimateGroupedCapacity({questions,rules,usedCodes});assert.equal(result.count,2);
 assert.equal(allocateGroupedExamSets({questions,rules,usedCodes,examCount:result.count}).length,2);
});
test('불가능한 조건과 계산 한도를 구분한다',()=>{
 assert.equal(estimateGroupedCapacity({questions:[],rules}).count,0);
 const result=estimateGroupedCapacity({questions,rules},{budgetMs:0});assert.equal(result.limited,true);
 const config=initialGroupedConfig(questions);config.subjects[0].positionMode='unit';config.subjects[0].unitPositions={u0:{lv3:'1'}};
 assert.equal(estimateGroupedCapacity({questions,rules:compileGroupedRules(config,3)}).count,0);
});
test('번호를 지정한 묶음을 제외하면 0부와 원인을 반환한다',()=>{
 const config=initialGroupedConfig(questions);const s=config.subjects[0];
 s.positionMode='group';s.groups[0].positions={any:'1'};s.groups[0].count=0;
 const result=estimateGroupedCapacity({questions,rules:compileGroupedRules(config,2)});
 assert.equal(result.count,0);assert.equal(result.limited,false);assert.match(result.reason,/1번/);
});
