import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountExamWizard } from './exam-wizard.js';
import { compileGroupedRules } from './grouped-generator.js';

test('5단계 탐색, 이전 설정 유지, 묶음 편집, 결과·편집 화면 연결',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
 const doc=dom.window.document;
 const original=globalThis.Option;globalThis.Option=dom.window.Option;
 try {
 const questions=['수학1','수학2'].flatMap(subject=>[1,2,3].map(u=>({subject,bankId:'a',unitKey:`${subject}:${u}`,unitName:`단원${u}`})));
 const state={questions,exams:[],quick:{workflow:"single",questionCount:5,examCount:7,bankCounts:{},cells:{}},bankProfiles:[{bankId:'a',displayName:'교재'}]};
 const wizard=mountExamWizard({document:doc,getState:()=>state,questions:()=>questions,estimate:()=>{},rules:()=>compileGroupedRules(state.quick.grouped,5),save:()=>{}});
 const panels=()=>[...doc.querySelectorAll('.wizard-panel')].filter(p=>!p.hidden);
 const next=()=>doc.querySelector('.wizard-controls .primary').click();
 assert.equal(panels()[0].id,'wizard-panel-0');next();assert.equal(panels()[0].id,'wizard-panel-1');
 assert.ok(doc.querySelector('#wizard-panel-0 #quick-mode'));
 assert.ok(doc.querySelector('#bank-manager #active-bank-select'));
 const input=doc.querySelector('.wizard-ratios input');input.value='3';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 next();assert.equal(panels()[0].id,'wizard-panel-2');
 doc.querySelectorAll('.wizard-unit-picker button')[0].click();doc.querySelectorAll('.wizard-unit-picker button')[1].click();
 [...doc.querySelectorAll('.wizard-groups > button')][0].click();assert.equal(state.quick.grouped.subjects[0].groups.length,2);
 next();assert.equal(panels()[0].id,'wizard-panel-3');assert.ok(doc.querySelector('.wizard-review').textContent.includes('수학Ⅰ 3'));
 doc.querySelector('.wizard-controls button').click();doc.querySelector('.wizard-controls button').click();assert.equal(doc.querySelector('.wizard-ratios input').value,'3');
 state.exams.push({id:'exam-1',title:'시험지01',codesText:'01-001'});
 wizard.generated(1);assert.equal(panels()[0].id,'wizard-panel-4');assert.ok(panels()[0].querySelector('.wizard-results select'));
 next();assert.equal(doc.body.dataset.workspaceScreen,'papers');assert.equal(doc.querySelector('.exam-list-card').parentElement.className,'builder-panel');
 wizard.showScreen('draw');assert.ok(doc.querySelector('#wizard-panel-4 .wizard-results'));
 wizard.showScreen('banks');assert.equal(doc.querySelector('#bank-manager').open,true);
 doc.querySelector('.exam-settings').open=false;
 wizard.conditions();assert.equal(panels()[0].id,'wizard-panel-2');
 doc.querySelector('.wizard-steps button').click();assert.equal(doc.querySelector('.exam-settings').open,true);
 } finally {globalThis.Option=original;}
});

