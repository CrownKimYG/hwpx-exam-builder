import {
  isEbsiKoreanBankFilename,
  isSuteukShortEssayBankFilename,
  normalizeKorean,
  projectFileIdentity,
} from "./bank-model.js";

export const BANK_CACHE_SCHEMA_VERSION = 3;
export const BANK_ANALYSIS_VERSION = 2;
export const AUTO_BANK_RULE_ID = "auto";
export const DEFAULT_BANK_RULE_ID = "macro-endnote-v1";
export const EBSI_KOREAN_RULE_ID = "ebsi-korean-v1";
export const SUTEUK_SHORT_ESSAY_RULE_ID = "suteuk-short-essay-v1";
export const SUTEUK_SHORT_ESSAY_ANALYSIS_VERSION = 1;

export const BANK_RULES = Object.freeze([
  Object.freeze({
    id: AUTO_BANK_RULE_ID,
    label: "자동",
    description: "파일 구조를 확인해 사용할 처리 방식을 선택합니다.",
  }),
  Object.freeze({
    id: DEFAULT_BANK_RULE_ID,
    label: "[수학]수특변형Z",
    description: "문제와 [정답]·[해설] 미주를 한 블록으로 복사합니다.",
  }),
  Object.freeze({
    id: SUTEUK_SHORT_ESSAY_RULE_ID,
    label: "[수학] 수능특강",
    description: "약술법·연습문제·기본·실력·심화를 구분하고 문제와 원본 미주를 복사합니다.",
  }),
  Object.freeze({
    id: EBSI_KOREAN_RULE_ID,
    label: "[국어]EBS연계",
    description: "파일명으로 판별하고 정답·해설을 미주로 변환한 뒤 미주 기준으로 복사합니다.",
  }),
]);

export const CONCRETE_BANK_RULES = Object.freeze(
  BANK_RULES.filter((rule) => rule.id !== AUTO_BANK_RULE_ID),
);

export function bankSubjectForRule(ruleId) {
  if (ruleId === EBSI_KOREAN_RULE_ID) return "국어";
  if ([DEFAULT_BANK_RULE_ID, SUTEUK_SHORT_ESSAY_RULE_ID].includes(ruleId)) return "수학";
  return "";
}

export function detectBankRuleFromFilenames(files) {
  const detected = new Set([...files].map((file) => (
    isEbsiKoreanBankFilename(file.name) ? EBSI_KOREAN_RULE_ID
      : isSuteukShortEssayBankFilename(file.name) ? SUTEUK_SHORT_ESSAY_RULE_ID : DEFAULT_BANK_RULE_ID
  )));
  if (detected.size > 1) {
    throw new Error("처리 방식이 다른 파일은 한 문제은행에 함께 넣을 수 없습니다.");
  }
  return [...detected][0] || DEFAULT_BANK_RULE_ID;
}

function sourceStem(file) {
  const path = normalizeKorean(file.webkitRelativePath || file._relativePath || file.name);
  return path.replace(/\.(?:hwp|hwpx)$/i, "").toLocaleLowerCase("ko");
}

export function preferHwpxDuplicates(files) {
  const selected = new Map();
  [...files].forEach((file) => {
    const key = sourceStem(file);
    const current = selected.get(key);
    if (!current || (/\.hwpx$/i.test(file.name) && !/\.hwpx$/i.test(current.name))) {
      selected.set(key, file);
    }
  });
  return [...selected.values()];
}

const QUESTION_CACHE_FIELDS = Object.freeze([
  "ordinal",
  "sourceLabel",
  "sourceType",
  "sourceNumber",
  "subtopic",
  "subtopicSource",
  "sourceCodes",
  "difficultyLabel",
  "difficulty",
  "sectionName",
  "anchorIndex",
  "titleStart",
  "blockStart",
  "blockEnd",
  "contentStart",
  "contentEnd",
  "copyMode",
  "preprocessMode",
  "copyStart",
  "copyEnd",
  "passageGroupId",
  "lectureNumber",
  "passageRangeLabel",
  "passageStart",
  "passageEnd",
  "passageExplanationStart",
  "passageExplanationEnd",
  "answerStart",
  "answerEnd",
  "explanationStart",
  "explanationEnd",
  "sourceCode",
  "hasEndnote",
  "answerType",
  "answer",
  "choiceCount",
  "choiceElementIndexes",
  "warnings",
  "questionText",
  "answerText",
  "explanationText",
  "equations",
  "bodyXml",
  "answerXml",
  "explanationXml",
  "fullXml",
]);

