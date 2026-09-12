import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {JSDOM} from 'jsdom';
import {buildExamFromSourcesHwpx} from './template-builder.js';
const w=new JSDOM('').window;globalThis.DOMParser=w.DOMParser;globalThis.XMLSerializer=w.XMLSerializer;
const hp='http://www.hancom.co.kr/hwpml/2011/paragraph',hs='http://www.hancom.co.kr/hwpml/2011/section';
const parse=s=>new DOMParser().parseFromString(s,'application/xml');
const xml=n=>new XMLSerializer().serializeToString(n);
const all=(n,t)=>[...n.getElementsByTagNameNS('*',t)];
const p=(id,text)=>`<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
const section=body=>`<hs:sec xmlns:hs="${hs}" xmlns:hp="${hp}">${body}</hs:sec>`;
test('실제 조립에서 템플릿 제목·누름틀 값·고정 문구 서식을 보존하고 복사한 문제와 미주만 통일한다',async()=>{
 const base=await fs.readFile(new URL('../public/templates/basic-math-exam.hwpx',import.meta.url));
 const template=await JSZip.loadAsync(base),source=await JSZip.loadAsync(base);
 const th=parse(await template.file('Contents/header.xml').async('string'));
 const style=all(th,'charPr')[0];style.setAttribute('height','2300');
 style.appendChild(th.createElementNS(style.namespaceURI,'hh:bold'));
 template.file('Contents/header.xml',xml(th));
 const controls='<hp:secPr><hp:pagePr width="59528"><hp:margin left="4000" right="4000"/></hp:pagePr></hp:secPr>';
 template.file('Contents/section0.xml',section(p(1,'템플릿 제목')+p(2,'입력된 시험지 이름')+p(3,'#1').replace('<hp:t>',controls+'<hp:t>')+p(4,'고정 문구')+p(5,'마지막 페이지 입니다.')+p(6,'해설 및 채점표').replace('<hp:p ', '<hp:p pageBreak="1" ')+p(8,'').replace('<hp:p ', '<hp:p pageBreak="1" ')+p(7,'#해설').replace('<hp:p ', '<hp:p pageBreak="1" ')));
 source.file('Contents/section0.xml',section(p(11,'원본 문제').replace('</hp:run>',`<hp:ctrl><hp:endNote number="1"><hp:subList>${p(12,'[정답] 2')}${p(13,'[해설] 원본 풀이')}</hp:subList></hp:endNote></hp:ctrl></hp:run>`)));
 const cached = await template.file('Contents/section0.xml').async('string');
 template.file('Contents/section0.xml', cached.replaceAll('</hp:p>', '<hp:linesegarray><hp:lineseg textpos="0" vertpos="12345"/></hp:linesegarray></hp:p>'));
 const q={fileCode:'a',code:'01-001',ordinal:1,sectionName:'Contents/section0.xml',copyMode:'root-endnote-block',copyStart:0,copyEnd:1,hasEndnote:true};
 const output=await buildExamFromSourcesHwpx([{id:'a',bytes:await source.generateAsync({type:'uint8array'})}],await template.generateAsync({type:'uint8array'}),[q], {includeSolutions:true});
 const z=await JSZip.loadAsync(output),d=parse(await z.file('Contents/section0.xml').async('string')),h=parse(await z.file('Contents/header.xml').async('string'));
 const styles=new Map(all(h,'charPr').map(n=>[n.getAttribute('id'),n]));
 for(const label of ['템플릿 제목','입력된 시험지 이름','고정 문구']){
  const t=all(d,'t').find(n=>n.textContent===label);assert.ok(t,label);
  const c=styles.get(t.parentElement.getAttribute('charPrIDRef'));assert.equal(c.getAttribute('height'),'2300');assert.ok(all(c,'bold').length);
 }
 for(const label of ['원본 문제','[정답] 2','[해설] 원본 풀이']){
  const t=all(d,'t').find(n=>n.textContent.includes(label));assert.ok(t,label);
  const c=styles.get(t.parentElement.getAttribute('charPrIDRef'));assert.equal(c.getAttribute('height'),'1000');assert.equal(all(c,'bold').length,0);
 }
 assert.ok(all(d,'t').some(t=>t.textContent==='해설 및 채점표'));
 assert.ok(all(d,'p').some(p=>p.getAttribute('id')==='7' && p.getAttribute('pageBreak')==='0'));
 assert.ok(all(d,'p').some(p=>p.getAttribute('id')==='8' && p.getAttribute('pageBreak')==='1'));
 assert.equal(all(d,'t').some(t=>t.textContent==='#해설'),false);
 assert.equal(all(d,'linesegarray').length,0,'fixed template content must also lose stale line positions');
 assert.equal(all(d,'pagePr')[0].getAttribute('width'),'59528');
});
