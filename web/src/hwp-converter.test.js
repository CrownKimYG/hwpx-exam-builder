import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  bankPreviewBytes,
  convertedHwpxName,
  detectSourceImageFormat,
  detectBankFormat,
  hwpConversionError,
  isSupportedBankFile,
  normalizeBankFile,
  normalizeConvertedHwpx,
  repairConvertedHwpxBinData,
} from "./hwp-converter.js";

test("HWP 미리보기는 이미지가 보정된 변환 HWPX 바이트를 사용한다", () => {
  const sourceBytes = new Uint8Array([1, 2, 3]);
  const convertedBytes = new Uint8Array([4, 5, 6]);
  assert.deepEqual(bankPreviewBytes({
    bytes: convertedBytes,
    sourceBytes,
    convertedFromHwp: true,
  }), convertedBytes);
  assert.deepEqual(bankPreviewBytes({
    bytes: convertedBytes,
    sourceBytes,
    convertedFromHwp: false,
  }), convertedBytes);
});

test("수능특강 원본 미리보기와 생성용 전처리 바이트를 구분한다", () => {
  const previewBytes = new Uint8Array([1, 2]);
  const bytes = new Uint8Array([3, 4]);
  assert.equal(bankPreviewBytes({ previewBytes, bytes }), previewBytes);
});

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
  source.file("Contents/section0.xml", '<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp" xmlns:hc="urn:hc"><hp:p hp:paraPrIDRef="6"><hp:pic><hp:shapeComment>원본 그림의 이름: 5.jpg</hp:shapeComment><hc:img binaryItemIDRef="image5"/></hp:pic><hp:endNote hp:number="1" hp:instId="1"/></hp:p><hp:p><hp:endNote hp:number="1" hp:instId="1"/></hp:p></hs:sec>');
  source.file("BinData/image5.jpg", new Uint8Array([1, 2, 3, 4]));
  const normalized = await normalizeConvertedHwpx(await source.generateAsync({ type: "uint8array" }));
  const result = await JSZip.loadAsync(normalized);
  const header = await result.file("Contents/header.xml").async("string");
  const section = await result.file("Contents/section0.xml").async("string");
  assert.ok(!header.includes("binaryItemIDRef"));
  assert.match(section, /paraPrIDRef="6"/);
  assert.ok(!section.includes("hp:paraPrIDRef"));
  assert.match(section, /number="1" instId="1"/);
  assert.match(section, /number="2" instId="2"/);
  assert.match(section, /<hp:pic>/);
  assert.match(section, /원본 그림의 이름: 5\.jpg/);
  assert.ok(!section.includes("⑤"));
  assert.deepEqual([...await result.file("BinData/image5.jpg").async("uint8array")], [1, 2, 3, 4]);
});

test("원본 이미지 형식을 파일 시그니처로 판별한다", () => {
  assert.deepEqual(
    detectSourceImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    { extension: "png", mediaType: "image/png" },
  );
  assert.deepEqual(
    detectSourceImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xdb])),
    { extension: "jpg", mediaType: "image/jpeg" },
  );
  assert.equal(detectSourceImageFormat(new Uint8Array([1, 2, 3, 4])), null);
});

test("HWP 원본 이미지로 잘못 변환된 BinData와 manifest를 보정한다", async () => {
  const wrongChoiceFive = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 5]);
  const sourcePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
  const source = new JSZip();
  source.file("Contents/content.hpf", [
    '<opf:package xmlns:opf="urn:opf"><opf:manifest>',
    '<opf:item id="image5" href="BinData/image5.jpg" media-type="image/jpeg" isEmbeded="1"/>',
    '<opf:item id="image181" href="BinData/image181.jpg" media-type="image/jpeg" isEmbeded="1"/>',
    "</opf:manifest></opf:package>",
  ].join(""));
  source.file("BinData/image5.jpg", wrongChoiceFive);
  source.file("BinData/image181.jpg", wrongChoiceFive);

  const repairedBytes = await repairConvertedHwpxBinData(
    await source.generateAsync({ type: "uint8array" }),
    (key) => {
      if (key === "bin:0:5:src") return wrongChoiceFive;
      if (key === "bin:0:181:src") return sourcePng;
      throw new Error("이미지 없음");
    },
  );
  const repaired = await JSZip.loadAsync(repairedBytes, { checkCRC32: true });
  const manifest = await repaired.file("Contents/content.hpf").async("string");

  assert.ok(repaired.file("BinData/image5.jpg"));
  assert.equal(repaired.file("BinData/image181.jpg"), null);
  assert.deepEqual([...await repaired.file("BinData/image181.png").async("uint8array")], [...sourcePng]);
  assert.match(manifest, /id="image181" href="BinData\/image181\.png" media-type="image\/png"/);
});
