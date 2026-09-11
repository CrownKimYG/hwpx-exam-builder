import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { applyTemplateFieldValues } from './template-fields.js';
const window = new JSDOM('').window;
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;
const begin = (id, name) => `<ctrl><fieldBegin id="${id}" type="CLICK_HERE" name="${name}"/></ctrl>`;
const end = id => `<ctrl><fieldEnd beginIDRef="${id}"/></ctrl>`;
async function fill(xml, values) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file('Contents/section0.xml', `<sec xmlns="http://www.hancom.co.kr/hwpml/2011/paragraph">${xml}</sec>`);
  const out = await JSZip.loadAsync(await applyTemplateFieldValues(await zip.generateAsync({ type: 'uint8array' }), values));
  return new DOMParser().parseFromString(await out.file('Contents/section0.xml').async('string'), 'application/xml');
}

test('same named fields retain each insertion point style instead of prompt style', async () => {
  const doc = await fill([['header','48'],['title','39']].map(([id, style]) =>
    `<p><run charPrIDRef="${style}">${begin(id,'title')}</run><run charPrIDRef="red"><t>{{title}}</t></run><run charPrIDRef="${style}">${end(id)}</run></p>`).join(''), {title:'실전 모의고사'});
  assert.deepEqual([...doc.querySelectorAll('t')].filter(t=>t.textContent).map(t=>[t.textContent,t.parentElement.getAttribute('charPrIDRef')]), [['실전 모의고사','48'],['실전 모의고사','39']]);
  assert.equal(doc.querySelectorAll('fieldBegin, fieldEnd').length,0);
});

test('replacing a prompt does not restyle adjacent text or unfilled fields', async () => {
  const doc = await fill(`<p><run charPrIDRef="input">${begin('a','time')}</run><run charPrIDRef="red"><t>{{time}}</t>${end('a')}<t>분</t>${begin('b','other')}<t>남김</t>${end('b')}</run></p>`, {time:80});
  assert.deepEqual([...doc.querySelectorAll('t')].map(t=>[t.textContent,t.parentElement.getAttribute('charPrIDRef')]), [['80','input'],['분','red'],['남김','red']]);
  assert.equal(doc.querySelectorAll('fieldBegin').length,1);
});

test('empty fields inherit the insertion style', async () => {
  const doc = await fill(`<p><run charPrIDRef="input">${begin('a','title')}</run><run charPrIDRef="input">${end('a')}</run></p>`, {title:'제목'});
  assert.equal(doc.querySelector('t').parentElement.getAttribute('charPrIDRef'),'input');
  assert.equal(doc.querySelector('t').textContent,'제목');
});
