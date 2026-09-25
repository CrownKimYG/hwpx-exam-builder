import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateExamSets } from './quick-generator.js';
import { initialGroupedConfig, compileGroupedRules, subjectName } from './grouped-generator.js';
import { createExamPreset, applyExamPreset } from './exam-presets.js';
const questions = ['수학1','수학2'].flatMap(subject => ['a','b'].flatMap(bankId => Array.from({length:6},(_,u)=>Array.from({length:15},(_,i)=>({subject, bankId, unitKey:`${subject}:${u}`, unitName:`단원${u}`, difficulty:i%2?'lv1':'lv2',code:`${subject}-${bankId}-${u}-${i}`}))).flat()));
const lookup = new Map(questions.map(q=>[q.code,q]));
const run=(config, size=5, examCount=7, extra={})=>allocateExamSets({questions,rules:compileGroupedRules(config,size),examCount,seed:'groups',...extra});

test('과목 이름 표기를 통합하고 3:2 배정과 문항 중복 제외를 지킨다',()=>{
 assert.equal(subjectName('수학 Ⅰ'),'수학Ⅰ');assert.equal(subjectName('수학II'),'수학Ⅱ');
 const config=initialGroupedConfig(questions);config.subjects[0].weight=3;config.subjects[1].weight=2;
 const exams=run(config);assert.equal(new Set(exams.flat()).size,35);assert.deepEqual(run(config),exams);
 for(const exam of exams){assert.equal(exam.filter(c=>lookup.get(c).subject==='수학1').length,3);assert.equal(new Set(exam.map(c=>lookup.get(c).unitKey)).size,5);}
 const usedCodes=new Set(exams.flat());assert.ok(run(config,5,7,{usedCodes}).flat().every(c=>!usedCodes.has(c)));
});
test('나누어떨어지지 않는 1:1 비율은 여러 부에서 균형을 맞춘다',()=>{
 const exams=run(initialGroupedConfig(questions),5,10);
 assert.equal(exams.flat().filter(c=>lookup.get(c).subject==='수학1').length,25);
 assert.ok(exams.every(e=>[2,3].includes(e.filter(c=>lookup.get(c).subject==='수학1').length)));
});
test('묶음 중 하나만 선택하며 덜 출제한 단원을 우선한다',()=>{
 const config=initialGroupedConfig(questions);config.subjects[1].weight=0;
 const s=config.subjects[0];s.groups=[{units:s.groups.slice(0,3).flatMap(g=>g.units),count:1},{units:s.groups.slice(3).flatMap(g=>g.units),count:1}];
 const exams=run(config,2,9);
 for(const e of exams) for(const g of s.groups) assert.equal(e.filter(c=>g.units.includes(lookup.get(c).unitKey)).length,1);
 const counts=Array.from({length:6},(_,u)=>exams.flat().filter(c=>lookup.get(c).unitKey===`수학1:${u}`).length);
 assert.deepEqual(counts,[3,3,3,3,3,3]);
});
test('교재 수동 비율과 난이도 조건을 유지한다',()=>{
 const config=initialGroupedConfig(questions);config.subjects[1].weight=0;const s=config.subjects[0];s.bankWeights={a:2,b:1};s.groups.forEach(g=>g.difficulty='lv1');
 const exams=run(config,3,6);
 for(const e of exams){assert.equal(e.filter(c=>lookup.get(c).bankId==='a').length,2);assert.ok(e.every(c=>lookup.get(c).difficulty==='lv1'));}
});
test('조건 부족 시 과목·묶음 비율을 바꾸지 않는다',()=>{
 const config=initialGroupedConfig(questions);config.subjects[1].weight=0;config.subjects[0].groups=[{units:['수학1:0'],count:1}];
 assert.throws(()=>run(config,2,1),/미사용 문항|부족|출제 가능한 단원/);
 assert.throws(()=>run(config,1,1,{usedCodes:new Set(questions.map(q=>q.code))}),/미사용|출제 가능한 단원/);
 config.subjects[0].groups[0].count=2;assert.throws(()=>run(config),/단원 수/);
});
test('그룹 템플릿을 저장·복원하며 사라진 단원을 거부한다',()=>{
 const grouped=initialGroupedConfig(questions),profiles=['a','b'].map(bankId=>({bankId,displayName:bankId,ruleId:'math'}));
 const quick={grouped,bankCounts:{a:3,b:2},cells:{},questionCount:5,examName:'시험',examCount:7};
 const preset=createExamPreset({id:'x',name:'묶음',profiles,quick,mode:'grouped'});
 const units=Object.fromEntries(profiles.map(p=>[p.bankId,[...new Set(questions.map(q=>q.unitKey))]]));
 const restored=applyExamPreset(preset,profiles,units,{});assert.deepEqual(restored.grouped,grouped);assert.equal(restored.questionCount,5);
 assert.throws(()=>applyExamPreset(preset,profiles,{a:[],b:[]},{}),/단원/);
});

test('잘못된 비율·중복 묶음·1,000문항 초과를 거부한다',()=>{
 const config=initialGroupedConfig(questions);
 config.subjects[0].weight=NaN;assert.throws(()=>compileGroupedRules(config,5),/비율/);
 config.subjects[0].weight=1;config.subjects[0].groups.push({...config.subjects[0].groups[0]});assert.throws(()=>compileGroupedRules(config,5),/중복/);
 assert.throws(()=>run(initialGroupedConfig(questions),5,201),/1,000/);
});
test('교재 간 같은 단원은 한 시험지에서 중복 선택하지 않는다',()=>{
 const config=initialGroupedConfig(questions);config.subjects[1].weight=0;config.subjects[0].bankWeights={a:1,b:1};
 for(let seed=0;seed<10;seed++) for(const exam of run(config,4,4,{seed})) assert.equal(new Set(exam.map(c=>lookup.get(c).unitKey)).size,4);
});
test('여러 부에 필요한 묶음 문항 부족을 추첨 전 검출한다',()=>{
 const config=initialGroupedConfig(questions);config.subjects[1].weight=0;config.subjects[0].groups=[{units:['수학1:0'],count:1}];
 assert.throws(()=>run(config,1,40),/미사용 문항 30개.*40개/);
});
