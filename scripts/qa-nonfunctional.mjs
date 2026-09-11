// Bounded, synthetic non-functional probes. No real browser storage is changed.
// Run: pnpm exec node --expose-gc scripts/qa-nonfunctional.mjs
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import JSZip from 'jszip';
import {JSDOM} from 'jsdom';
import {parseHwpx} from '../web/src/parser.js';
import {reserveExamHistory} from '../web/src/exam-history.js';

const w = new JSDOM('').window;
Object.assign(globalThis, {DOMParser:w.DOMParser, XMLSerializer:w.XMLSerializer, Node:w.Node});
const sec = body => `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
const question = i => `<hp:p><hp:run><hp:t>합성 문항 ${i}</hp:t><hp:ctrl><hp:endNote number="${i}"><hp:subList><hp:p><hp:run><hp:t>정답 ${i}</hp:t></hp:run></hp:p></hp:subList></hp:endNote></hp:ctrl></hp:run></hp:p>`;
const input = bytes => ({name:'qa.hwpx',arrayBuffer:async()=>bytes});
const report = (name, result) => console.log(JSON.stringify({name,...result}));

for (const count of [100, 300, 600]) {
  const zip = new JSZip().file('Contents/section0.xml', sec(Array.from({length:count}, (_,i)=>question(i+1)).join('')));
  const bytes = await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  globalThis.gc?.();
  const before=process.memoryUsage().heapUsed;
  let last=performance.now(),maxDelay=0;
  const timer=setInterval(()=>{const now=performance.now();maxDelay=Math.max(maxDelay,now-last);last=now;},10);
  const start=performance.now();
  let result=await parseHwpx(input(bytes));
  const duration=performance.now()-start;
  const heapDelta=process.memoryUsage().heapUsed-before;
  await new Promise(resolve=>setTimeout(resolve,15));clearInterval(timer);
  report('parse-performance',{count,actual:result.questions.length,zipBytes:bytes.length,ms:Math.round(duration),maxTimerGapMs:Math.round(maxDelay),heapDeltaMiB:Math.round(heapDelta/1048576)});
  result=null;
}

for (const [label, bytes] of [
  ['not-a-zip',new TextEncoder().encode('not a document')],
  ['no-section',await new JSZip().file('mimetype','application/hwp+zip').generateAsync({type:'uint8array'})],
  ['malformed-xml',await new JSZip().file('Contents/section0.xml','<broken>').generateAsync({type:'uint8array'})],
]) {
  try {await parseHwpx(input(bytes));report(label,{rejected:false});}
  catch(error){report(label,{rejected:true,message:error.message.slice(0,180)});}
}

// Tiny payload; only central-directory metadata claims >256 MiB. No large allocation.
const oversized = Buffer.from(await new JSZip().file('Contents/section0.xml',sec(question(1))).generateAsync({type:'uint8array',compression:'DEFLATE'}));
const central=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
// JSZip may add the Contents/ directory; locate the file's central record explicitly.
let record=central;
while(record>=0){
  const nameLength=oversized.readUInt16LE(record+28);
  const name=oversized.subarray(record+46,record+46+nameLength).toString();
  if(name==='Contents/section0.xml'){oversized.writeUInt32LE(256*1024*1024+1,record+24);break;}
  record=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),record+4);
}
try {await parseHwpx(input(oversized));report('oversized-metadata',{rejected:false});}
catch(error){report('oversized-metadata',{rejected:true,message:error.message});}

// Inject a failed IndexedDB open without touching any installed browser.
let openCalls=0;
globalThis.indexedDB={open(){openCalls++;const request=new EventTarget();request.error=new Error('QA transient open failure');queueMicrotask(()=>request.dispatchEvent(new Event('error')));return request;}};
const cache=await import('../web/src/bank-cache.js');
const cacheErrors=[];
for(let i=0;i<2;i++){try{await cache.listBankProfiles();}catch(error){cacheErrors.push(error.message);}}
report('indexeddb-retry',{attempts:2,openCalls,errors:cacheErrors});

// Execute the exact default-template function in a VM with a transient fetch failure.
const source=await fs.readFile(new URL('../web/src/main.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('async function getDefaultTemplateBytes()'),source.indexOf('\nfunction templateValuesFor('));
let fetchCalls=0;
const context=vm.createContext({templateState:{},DEFAULT_TEMPLATE_URL:'/qa.hwpx',Uint8Array,fetch:async()=>{fetchCalls++;if(fetchCalls===1)throw new Error('QA transient network failure');return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};}});
vm.runInContext(snippet,context);
const fetchErrors=[];
for(let i=0;i<2;i++){try{await vm.runInContext('getDefaultTemplateBytes()',context);}catch(error){fetchErrors.push(error.message);}}
report('default-template-retry',{attempts:2,fetchCalls,errors:fetchErrors});

// Confirm capacity failures are propagated instead of reporting a successful reservation.
const storage={getItem:()=>null,setItem(){throw new Error('QA quota exceeded');}};
try {reserveExamHistory(storage,[{codes:['01-001'],historyId:'qa'}],[{code:'01-001',bankId:'qa',sourcePath:'qa.hwpx',ordinal:1}]);report('history-quota',{propagated:false});}
catch(error){report('history-quota',{propagated:true,message:error.message});}

// Exercise the exact SVG filter without enabling external resources or scripts.
const svgSnippet=source.slice(source.indexOf('function safeSvg('),source.indexOf('\nfunction applyZoom('));
const svgContext=vm.createContext({DOMParser:w.DOMParser,document:w.document});
vm.runInContext(svgSnippet,svgContext);
svgContext.svgInput='<svg xmlns="http://www.w3.org/2000/svg" onload="qa()"><script>qa()</script><foreignObject/><image href="https://example.invalid/qa.png"/><style>@import url("https://example.invalid/qa.css");</style><rect style="fill:url(https://example.invalid/qa.svg#x)"/></svg>';
const safe=vm.runInContext('safeSvg(svgInput,"QA")',svgContext);
report('svg-filter',{scriptCount:safe.querySelectorAll('script').length,foreignObjectCount:safe.querySelectorAll('foreignObject').length,onload:safe.getAttribute('onload'),externalImageHref:safe.querySelector('image').getAttribute('href'),cssExternalReferenceRetained:safe.outerHTML.includes('https://example.invalid/')});
