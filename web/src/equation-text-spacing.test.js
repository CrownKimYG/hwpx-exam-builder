import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { separateEquationFromHangul } from './equation-text-spacing.js';
const w = new JSDOM('').window;
const parse = body => new w.DOMParser().parseFromString(`<p>${body}</p>`, 'application/xml').documentElement;
const eq = '<equation><script>f(2)+f(-2)=50</script></equation>';

test('한컴 2020: 수식 뒤 한글에 공백 한 칸을 넣고 수식과 반복 실행을 보존한다', () => {
  for (const body of [`<run>${eq}<t>일 때,</t></run>`, `<run>${eq}<t/></run><run><t>일 때,</t></run>`]) {
    const p = parse(body);
    separateEquationFromHangul(p);
    assert.equal([...p.querySelectorAll('t')].at(-1).textContent, ' 일 때,');
    assert.equal(p.querySelector('script').textContent, 'f(2)+f(-2)=50');
    const before = p.outerHTML;
    separateEquationFromHangul(p);
    assert.equal(p.outerHTML, before);
  }
});

test('기존 공백·줄바꿈·탭·문장부호 뒤나 다른 문단에는 공백을 추가하지 않는다', () => {
  for (const text of [' 일 때', '\u00a0일 때', '<lineBreak/>일 때', '<tab/>일 때', ', 일 때', 'x']) {
    const p = parse(`<run>${eq}<t>${text}</t></run>`), before = p.outerHTML;
    separateEquationFromHangul(p);
    assert.equal(p.outerHTML, before);
  }
  const p = parse('<run><t>일 때</t></run>');
  separateEquationFromHangul(p);
  assert.equal(p.textContent,'일 때');
});
