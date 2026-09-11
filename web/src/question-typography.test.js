import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createQuestionTypographyNormalizer} from './question-typography.js';
const w=new JSDOM('').window;globalThis.XMLSerializer=w.XMLSerializer;
const parse=x=>new w.DOMParser().parseFromString(x,'application/xml');
test('문제·미주 해설의 원본 글꼴과 수식 크기를 통일하고 굵게를 해제하고 수식·숨김을 보존한다',()=>{
 const h=parse('<head><fontfaces><fontface lang="HANGUL" fontCnt="2"><font id="0" face="바탕"/><font id="1" face="함초롬바탕"/></fontface></fontfaces><charProperties itemCnt="3"><charPr id="0" height="900"><fontRef hangul="0"/><ratio hangul="90"/><bold/></charPr><charPr id="1" height="1100"><fontRef hangul="1"/></charPr><charPr id="2" height="100" textColor="#FFFFFF"><fontRef hangul="0"/></charPr></charProperties></head>');
 const d=parse('<sec><p id="template"><run charPrIDRef="0"><t>템플릿</t></run></p><p id="copy"><run charPrIDRef="0"><t>문제</t><ctrl><endNote><subList><p><run charPrIDRef="2"><t>1</t></run><run charPrIDRef="1"><t>해설</t><equation baseUnit="1100" font="HYhwpEQ"><sz width="2200" height="1100"/><script>x^2=4</script></equation></run></p></subList></endNote></ctrl></run><linesegarray/></p></sec>');
 const n=createQuestionTypographyNormalizer(h);n([d.querySelector('#copy')]);
 const cs=new Map([...h.querySelectorAll('charPr')].map(c=>[c.id,c]));
 for(const r of d.querySelectorAll('#copy run:not([charPrIDRef="2"])')){const c=cs.get(r.getAttribute('charPrIDRef'));assert.equal(c.getAttribute('height'),'1000');assert.equal(c.querySelector('fontRef').getAttribute('hangul'),'1');}
 assert.equal(cs.get(d.querySelector('#copy > run').getAttribute('charPrIDRef')).querySelector('bold'),null);
 assert.ok(h.querySelector('charPr[id="0"] bold'));
 assert.equal(d.querySelector('#template run').getAttribute('charPrIDRef'),'0');
 assert.equal(d.querySelector('[charPrIDRef="2"]').textContent,'1');
 assert.equal(d.querySelector('equation').getAttribute('baseUnit'),'1000');
 assert.equal(d.querySelector('sz').getAttribute('width'),'2000');
 assert.equal(d.querySelector('script').textContent,'x^2=4');
 assert.equal(d.querySelectorAll('linesegarray').length,0);
 const before=new XMLSerializer().serializeToString(d);n([d.querySelector('#copy')]);assert.equal(new XMLSerializer().serializeToString(d),before);
});
