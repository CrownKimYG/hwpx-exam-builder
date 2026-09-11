// QA reproduction probes; synthetic input only. Run: pnpm exec node scripts/qa-core-edge-cases.mjs
import JSZip from "jszip";
import {JSDOM} from "jsdom";
import {parseHwpx} from "../web/src/parser.js";
const w = new JSDOM('').window;
Object.assign(globalThis,{DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer,Node:w.Node});
const sec = body => `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
const p = (text, attrs='') => `<hp:p ${attrs}><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`;
const q = text => `<hp:p><hp:run><hp:t>${text}</hp:t><hp:ctrl><hp:endNote number="1"><hp:subList>${p('정답')}</hp:subList></hp:endNote></hp:ctrl></hp:run></hp:p>`;
async function run(zip){const b=await zip.generateAsync({type:'uint8array'}); return parseHwpx({name:'qa.hwpx',arrayBuffer:async()=>b});}
const z=new JSZip(); for(let i=0;i<12;i++)z.file(`Contents/section${i}.xml`,sec(q(`구역 ${i}`)));
console.log('SECTION_ORDER', (await run(z)).questions.map(q=>q.sectionName));
const m=new JSZip();m.file('Contents/section0.xml',sec(q('마지막 문항 시작')+p('다음 쪽에 이어지는 필수 조건','pageBreak="1"')+p('마지막 선택지')));
const result=await run(m);console.log('LAST_QUESTION',result.questions.map(q=>({text:q.questionText,copyStart:q.copyStart,copyEnd:q.copyEnd})));