test('인문계 출제 → 자연계 출제 → 이번 두 계열만 다운로드', async()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
 const doc=dom.window.document, original=globalThis.Option; globalThis.Option=dom.window.Option;
 try {
  const questions=Array.from({length:8},(_,i)=>({subject:'수학1',bankId:'a',unitKey:`u${i}`,unitName:`단원${i}`}));
  const state={questions,exams:[{id:'old',title:'이전',codesText:'old'}],quick:{questionCount:7,examCount:1},bankProfiles:[{bankId:'a',displayName:'교재'}]};
  let downloaded;
  const wizard=mountExamWizard({document:doc,getState:()=>state,questions:()=>questions,estimate:()=>{},rules:()=>{},save:()=>{},download:async options=>{downloaded=options.examIds;}});
  const next=()=>doc.querySelector('.wizard-controls .primary').click();
  next();next();next(); assert.equal(wizard.activeTrack(),'인문계'); assert.throws(()=>wizard.difficulty());
  for(const [track,id] of [['인문계','human'],['자연계','natural']]) {
   const inputs=[...doc.querySelectorAll(`#wizard-panel-${track==='인문계'?3:4} .wizard-difficulty input`)];
   assert.ok(inputs.every(input=>input.value===''));
   inputs.forEach((input,i)=>{input.value=String([2,3,2][i]);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
   assert.deepEqual(wizard.difficulty(),{lv1:2,lv2:3,lv3:2});
   state.exams.push({id,title:track,codesText:'a b c d e f g'});wizard.generated(1);next();
  }
  doc.querySelector('.wizard-download .primary').click(); await Promise.resolve();
  assert.deepEqual(downloaded,['human','natural']);
  assert.equal(doc.querySelector('#wizard-panel-5').hidden,false);
 } finally {globalThis.Option=original;}
});

test('단원 묶음과 난이도 개수는 독립적이며 이전 묶음 난이도를 적용하지 않는다',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
 const doc=dom.window.document, original=globalThis.Option;globalThis.Option=dom.window.Option;
 try {
  const questions=[{subject:'수학Ⅰ',bankId:'a',unitKey:'u1',unitName:'단원1'}];
  const state={questions,exams:[],quick:{questionCount:1,examCount:1,grouped:{subjects:[{name:'수학Ⅰ',weight:1,bankWeights:null,groups:[{units:['u1'],count:1,difficulty:'lv3'}]}]}},bankProfiles:[{bankId:'a',displayName:'교재'}]};
  const wizard=mountExamWizard({document:doc,getState:()=>state,questions:()=>questions,estimate:()=>{},rules:()=>{},save:()=>{}});
  assert.equal(wizard.config().subjects[0].groups[0].difficulty,undefined);
  assert.equal(doc.querySelectorAll('.wizard-group select').length,1);
  const before=JSON.stringify(wizard.config());
  const next=()=>doc.querySelector('.wizard-controls .primary').click();next();next();next();
  const inputs=doc.querySelectorAll('#wizard-panel-3 .wizard-difficulty input');
  inputs.forEach((input,i)=>{input.value=String(i===0?1:0);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  assert.deepEqual(wizard.difficulty(),{lv1:1,lv2:0,lv3:0});
  assert.equal(JSON.stringify(wizard.config()),before);
 } finally {globalThis.Option=original;}
});

test('단원별과 묶음별 번호표 입력을 별도로 보존한다',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
 const doc=dom.window.document, original=globalThis.Option;globalThis.Option=dom.window.Option;
 try {
  const questions=[{subject:'수학Ⅰ',bankId:'a',unitKey:'u1',unitName:'단원1'}];
  const state={questions,exams:[],quick:{questionCount:1,examCount:1},bankProfiles:[{bankId:'a',displayName:'교재'}]};
  const wizard=mountExamWizard({document:doc,getState:()=>state,questions:()=>questions,estimate:()=>{},rules:()=>{},save:()=>{}});
  const choose=value=>{const select=doc.querySelector('[aria-label="수학Ⅰ 번호 설정"]');select.value=value;select.dispatchEvent(new dom.window.Event('change'));};
  choose('unit');let input=doc.querySelector('[aria-label="수학Ⅰ 단원1 하 출제 번호"]');input.value='1';input.dispatchEvent(new dom.window.Event('input'));
  choose('group');input=doc.querySelector('[aria-label="수학Ⅰ 묶음 1 · 단원1 중 출제 번호"]');input.value='1';input.dispatchEvent(new dom.window.Event('input'));
  const s=wizard.config().subjects[0];assert.equal(s.unitPositions.u1.lv1,'1');assert.equal(s.groups[0].positions.lv2,'1');
  choose('unit');assert.equal(doc.querySelector('[aria-label="수학Ⅰ 단원1 하 출제 번호"]').value,'1');
 }finally{globalThis.Option=original;}
});

test('전체 행과 전체 열 입력 및 모드별 보존',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
 const doc=dom.window.document, original=globalThis.Option;globalThis.Option=dom.window.Option;
 try {
  const questions=[{subject:'수학Ⅰ',bankId:'a',unitKey:'u1',unitName:'단원1'}];
  const state={questions,exams:[],quick:{questionCount:1,examCount:1},bankProfiles:[{bankId:'a',displayName:'교재'}]};
  const wizard=mountExamWizard({document:doc,getState:()=>state,questions:()=>questions,estimate:()=>{},rules:()=>{},save:()=>{}});
  const choose=value=>{const select=doc.querySelector('[aria-label="수학Ⅰ 번호 설정"]');select.value=value;select.dispatchEvent(new dom.window.Event('change'));};
  for(const [mode,label] of [['unit','단원 전체'],['group','묶음 전체']]) {
   choose(mode);const input=doc.querySelector(`[aria-label="수학Ⅰ ${label} 난이도 전체 출제 번호"]`);
   input.value='All';input.dispatchEvent(new dom.window.Event('input'));
   assert.equal(wizard.config().subjects[0].allPositions[mode].any,'All');
  }
  choose('unit');assert.equal(doc.querySelector('[aria-label="수학Ⅰ 단원 전체 난이도 전체 출제 번호"]').value,'All');
 }finally{globalThis.Option=original;}
});
