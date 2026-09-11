import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { buildExamFromSourcesHwpx, buildExamFromTemplateHwpx } from './template-builder.js';
import { buildExamHwpx } from './parser.js';
import { removeSourceHeadersAndFooters, preprocessSourceContent, sourceSolutionBannerIds } from './source-preprocess.js';
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
for (const mode of ['single', 'mixed', 'basic', 'detached']) {
 test(`${mode} HWPX 생성은 원본 머리말·꼬리말을 제외한다`, async () => {
  const base = await fs.readFile(new URL('../public/templates/basic-math-exam.hwpx', import.meta.url));
  const source = await JSZip.loadAsync(base), template = await JSZip.loadAsync(base);
  source.file('Contents/section0.xml', section(p(controls('원본')+'<hp:t>문제 본문</hp:t><hp:ctrl><hp:endNote number="1"><hp:subList>'+p('<hp:t>정답 2</hp:t>')+'</hp:subList></hp:endNote></hp:ctrl>')));
  template.file('Contents/section0.xml', section(p(controls('양식')+'<hp:t>고정 문구</hp:t>')+p('<hp:t>#1</hp:t>')));
  const bytes = await source.generateAsync({type:'uint8array'}), tb = await template.generateAsync({type:'uint8array'});
  const q = {fileCode:'a', ordinal:1, sectionName:'Contents/section0.xml', hasEndnote:true, copyMode:'root-endnote-block', copyStart:0, copyEnd:1, blockStart:0, blockEnd:1};
  if (mode === 'detached') {
   const doc = new DOMParser().parseFromString(section(p('<hp:t>[정답] 2</hp:t>')+p(controls('해설원본')+'<hp:t>[해설] 풀이</hp:t>')), 'application/xml');
   Object.assign(q, {copyMode:'parsed', answer:'2', questionElements:[doc.documentElement.firstElementChild], answerElement:doc.documentElement.firstElementChild, explanationElements:[doc.documentElement.lastElementChild]});
  }
  const out = mode === 'single' ? await buildExamFromTemplateHwpx(bytes,tb,[q],[1]) : ['mixed','detached'].includes(mode) ? await buildExamFromSourcesHwpx([{id:'a',bytes}],tb,[q],{includeSolutions:mode === 'detached'}) : await buildExamHwpx(bytes,[q],[1]);
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('Contents/section0.xml').async('string');
  assert.ok(!xml.includes('원본 머리말')); assert.ok(!xml.includes('원본 꼬리말')); assert.ok(!xml.includes('해설원본'));
  assert.ok(xml.includes('문제 본문'));
  if(mode !== 'basic') { assert.ok(xml.includes('양식 머리말')); assert.ok(xml.includes('양식 꼬리말')); }
 });
}

test('이미지 ID가 달라도 확인된 배너만 제거하고 넓은 도형과 문단 위치는 보존한다', async (t) => {
 const known = '9eaba86f53f060b9d92964a9ed561c20887c94b6d5a9a211104f97a0e25d8e13';
 const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
 t.mock.method(crypto.subtle, 'digest', async (algorithm, bytes) => bytes[0] === 42 ? Uint8Array.from(known.match(/../g), hex => parseInt(hex,16)).buffer : originalDigest(algorithm,bytes));
 const zip = new JSZip(); zip.file('BinData/banner.jpg',new Uint8Array([42])); zip.file('BinData/diagram.jpg',new Uint8Array([1]));
 const manifest = new DOMParser().parseFromString('<package><item id="random-banner" href="../BinData/banner.jpg"/><item id="diagram" href="BinData/diagram.jpg"/></package>','application/xml');
 const ids = await sourceSolutionBannerIds(zip,manifest);
 assert.deepEqual([...ids],['random-banner']);
 const pic = id => `<hp:pic><hp:img binaryItemIDRef="${id}"/></hp:pic>`;
 const doc = new DOMParser().parseFromString(section(p(pic('random-banner'))+p(pic('diagram'))),'application/xml');
 preprocessSourceContent(doc,ids);
 assert.equal(doc.documentElement.children.length,2);
 assert.equal(doc.getElementsByTagNameNS('*','pic').length,1);
 assert.equal(doc.getElementsByTagNameNS('*','img')[0].getAttribute('binaryItemIDRef'),'diagram');
});
