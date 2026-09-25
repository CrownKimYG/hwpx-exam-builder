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
 const state={questions,exams:[],quick:{questionCount:5,examCount:7,bankCounts:{},cells:{}},bankProfiles:[{bankId:'a',displayName:'교재'}]};
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
