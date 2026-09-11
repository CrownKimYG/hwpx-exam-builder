import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {fitTemplateObjects} from './template-layout.js';
const w=new JSDOM('').window;globalThis.XMLSerializer=w.XMLSerializer;
const parse=xml=>new w.DOMParser().parseFromString(xml,'application/xml');
const header=()=>parse(`<head><charProperties itemCnt="2"><charPr id="0" height="1200" textColor="#000000"><fontRef hangul="1"/><ratio hangul="100"/></charPr><charPr id="1" height="800" textColor="#FF0000"/></charProperties><paraProperties itemCnt="1"><paraPr id="0"><align horizontal="JUSTIFY" vertical="BASELINE"/><margin><left value="1500"/><right value="500"/><intent value="300"/></margin><lineSpacing type="PERCENT" value="160"/></paraPr></paraProperties></head>`);
const p=content=>`<p paraPrIDRef="0"><run charPrIDRef="1">${content}</run><linesegarray><lineseg horzsize="40000"/></linesegarray></p>`;
const cell=(col,row,content)=>`<tc hasMargin="1"><subList>${p(content)}</subList><cellAddr colAddr="${col}" rowAddr="${row}"/><cellSpan colSpan="1" rowSpan="1"/><cellSz width="${col?3500:42989}" height="3000"/><cellMargin left="400" right="400"/></tc>`;
const table=(base=800,label='채점 기준')=>`<tbl colCnt="2" rowCnt="2" cellSpacing="0"><sz width="46489" widthRelTo="ABSOLUTE"/><tr>${cell(0,0,`<t>${label}</t>`)}${cell(1,0,'<t>배점</t>')}</tr><tr>${cell(0,1,`<equation baseUnit="${base}"><sz width="${base*5}" height="${base*2}"/><script>x={1}over{2}</script></equation>`)}${cell(1,1,'<t>10점</t>')}</tr></tbl>`;
function fixture(){return parse(`<sec><p><run><secPr><pagePr width="50000"><margin left="3000" right="3000"/></pagePr><endNotePr><placement place="END_OF_DOCUMENT"/></endNotePr></secPr><ctrl><colPr colCount="1"/></ctrl></run></p><p><run><endNote><subList>${p(table(800))}${p(table(1200))}</subList></endNote></run></p><p><run><ctrl><colPr colCount="2" sameGap="2000"/></ctrl></run></p></sec>`);}

test('혼합 채점표는 같은 글자·수식 크기, 배점 고정 너비, 제목 가운데 정렬을 사용한다',()=>{
 const h=header(),d=fixture(),note=d.querySelector('endNote');
 fitTemplateObjects([d],h,new Set([note]));
 const cs=new Map([...h.querySelectorAll('charPr')].map(n=>[n.id,n]));
 const ps=new Map([...h.querySelectorAll('paraPr')].map(n=>[n.id,n]));
 for(const t of d.querySelectorAll('tbl')){
  assert.equal(t.querySelector('sz').getAttribute('width'),'18700'); // note paragraph margins
  assert.deepEqual([...t.querySelectorAll('cellSz')].map(n=>n.getAttribute('width')),['15100','3600','15100','3600']);
  for(const run of t.querySelectorAll('run')) {
   const style=cs.get(run.getAttribute('charPrIDRef'));
   assert.equal(style.getAttribute('height'),'1000');
   assert.equal(style.querySelector('bold'),null);
  }
  for(const cell of t.querySelectorAll('tr:first-of-type > tc, tr > tc:nth-of-type(2)')){
   assert.equal(ps.get(cell.querySelector('p').getAttribute('paraPrIDRef')).querySelector('align').getAttribute('horizontal'),'CENTER');
   assert.equal(cell.querySelector('subList').getAttribute('vertAlign'),'CENTER');
  }
  assert.equal(t.querySelector('equation').getAttribute('baseUnit'),'1000');
  assert.equal(t.querySelector('equation > sz').getAttribute('width'),'5000');
  assert.equal(t.querySelector('script').textContent,'x={1}over{2}');
  assert.equal(t.querySelectorAll('linesegarray').length,0);
 }
 const before=new XMLSerializer().serializeToString(d),beforeHeader=new XMLSerializer().serializeToString(h);
 fitTemplateObjects([d],h,new Set([note]));
 assert.equal(new XMLSerializer().serializeToString(d),before);
 assert.equal(new XMLSerializer().serializeToString(h),beforeHeader);
});

test('템플릿 자체 표와 일반 표의 글자 서식은 바꾸지 않는다',()=>{
 const h=header(),d=fixture();
 fitTemplateObjects([d],h,new Set());
 assert.equal(d.querySelector('equation').getAttribute('baseUnit'),'800');
 const generic=parse(`<sec><p><run><secPr><pagePr width="50000"><margin/></pagePr></secPr>${table(800,'일반 표')}</run></p></sec>`);
 fitTemplateObjects([generic],h,new Set([generic.querySelector('tbl')]));
 assert.equal(generic.querySelector('tbl run').getAttribute('charPrIDRef'),'1');
 assert.equal(generic.querySelector('equation').getAttribute('baseUnit'),'800');
});