function relativePathOf(file) {
  return normalizeKorean(file.webkitRelativePath || file._relativePath || file.name).replace(/^\/+/, "");
}

function manifestIdentityKey(identity) {
  return [identity.relativePath, identity.size, identity.lastModified].join("\u0001");
}

function pathKey(identity) {
  return normalizeKorean(identity.relativePath);
}

export function describeBankFolder(files) {
  const selected = [...files];
  if (!selected.length) return null;
  const identities = selected.map(projectFileIdentity).sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath, "ko", { numeric: true, sensitivity: "base" })
  ));
  const roots = new Set(selected.map((file) => {
    const parts = relativePathOf(file).split("/").filter(Boolean);
    return parts.length > 1 ? parts[0] : "";
  }).filter(Boolean));
  const rootFolderName = roots.size === 1
    ? [...roots][0]
    : selected.length === 1
      ? normalizeKorean(selected[0].name).replace(/\.(?:hwp|hwpx)$/i, "")
      : "문제은행";
  return {
    rootFolderName,
    manifest: identities,
    fileCount: identities.length,
  };
}

export function sameFolderManifest(left = [], right = []) {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(manifestIdentityKey));
  return left.every((identity) => rightKeys.has(manifestIdentityKey(identity)));
}

export function folderMatchScore(profile, descriptor) {
  if (!profile || !descriptor) return 0;
  const previous = profile.manifest || [];
  const current = descriptor.manifest || [];
  if (sameFolderManifest(previous, current)) return 1;
  if (normalizeKorean(profile.rootFolderName) !== normalizeKorean(descriptor.rootFolderName)) return 0;
  const denominator = Math.max(previous.length, current.length, 1);
  const previousPaths = new Set(previous.map(pathKey));
  const previousIdentities = new Set(previous.map(manifestIdentityKey));
  const pathOverlap = current.filter((identity) => previousPaths.has(pathKey(identity))).length / denominator;
  const identityOverlap = current.filter((identity) => previousIdentities.has(manifestIdentityKey(identity))).length / denominator;
  return Number((pathOverlap * 0.7 + identityOverlap * 0.3).toFixed(4));
}

export function findMatchingBankProfile(profiles, descriptor) {
  const matches = profiles
    .map((profile) => ({ profile, score: folderMatchScore(profile, descriptor) }))
    .filter((match) => match.score >= 0.6)
    .sort((left, right) => right.score - left.score);
  if (!matches.length) return null;
  if (matches.length > 1 && matches[0].score - matches[1].score < 0.15) return null;
  return {
    ...matches[0],
    confidence: matches[0].score === 1 ? "exact" : "likely",
  };
}

function initialFileSettings(manifest, existing = {}, bankRuleId = DEFAULT_BANK_RULE_ID) {
  const result = structuredClone(existing || {});
  manifest.forEach((identity) => {
    const key = profileFileSettingKey(identity);
    const saved = result[key] || {};
    result[key] = {
      ...saved,
      selectedRuleId: bankRuleId,
      resolvedRuleId: bankRuleId,
    };
  });
  return result;
}

