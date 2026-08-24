import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  convertedHwpxName,
  detectBankFormat,
  hwpConversionError,
  isSupportedBankFile,
  normalizeBankFile,
  normalizeConvertedHwpx,
} from "./hwp-converter.js";

test("HWP와 HWPX 문제은행 파일만 선택한다", () => {
  assert.equal(isSupportedBankFile({ name: "bank.hwp" }), true);
  assert.equal(isSupportedBankFile({ name: "bank.HWPX" }), true);
  assert.equal(isSupportedBankFile({ name: "bank.pdf" }), false);
  assert.equal(convertedHwpxName("수학.HWP"), "수학.hwpx");
  assert.equal(detectBankFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), "hwpx");
  assert.equal(detectBankFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), "hwp");
});

test("HWPX는 변환 모듈을 불러오지 않고 그대로 전달한다", async () => {
  const source = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "bank.hwpx");
  const result = await normalizeBankFile(source);
  assert.equal(result.parserFile, source);
  assert.equal(result.convertedFromHwp, false);
  assert.deepEqual([...result.bytes], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...result.sourceBytes], [0x50, 0x4b, 0x03, 0x04]);
});

test("HWP는 변환된 HWPX File과 바이트를 반환한다", async () => {
  const hwpSignature = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const source = new File([hwpSignature], "bank.hwp", { lastModified: 123 });
  Object.defineProperty(source, "_relativePath", { value: "folder/bank.hwp" });
  const converted = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);
  const result = await normalizeBankFile(source, {
    convertHwp: async () => converted,
    normalizeConverted: async (bytes) => bytes,
  });
  assert.equal(result.convertedFromHwp, true);
  assert.equal(result.parserFile.name, "bank.hwpx");
  assert.equal(result.parserFile._relativePath, "folder/bank.hwpx");
  assert.deepEqual([...result.bytes], [...converted]);
  assert.deepEqual([...result.sourceBytes], [...hwpSignature]);
});

test("암호화 HWP 오류를 사용자가 해결할 수 있는 문구로 바꾼다", () => {
  const source = Object.assign(new Error("암호화된 문서"), { name: "HwpEncryptedError" });
  assert.match(hwpConversionError(source).message, /암호를 해제/);
});

test("변환 HWPX 속성을 정규화하고 미주 번호를 다시 매긴다", async () => {
  const source = new JSZip();
  source.file("Contents/header.xml", '<hh:head xmlns:hh="urn:hh"><hh:img hh:binaryItemIDRef="0"/></hh:head>');
  source.file("Contents/section0.xml", '<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp"><hp:p hp:paraPrIDRef="6"><hp:endNote hp:number="1" hp:instId="1"/></hp:p><hp:p><hp:endNote hp:number="1" hp:instId="1"/></hp:p></hs:sec>');
  const normalized = await normalizeConvertedHwpx(await source.generateAsync({ type: "uint8array" }));
  const result = await JSZip.loadAsync(normalized);
  const header = await result.file("Contents/header.xml").async("string");
  const section = await result.file("Contents/section0.xml").async("string");
  assert.ok(!header.includes("binaryItemIDRef"));
  assert.match(section, /paraPrIDRef="6"/);
  assert.ok(!section.includes("hp:paraPrIDRef"));
  assert.match(section, /number="1" instId="1"/);
  assert.match(section, /number="2" instId="2"/);
});
