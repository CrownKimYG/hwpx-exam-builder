// Synthetic archive repacking benchmark; does not measure complete HWPX export.
import JSZip from 'jszip';
import assert from 'node:assert/strict';
import { generateHwpxArchive } from '../web/src/archive.js';
const data=new Uint8Array(2*1024*1024);let seed=123456789;
for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=seed&255;}
const source=new JSZip().file('mimetype','application/hwp+zip').file('Contents/section0.xml','<section>문항</section>').file('BinData/image.png',data);
const input=await source.generateAsync({type:'uint8array',compression:'DEFLATE'});
const zip=await JSZip.loadAsync(input);
async function previous(zip) {
 const output=new JSZip();output.file('mimetype',await zip.file('mimetype').async('uint8array'),{compression:'STORE'});
 for(const entry of Object.values(zip.files))if(!entry.dir&&entry.name!=='mimetype')output.file(entry.name,await entry.async('uint8array'),{compression:'DEFLATE'});
 return output.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
}
for(const [name,generate] of [['previous',previous],['optimized',generateHwpxArchive]]) {
 const start=performance.now();let bytes;
 for(let i=0;i<3;i++)bytes=await generate(zip);
 const ms=Math.round(performance.now()-start);
 const result=await JSZip.loadAsync(bytes,{checkCRC32:true});
 assert.deepEqual(await result.file('BinData/image.png').async('uint8array'),data);
 assert.equal(await result.file('Contents/section0.xml').async('string'),'<section>문항</section>');
 console.log(JSON.stringify({name,repeats:3,binaryMiB:2,ms,bytes:bytes.length,crcAndPayload:'pass'}));
}
