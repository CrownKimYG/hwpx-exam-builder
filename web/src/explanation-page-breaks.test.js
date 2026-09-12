import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { collapseExplanationPageBreaks } from './template-builder.js';

const w = new JSDOM('').window;
const p = (body = '', pageBreak = 1) => `<p pageBreak="${pageBreak}"><run>${body}</run></p>`;
const parse = body => new w.DOMParser().parseFromString(`<sec>${body}</sec>`, 'application/xml');

test('해설 앞 빈 문단의 연속 페이지 나눔은 하나만 남기고 단 설정은 보존한다', () => {
  const columns = '<ctrl><colPr colCount="2" sameGap="2268"/></ctrl>';
  const d = parse(p('<t>해설 및 채점표</t>') + p(columns) + p() + p('<t>#해설</t>'));
  const marker = d.documentElement.lastElementChild;
  collapseExplanationPageBreaks(marker);
  assert.deepEqual([...d.querySelectorAll('p')].map(n => n.getAttribute('pageBreak')), ['1', '1', '0', '0']);
  assert.equal(d.querySelector('colPr').getAttribute('colCount'), '2');
  assert.equal(marker.textContent, '#해설');
  collapseExplanationPageBreaks(marker);
  assert.equal(marker.getAttribute('pageBreak'), '0');
});

test('표지·그림·명시적 빈 페이지 제어 뒤 해설의 페이지 나눔은 유지한다', () => {
  for (const body of ['<t>해설 표지</t>', '<tbl/>', '<pic/>', '<ctrl><pageHiding hidePageNum="1"/></ctrl>']) {
    const d = parse(p(body) + p('<t>#해설</t>'));
    const marker = d.documentElement.lastElementChild;
    collapseExplanationPageBreaks(marker);
    assert.equal(marker.getAttribute('pageBreak'), '1', body);
  }
});

test('페이지 나눔 없는 여백 문단과 표 내부 해설 표식은 바꾸지 않는다', () => {
  const d = parse(p('', 0) + p('<t>#해설</t>'));
  collapseExplanationPageBreaks(d.documentElement.lastElementChild);
  assert.equal(d.documentElement.lastElementChild.getAttribute('pageBreak'), '1');
  const nested = parse(`<tbl><subList>${p()}${p('<t>#해설</t>')}</subList></tbl>`);
  const marker = nested.querySelector('subList').lastElementChild;
  collapseExplanationPageBreaks(marker);
  assert.equal(marker.getAttribute('pageBreak'), '1');
});
