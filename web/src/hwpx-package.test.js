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