export function createBankProfile({ displayName, descriptor, bankId, ruleId = DEFAULT_BANK_RULE_ID } = {}) {
  if (!descriptor) throw new Error("문제은행 폴더 정보가 없습니다.");
  if (!CONCRETE_BANK_RULES.some((rule) => rule.id === ruleId)) throw new Error("문제은행 처리 방식이 올바르지 않습니다.");
  const now = new Date().toISOString();
  return {
    schemaVersion: BANK_CACHE_SCHEMA_VERSION,
    bankId: bankId || globalThis.crypto?.randomUUID?.() || `bank-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    displayName: normalizeKorean(displayName) || descriptor.rootFolderName,
    ruleId,
    subject: bankSubjectForRule(ruleId),
    rootFolderName: descriptor.rootFolderName,
    manifest: descriptor.manifest,
    fileSettings: initialFileSettings(descriptor.manifest, {}, ruleId),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}

export function updateBankProfileForFolder(profile, descriptor) {
  const now = new Date().toISOString();
  const migrated = migrateBankProfile(profile);
  return {
    ...migrated,
    schemaVersion: BANK_CACHE_SCHEMA_VERSION,
    rootFolderName: descriptor.rootFolderName,
    manifest: descriptor.manifest,
    fileSettings: initialFileSettings(descriptor.manifest, migrated.fileSettings, migrated.ruleId),
    updatedAt: now,
    lastOpenedAt: now,
  };
}

export function inferProfileRuleId(profile) {
  if (CONCRETE_BANK_RULES.some((rule) => rule.id === profile?.ruleId)) return profile.ruleId;
  const savedRules = Object.values(profile?.fileSettings || {})
    .map((setting) => setting.resolvedRuleId || setting.selectedRuleId)
    .filter((ruleId) => CONCRETE_BANK_RULES.some((rule) => rule.id === ruleId));
  if (savedRules.includes(EBSI_KOREAN_RULE_ID)) return EBSI_KOREAN_RULE_ID;
  if (savedRules.includes(SUTEUK_SHORT_ESSAY_RULE_ID)) return SUTEUK_SHORT_ESSAY_RULE_ID;
  return DEFAULT_BANK_RULE_ID;
}

export function migrateBankProfile(profile) {
  if (!profile) return profile;
  const ruleId = inferProfileRuleId(profile);
  return {
    ...structuredClone(profile),
    schemaVersion: BANK_CACHE_SCHEMA_VERSION,
    ruleId,
    subject: bankSubjectForRule(ruleId),
    fileSettings: initialFileSettings(profile.manifest || [], profile.fileSettings, ruleId),
  };
}

export function fileAnalysisCacheKey(bankId, identity, ruleId = DEFAULT_BANK_RULE_ID) {
  return [
    bankId,
    ruleId,
    ruleId === SUTEUK_SHORT_ESSAY_RULE_ID ? SUTEUK_SHORT_ESSAY_ANALYSIS_VERSION : BANK_ANALYSIS_VERSION,
    identity.relativePath,
    identity.size,
    identity.lastModified,
  ].join("\u0001");
}

export function serializeBankAnalysis(analysis) {
  const supportedModes = new Set(["root-endnote-block", "ebsi-korean-passage"]);
  if (!analysis?.questions?.length || !analysis.questions.every((question) => supportedModes.has(question.copyMode))) return null;
  return {
    filename: analysis.filename,
    ruleId: analysis.ruleId || null,
    preprocessMode: analysis.preprocessMode || null,
    warnings: structuredClone(analysis.warnings || []),
    questions: analysis.questions.map((question) => Object.fromEntries(
      QUESTION_CACHE_FIELDS
        .filter((field) => Object.hasOwn(question, field))
        .map((field) => [field, structuredClone(question[field])]),
    )),
  };
}

export function hydrateBankAnalysis(cached) {
  if (!cached?.questions) return null;
  return {
    filename: cached.filename,
    ruleId: cached.ruleId || null,
    preprocessMode: cached.preprocessMode || null,
    warnings: structuredClone(cached.warnings || []),
    questions: cached.questions.map((question) => ({
      ...structuredClone(question),
      questionElements: [],
      choices: [],
      answerElement: null,
      explanationElements: [],
    })),
  };
}

export function profileFileSettingKey(identity) {
  return normalizeKorean(identity?.relativePath);
}

export function detectBankRule(analysis) {
  if (analysis?.questions?.length && analysis.questions.every((question) => question.preprocessMode === SUTEUK_SHORT_ESSAY_RULE_ID)) {
    return SUTEUK_SHORT_ESSAY_RULE_ID;
  }
  if (analysis?.questions?.length && analysis.questions.every((question) => question.preprocessMode === "ebsi-endnote-v1")) {
    return EBSI_KOREAN_RULE_ID;
  }
  if (analysis?.questions?.length && analysis.questions.every((question) => question.copyMode === "root-endnote-block" && !question.preprocessMode)) {
    return DEFAULT_BANK_RULE_ID;
  }
  if (analysis?.questions?.length && analysis.questions.every((question) => question.copyMode === "ebsi-korean-passage")) {
    return EBSI_KOREAN_RULE_ID;
  }
  return null;
}

export function bankRuleRequiresPreprocessing(ruleId) {
  return [EBSI_KOREAN_RULE_ID, SUTEUK_SHORT_ESSAY_RULE_ID].includes(ruleId);
}
