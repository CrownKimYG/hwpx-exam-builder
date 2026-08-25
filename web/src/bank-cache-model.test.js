import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_BANK_RULE_ID,
  DEFAULT_BANK_RULE_ID,
  EBSI_KOREAN_RULE_ID,
  createBankProfile,
  detectBankRule,
  detectBankRuleFromFilenames,
  describeBankFolder,
  fileAnalysisCacheKey,
  findMatchingBankProfile,
  hydrateBankAnalysis,
  migrateBankProfile,
  preferHwpxDuplicates,
  serializeBankAnalysis,
  updateBankProfileForFolder,
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

test("새 문제은행의 처리 방식은 문제은행 전체에 하나만 저장한다", () => {
  const descriptor = describeBankFolder([bankFile("은행/01.hwpx", 100)]);
  const profile = createBankProfile({ displayName: "은행", descriptor, bankId: "bank-1" });
  assert.equal(profile.ruleId, DEFAULT_BANK_RULE_ID);
  assert.equal(profile.subject, "수학");
  assert.equal(profile.fileSettings["은행/01.hwpx"].selectedRuleId, DEFAULT_BANK_RULE_ID);
  assert.equal(profile.fileSettings["은행/01.hwpx"].resolvedRuleId, DEFAULT_BANK_RULE_ID);
});

test("기존 캐시는 문제은행 단위 처리 방식으로 마이그레이션한다", () => {
  const descriptor = describeBankFolder([bankFile("은행/01.hwpx", 100)]);
  const migrated = updateBankProfileForFolder({
    schemaVersion: 1,
    bankId: "bank-1",
    displayName: "은행",
    rootFolderName: "은행",
    manifest: descriptor.manifest,
    ruleId: DEFAULT_BANK_RULE_ID,
    fileSettings: {},
  }, descriptor);
  assert.equal(migrated.ruleId, DEFAULT_BANK_RULE_ID);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.fileSettings["은행/01.hwpx"].selectedRuleId, DEFAULT_BANK_RULE_ID);
  assert.equal(migrated.fileSettings["은행/01.hwpx"].resolvedRuleId, DEFAULT_BANK_RULE_ID);
});

test("기존 EBSi 국어 파일별 캐시는 새 국어 유형으로 유지한다", () => {
  const descriptor = describeBankFolder([bankFile("국어/[26001]_EBS 2027 국어영역 문학_(315).hwpx", 100)]);
  const migrated = migrateBankProfile({
    schemaVersion: 2,
    bankId: "bank-korean",
    displayName: "국어",
    rootFolderName: "국어",
    manifest: descriptor.manifest,
    fileSettings: {
      [descriptor.manifest[0].relativePath]: {
        selectedRuleId: AUTO_BANK_RULE_ID,
        resolvedRuleId: EBSI_KOREAN_RULE_ID,
      },
    },
  });
  assert.equal(migrated.ruleId, EBSI_KOREAN_RULE_ID);
  assert.equal(migrated.subject, "국어");
});

test("파일명으로 처리 방식이 섞인 폴더를 거부한다", () => {
  const math = bankFile("은행/01.지수와 로그(01)_수학Ⅰ[36문제].hwpx", 100);
  const korean = bankFile("은행/[26001]_EBS 2027학년도 국어영역 문학_(315).hwpx", 200);
  assert.equal(detectBankRuleFromFilenames([math]), DEFAULT_BANK_RULE_ID);
  assert.equal(detectBankRuleFromFilenames([korean]), EBSI_KOREAN_RULE_ID);
  assert.throws(() => detectBankRuleFromFilenames([math, korean]), /함께 넣을 수 없습니다/);
});

test("같은 원본의 HWP와 HWPX가 있으면 HWPX만 사용한다", () => {
  const selected = preferHwpxDuplicates([
    bankFile("은행/01.hwp", 100),
    bankFile("은행/01.hwpx", 200),
    bankFile("은행/02.hwp", 300),
  ]);
  assert.deepEqual(selected.map((file) => file.name).sort(), ["01.hwpx", "02.hwp"]);
});

test("문항이 있는 미주 복사 분석만 처리 방식을 확정한다", () => {
  assert.equal(detectBankRule({ questions: [] }), null);
  assert.equal(detectBankRule({ questions: [{ copyMode: "root-endnote-block" }] }), DEFAULT_BANK_RULE_ID);
  assert.equal(detectBankRule({ questions: [{ copyMode: "root-endnote-block", preprocessMode: "ebsi-endnote-v1" }] }), EBSI_KOREAN_RULE_ID);
  assert.equal(serializeBankAnalysis({ filename: "empty.hwpx", questions: [] }), null);
});

test("EBSi 국어 지문·정답·해설 범위를 캐시에 저장한다", () => {
  const serialized = serializeBankAnalysis({
    filename: "korean.hwpx",
    questions: [{
      ordinal: 1,
      copyMode: "root-endnote-block",
      preprocessMode: "ebsi-endnote-v1",
      passageGroupId: "Contents/section0.xml:9",
      passageStart: 10,
      passageEnd: 13,
      copyStart: 31,
      copyEnd: 39,
      answerStart: 39,
      answerEnd: 42,
      explanationStart: 42,
      explanationEnd: 50,
    }],
  });
  assert.equal(serialized.questions[0].passageStart, 10);
  assert.equal(serialized.questions[0].explanationEnd, 50);
  assert.equal(serialized.questions[0].copyMode, "root-endnote-block");
  assert.equal(serialized.questions[0].preprocessMode, "ebsi-endnote-v1");
});

test("파일 캐시 키는 문제은행과 파일 변경 정보를 포함한다", () => {
  const identity = { relativePath: "은행/01.hwp", size: 10, lastModified: 20 };
  assert.notEqual(fileAnalysisCacheKey("a", identity), fileAnalysisCacheKey("b", identity));
  assert.notEqual(fileAnalysisCacheKey("a", identity), fileAnalysisCacheKey("a", { ...identity, size: 11 }));
});
