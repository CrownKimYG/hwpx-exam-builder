import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeRubricCriterion } from './rubric-content.js';
const w = new JSDOM('').window;
const p = body => `<p><run>${body}</run><linesegarray/></p>`;
const eq = script => `<equation><script>${script.replaceAll('&','&amp;').replaceAll('<','&lt;')}</script><sz width="1000" height="1000"/></equation>`;
const fixture = (solution, criterion) => {
  const d = new w.DOMParser().parseFromString(`<endNote><subList>${p(solution)}${p(`<tbl><tr><tc><subList>${criterion}</subList></tc></tr></tbl>`)}</subList></endNote>`, 'application/xml');
  const table = d.querySelector('tbl'), list = table.querySelector('subList');
  return { d, table, list };
};

test('여러 문단과 강제 줄바꿈을 한 문단으로 합치며 기존 연결 문구와 수식을 보존한다', () => {
  const {table,list} = fixture('', p(eq('a>0')+'<t>일 때,<lineBreak/> 조건 </t>')+p(eq('3<a<4')+'<t>에서 값을 구함</t>'));
  normalizeRubricCriterion(list,table);
  assert.equal(list.children.length,1);
  assert.equal(list.querySelectorAll('lineBreak, linesegarray').length,0);
  assert.match(list.textContent,/일 때,\s+조건/);
  assert.match(list.textContent,/에서 값을 구함/);
  assert.deepEqual([...list.querySelectorAll('script')].map(n=>n.textContent),['a>0','3<a<4']);
});

test('수능완성 37번처럼 중간 수식을 생략한 기준에는 해설에 있는 일 때를 복원한다', () => {
  const solution = eq('a>b')+'<t>일 때 </t>'+eq('M')+eq('=a+b, m')+eq('=0')+'<t>이므로 </t>'+eq('M-m')+eq('=a+b')+eq('=12');
  const {table,list} = fixture(solution,p(eq('a>b'))+p(eq('M-m')+eq('=a+b')+eq('=12')));
  normalizeRubricCriterion(list,table);
  assert.match(list.textContent,/a>b 일 때/);
  assert.equal(list.children.length,1);
});

test('인접 수식의 에서·또는 문구를 그대로 복원하고 재실행해도 중복하지 않는다', () => {
  const {table,list} = fixture(eq('a>0')+'<t>에서 </t>'+eq('3<a<4')+'<t>또는 </t>'+eq('a=5'),p(eq('a>0'))+p(eq('3<a<4'))+p(eq('a=5')));
  normalizeRubricCriterion(list,table);
  assert.match(list.textContent,/에서/); assert.match(list.textContent,/또는/);
  const before=list.outerHTML;
  normalizeRubricCriterion(list,table);
  assert.equal(list.outerHTML,before);
});

test('같은 수식의 연결 문구가 서로 다르거나 원문에 없으면 추측해서 추가하지 않는다', () => {
  const {table,list} = fixture(eq('a>0')+'<t>일 때 </t>'+eq('a>0')+'<t>에서 </t>',p(eq('a>0'))+p(eq('3<a<4')));
  normalizeRubricCriterion(list,table);
  assert.equal(list.querySelectorAll('t').length,1); // paragraph separator only
  assert.equal([...list.querySelectorAll('t')].map(n=>n.textContent).join('').trim(),'');
});
