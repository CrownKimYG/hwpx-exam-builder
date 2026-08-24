import test from "node:test";
import assert from "node:assert/strict";
import {
  createBankProfile,
  describeBankFolder,
  fileAnalysisCacheKey,
  findMatchingBankProfile,
  hydrateBankAnalysis,
  serializeBankAnalysis,
} from "./bank-cache-model.js";

function bankFile(relativePath, size, lastModified = 100) {
  return {
    name: relativePath.split("/").at(-1),
    webkitRelativePath: relativePath,
    size,
    lastModified,
  };
}

test("선택 폴더의 루트 이름과 파일 명세를 만든다", () => {
  const descriptor = describeBankFolder([
    bankFile("수특 변형/01.hwpx", 100),
    bankFile("수특 변형/하위/02.hwp", 200),
  ]);
  assert.equal(descriptor.rootFolderName, "수특 변형");
  assert.equal(descriptor.fileCount, 2);
  assert.deepEqual(descriptor.manifest.map((item) => item.relativePath), ["수특 변형/01.hwpx", "수특 변형/하위/02.hwp"]);
});

test("파일 일부가 바뀐 같은 폴더의 저장 프로필을 찾는다", () => {
  const original = describeBankFolder([
    bankFile("은행/01.hwpx", 100),
    bankFile("은행/02.hwpx", 200),
    bankFile("은행/03.hwpx", 300),
  ]);
  const changed = describeBankFolder([
    bankFile("은행/01.hwpx", 100),
    bankFile("은행/02.hwpx", 250, 200),
    bankFile("은행/03.hwpx", 300),
  ]);
  const profile = createBankProfile({ displayName: "내 문제은행", descriptor: original, bankId: "bank-1" });
  const match = findMatchingBankProfile([profile], changed);
  assert.equal(match.profile.bankId, "bank-1");
  assert.equal(match.confidence, "likely");
});

test("동명이지만 파일 구성이 다른 폴더는 자동 연결하지 않는다", () => {
  const original = describeBankFolder([bankFile("은행/01.hwpx", 100)]);
  const other = describeBankFolder([bankFile("은행/99.hwpx", 999)]);
  const profile = createBankProfile({ displayName: "원본", descriptor: original, bankId: "bank-1" });
  assert.equal(findMatchingBankProfile([profile], other), null);
});

test("매크로 복사 분석은 DOM 필드 없이 저장하고 복원한다", () => {
  const analysis = {
    filename: "01.hwpx",
    questions: [{
      ordinal: 1,
      copyMode: "root-endnote-block",
      sectionName: "Contents/section0.xml",
      copyStart: 4,
      copyEnd: 8,
      hasEndnote: true,
      questionText: "문제",
      warnings: [],
      questionElements: [{ nodeType: 1 }],
    }],
  };
  const serialized = serializeBankAnalysis(analysis);
  assert.equal(Object.hasOwn(serialized.questions[0], "questionElements"), false);
  const hydrated = hydrateBankAnalysis(serialized);
  assert.deepEqual(hydrated.questions[0].questionElements, []);
  assert.equal(hydrated.questions[0].copyStart, 4);
});

test("파일 캐시 키는 문제은행과 파일 변경 정보를 포함한다", () => {
  const identity = { relativePath: "은행/01.hwp", size: 10, lastModified: 20 };
  assert.notEqual(fileAnalysisCacheKey("a", identity), fileAnalysisCacheKey("b", identity));
  assert.notEqual(fileAnalysisCacheKey("a", identity), fileAnalysisCacheKey("a", { ...identity, size: 11 }));
});
