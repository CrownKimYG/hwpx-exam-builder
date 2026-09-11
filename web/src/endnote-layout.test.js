import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fitTemplateObjects } from './template-layout.js';
import { hideEndnoteNumberFormatting } from './template-builder.js';
const window = new JSDOM('').window;
globalThis.XMLSerializer = window.XMLSerializer;
const parse = (xml) => new window.DOMParser().parseFromString(xml, 'application/xml');
const header = () => parse('<head><refList><charProperties itemCnt="1"><charPr id="0" height="900" textColor="#000000"/></charProperties><paraProperties><paraPr id="0"/></paraProperties></refList></head>');
const table = `<tbl colCnt="2" cellSpacing="0"><sz width="8000" widthRelTo="ABSOLUTE"/><tr><tc hasMargin="1"><cellAddr colAddr="0"/><cellSpan colSpan="1"/><cellSz width="6000"/><cellMargin left="100" right="100"/><subList><p paraPrIDRef="0"><run><equation baseUnit="1000"><sz width="5000" height="1000"/><script>x = 123</script></equation></run></p></subList></tc><tc><cellAddr colAddr="1"/><cellSpan colSpan="1"/><cellSz width="2000"/><subList><p><run><t>3점</t></run></p></subList></tc></tr></tbl>`;
const fixture = () => parse(`<sec><p><run><secPr><pagePr width="10000"><margin left="1000" right="1000"/></pagePr><endNotePr><placement place="END_OF_DOCUMENT"/></endNotePr></secPr><ctrl><colPr colCount="1"/></ctrl></run></p><p paraPrIDRef="0"><run charPrIDRef="0"><t>문제 본문</t><ctrl><endNote number="1"><subList><p paraPrIDRef="0"><run charPrIDRef="0"><ctrl><autoNum numType="ENDNOTE" num="1"/></ctrl><t>해설 본문</t>${table}</run></p></subList></endNote></ctrl></run></p><p><run><ctrl><colPr colCount="2" sameGap="400"/></ctrl></run></p></sec>`);

test('1단에서 삽입한 미주 표는 뒤쪽 2단 해설 너비에 맞추고 수식 원문은 유지한다', () => {
  const doc = fixture();
  const note = doc.querySelector('endNote');
  fitTemplateObjects([doc], header(), new Set([note]));
  assert.equal(note.querySelector('tbl > sz').getAttribute('width'), '3800');
  const widths = [...note.querySelectorAll('cellSz')].map(n => Number(n.getAttribute('width')));
  assert.deepEqual(widths, [2850, 950]);
  const equation = note.querySelector('equation');
  assert.equal(equation.querySelector('sz').getAttribute('width'), '2650');
  assert.equal(equation.querySelector('script').textContent, 'x = 123');
});

test('미주번호 숨김은 같은 run의 문제·해설·채점표를 숨기지 않는다', () => {
  const doc = fixture(), h = header();
  const before = doc.querySelector('tbl').outerHTML;
  hideEndnoteNumberFormatting(h, [doc]);
  const styles = new Map([...h.querySelectorAll('charPr')].map(n => [n.getAttribute('id'),n]));
  for (const marker of [doc.querySelector('endNote'),doc.querySelector('autoNum')]) {
    const style = styles.get(marker.closest('run').getAttribute('charPrIDRef'));
    assert.equal(style.getAttribute('textColor'), '#FFFFFF');
    assert.equal(style.getAttribute('height'), '100');
  }
  for (const text of [...doc.querySelectorAll('t')].filter(n => n.textContent.includes('본문'))) {
    assert.equal(text.closest('run').getAttribute('charPrIDRef'), '0');
  }
  assert.equal(doc.querySelector('tbl').outerHTML, before);
  assert.equal(doc.querySelectorAll('endNote').length, 1);
});
