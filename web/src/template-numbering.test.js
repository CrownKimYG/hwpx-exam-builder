import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { buildExamFromSourcesHwpx, validateGeneratedExamHwpx } from './template-builder.js';
const w = new JSDOM('').window;
globalThis.DOMParser = w.DOMParser;
globalThis.XMLSerializer = w.XMLSerializer;
const parse = s => new DOMParser().parseFromString(s, 'application/xml');
const all = (n, t) => [...n.getElementsByTagNameNS('*', t)];
const p = text => `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
const section = body => `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;

test('템플릿 개요와 문단 번호 참조를 병합·정리 후에도 보존하고 누락을 검출한다', async () => {
  const base = await fs.readFile(new URL('../public/templates/basic-math-exam.hwpx', import.meta.url));
  const source = await JSZip.loadAsync(base), template = await JSZip.loadAsync(base);
  for (const [zip, start] of [[source, '3'], [template, '7']]) {
    const h = parse(await zip.file('Contents/header.xml').async('string'));
    let nums = all(h, 'numberings')[0];
    if (!nums) {
      nums = h.createElementNS(h.documentElement.namespaceURI, 'hh:numberings');
      all(h, 'refList')[0].insertBefore(nums, all(h, 'paraProperties')[0]);
    }
    nums.innerHTML = `<hh:numbering xmlns:hh="${h.documentElement.namespaceURI}" id="1" start="${start}"/>`;
    nums.setAttribute('itemCnt', '1');
    for (const heading of all(h, 'heading')) { heading.setAttribute('type', 'NUMBER'); heading.setAttribute('idRef', '1'); }
    zip.file('Contents/header.xml', new XMLSerializer().serializeToString(h));
  }
  source.file('Contents/section0.xml', section(p('문제').replace('</hp:run>', '<hp:ctrl><hp:endNote number="1"><hp:subList>' + p('[정답] 2') + p('[해설] 풀이') + '</hp:subList></hp:endNote></hp:ctrl></hp:run>')));
  template.file('Contents/section0.xml', section(p('#1').replace('<hp:t>', '<hp:secPr outlineShapeIDRef="1"/><hp:t>')));
  const q = { fileCode: 'a', code: '01-001', ordinal: 1, sectionName: 'Contents/section0.xml', copyMode: 'root-endnote-block', copyStart: 0, copyEnd: 1, hasEndnote: true };
  const bytes = await buildExamFromSourcesHwpx([{ id: 'a', bytes: await source.generateAsync({ type: 'uint8array' }) }], await template.generateAsync({ type: 'uint8array' }), [q]);
  const z = await JSZip.loadAsync(bytes), h = parse(await z.file('Contents/header.xml').async('string')), s = parse(await z.file('Contents/section0.xml').async('string'));
  const nums = new Map(all(h, 'numbering').map(n => [n.getAttribute('id'), n]));
  assert.equal(nums.get(all(s, 'secPr')[0].getAttribute('outlineShapeIDRef')).getAttribute('start'), '7');
  for (const heading of all(h, 'heading').filter(n => n.getAttribute('type') === 'NUMBER')) assert.ok(nums.has(heading.getAttribute('idRef')));
  await validateGeneratedExamHwpx(bytes, { expectedQuestionCount: 1 });
  all(h, 'numberings')[0].replaceChildren();
  all(h, 'numberings')[0].setAttribute('itemCnt', '0');
  z.file('Contents/header.xml', new XMLSerializer().serializeToString(h));
  await assert.rejects(validateGeneratedExamHwpx(await z.generateAsync({ type: 'uint8array' }), { expectedQuestionCount: 1 }), /존재하지 않는 서식 참조.*outlineShapeIDRef/);
});
