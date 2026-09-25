import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { generateHwpxArchive } from './archive.js';
import { finalizeHandoffHwpx, HANDOFF_METADATA_PATH } from './handoff.js';

test('HWPX export restores the first uncompressed signature and preserves payloads', async () => {
  const zip = new JSZip();
  zip.file('Contents/section0.xml', '<section>수학</section>');
  zip.file('mimetype', 'application/hwp+zip');
  zip.file(HANDOFF_METADATA_PATH, '{}');
  const input = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  for (const bytes of [await generateHwpxArchive(await JSZip.loadAsync(input)), await finalizeHandoffHwpx(input)]) {
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(header.getUint32(0, true), 0x04034b50);
    assert.equal(header.getUint16(8, true), 0);
    assert.equal(header.getUint16(28, true), 0);
    assert.equal(new TextDecoder().decode(bytes.slice(30, 38)), 'mimetype');
    const result = await JSZip.loadAsync(bytes, { checkCRC32: true });
    assert.equal(await result.file('Contents/section0.xml').async('string'), '<section>수학</section>');
  }
});

test('재포장 시 변경된 XML과 원본 바이너리를 보존하고 원본 패키지를 수정하지 않는다', async()=>{
 const binary=Uint8Array.from({length:10000},(_,i)=>i%251);
 const source=new JSZip().file('mimetype','application/hwp+zip').file('Contents/section0.xml','<original/>').file('BinData/test.png',binary);
 const zip=await JSZip.loadAsync(await source.generateAsync({type:'uint8array',compression:'DEFLATE'}));
 const originalNames=Object.keys(zip.files);
 const entry=zip.file('BinData/test.png');const originalOptions={...entry.options};
 // Repack must not ask an unchanged binary for its decompressed contents.
 entry.async=()=>{throw new Error('unexpected reinflation');};
 zip.file('Contents/section0.xml','<changed/>');
 const bytes=await generateHwpxArchive(zip);
 const result=await JSZip.loadAsync(bytes,{checkCRC32:true});
 assert.equal(await result.file('Contents/section0.xml').async('string'),'<changed/>');
 assert.deepEqual(await result.file('BinData/test.png').async('uint8array'),binary);
 assert.deepEqual(Object.keys(zip.files),originalNames);assert.deepEqual(entry.options,originalOptions);
 const repeated=await JSZip.loadAsync(await generateHwpxArchive(zip),{checkCRC32:true});
 assert.deepEqual(await repeated.file('BinData/test.png').async('uint8array'),binary);
});
