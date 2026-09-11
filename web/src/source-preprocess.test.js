import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { buildExamFromSourcesHwpx, buildExamFromTemplateHwpx } from './template-builder.js';
import { buildExamHwpx } from './parser.js';
import { removeSourceHeadersAndFooters } from './source-preprocess.js';
const w = new JSDOM('').window;
globalThis.DOMParser = w.DOMParser; globalThis.XMLSerializer = w.XMLSerializer;
const hp = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const p = (text) => `<hp:p id="1" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">${text}</hp:run></hp:p>`;
const controls = (label) => `<hp:ctrl><hp:header id="100" applyPageType="BOTH"><hp:subList>${p(`<hp:t>${label} 머리말</hp:t>`)}</hp:subList></hp:header><hp:footer id="101" applyPageType="BOTH"><hp:subList>${p(`<hp:t>${label} 꼬리말</hp:t>`)}</hp:subList></hp:footer></hp:ctrl>`;
const section = (text) => `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="${hp}">${text}</hs:sec>`;
test('원본 전처리는 문항 인덱스와 같은 제어 묶음의 미주를 보존한다', () => {
 const d = new DOMParser().parseFromString(section(p(controls('원본')+'<hp:ctrl><hp:endNote number="1"/></hp:ctrl><hp:t>문제</hp:t>')+p('<hp:t>다음 문제</hp:t>')), 'application/xml');
 removeSourceHeadersAndFooters(d);
 assert.equal(d.documentElement.children.length, 2);
 assert.equal(d.getElementsByTagNameNS('*','endNote').length, 1);
 assert.equal(d.documentElement.textContent, '문제다음 문제');
});
for (const mode of ['single', 'mixed', 'basic']) {
 test(`${mode} HWPX 생성은 원본 머리말·꼬리말을 제외한다`, async () => {
  const base = await fs.readFile(new URL('../public/templates/basic-math-exam.hwpx', import.meta.url));
  const source = await JSZip.loadAsync(base), template = await JSZip.loadAsync(base);
  source.file('Contents/section0.xml', section(p(controls('원본')+'<hp:t>문제 본문</hp:t><hp:ctrl><hp:endNote number="1"><hp:subList>'+p('<hp:t>정답 2</hp:t>')+'</hp:subList></hp:endNote></hp:ctrl>')));
  template.file('Contents/section0.xml', section(p(controls('양식')+'<hp:t>고정 문구</hp:t>')+p('<hp:t>#1</hp:t>')));
  const bytes = await source.generateAsync({type:'uint8array'}), tb = await template.generateAsync({type:'uint8array'});
  const q = {fileCode:'a', ordinal:1, sectionName:'Contents/section0.xml', hasEndnote:true, copyMode:'root-endnote-block', copyStart:0, copyEnd:1, blockStart:0, blockEnd:1};
  const out = mode === 'single' ? await buildExamFromTemplateHwpx(bytes,tb,[q],[1]) : mode === 'mixed' ? await buildExamFromSourcesHwpx([{id:'a',bytes}],tb,[q]) : await buildExamHwpx(bytes,[q],[1]);
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('Contents/section0.xml').async('string');
  assert.ok(!xml.includes('원본 머리말')); assert.ok(!xml.includes('원본 꼬리말'));
  assert.ok(xml.includes('문제 본문'));
  if(mode !== 'basic') { assert.ok(xml.includes('양식 머리말')); assert.ok(xml.includes('양식 꼬리말')); }
 });
}
