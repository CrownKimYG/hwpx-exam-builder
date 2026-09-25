import test from 'node:test';
import assert from 'node:assert/strict';
import { latestWorker } from './latest-worker.js';
test('이전 계산 결과를 무시하고 작업을 정리한다',()=>{
 const workers=[],results=[];
 const task=latestWorker(()=>{const w={terminate(){this.closed=true;},postMessage(data){this.data=data;}};workers.push(w);return w;});
 task.run({value:1},r=>results.push(r));task.run({value:2},r=>results.push(r));
 assert.equal(workers[0].closed,true);workers[0].onmessage({data:1});assert.deepEqual(results,[]);
 workers[1].onmessage({data:2});assert.deepEqual(results,[2]);assert.equal(workers[1].closed,true);
 task.run({},r=>results.push(r));task.cancel();workers[2].onmessage({data:3});assert.deepEqual(results,[2]);
});
test('작업 생성 및 실행 오류도 정리하고 전달한다',()=>{
 const results=[];latestWorker(()=>{throw new Error('blocked');}).run({},r=>results.push(r));assert.match(results[0].error,/blocked/);
 let worker;const task=latestWorker(()=>worker={terminate(){this.closed=true;},postMessage(){}});
 task.run({},r=>results.push(r));worker.onerror();assert.equal(worker.closed,true);assert.ok(results[1].error);
});
