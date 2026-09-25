import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareExamPagination } from './exam-pagination.js';
function fixture(variants, explicitSolutionSlot=false, outputPages=3, contentPages=1) {
 const calls=[];
 const options={variants,explicitSolutionSlot,assembleProblem:async()=>{calls.push('assemble');return 'problem';},pageCount:async bytes=>{calls.push(`count:${bytes}`);return bytes==='content'?contentPages:outputPages;},removeEndnotes:async()=>{calls.push('strip');return 'content';},appendBlank:async()=>{calls.push('append');return 'padded';}};
 return {calls,options};
}
test('문제지만 출력할 때 해설 쪽수를 계산하지 않는다',async()=>{
 const f=fixture(['problem']);const result=await prepareExamPagination(f.options);
 assert.deepEqual(f.calls,['assemble','count:problem','append']);assert.equal(result.problemBytes,'padded');assert.equal(result.solutionNeedsBlankPage,false);
});
test('해설만 출력할 때 문제지 출력 쪽수를 계산하지 않는다',async()=>{
 const f=fixture(['solution']);const result=await prepareExamPagination(f.options);
 assert.deepEqual(f.calls,['assemble','strip','count:content']);assert.equal(result.problemContentPages,1);assert.equal(result.solutionNeedsBlankPage,true);
});
test('두 종류 출력은 빈 페이지를 붙이기 전 문제 영역을 측정한다',async()=>{
 const f=fixture(['problem','solution']);const result=await prepareExamPagination(f.options);
 assert.deepEqual(f.calls,['assemble','count:problem','strip','count:content','append']);assert.equal(result.solutionNeedsBlankPage,true);
 const even=fixture(['problem','solution'],false,2,2);assert.equal((await prepareExamPagination(even.options)).solutionNeedsBlankPage,false);assert.ok(!even.calls.includes('append'));
});
test('해설 슬롯 템플릿은 불필요한 중간 렌더링을 생략한다',async()=>{
 const solution=fixture(['solution'],true);await prepareExamPagination(solution.options);assert.deepEqual(solution.calls,[]);
 const both=fixture(['problem','solution'],true);await prepareExamPagination(both.options);assert.deepEqual(both.calls,['assemble']);
});
test('취소된 작업은 다음 변환으로 진행하지 않는다',async()=>{
 const f=fixture(['problem','solution']);f.options.check=()=>{throw new Error('cancelled');};
 await assert.rejects(prepareExamPagination(f.options),/cancelled/);assert.deepEqual(f.calls,['assemble']);
});
