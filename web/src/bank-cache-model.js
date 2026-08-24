import { normalizeKorean, projectFileIdentity } from "./bank-model.js";

export const BANK_CACHE_SCHEMA_VERSION = 2;
export const BANK_ANALYSIS_VERSION = 1;
export const AUTO_BANK_RULE_ID = "auto";
export const DEFAULT_BANK_RULE_ID = "macro-endnote-v1";

export const BANK_RULES = Object.freeze([
  Object.freeze({
    id: AUTO_BANK_RULE_ID,
    label: "자동",
    description: "파일 구조를 확인해 사용할 처리 방식을 선택합니다.",
  }),
  Object.freeze({
    id: DEFAULT_BANK_RULE_ID,
    label: "미주 기준",
    description: "문제와 [정답]·[해설] 미주를 한 블록으로 복사합니다.",
  }),
]);

const QUESTION_CACHE_FIELDS = Object.freeze([
  "ordinal",
  "sourceLabel",
  "sourceType",
  "sourceNumber",
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
  "copyStart",
  "copyEnd",
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
  const rootFolderName = roots.size === 1 ? [...roots][0] : "문제은행";
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
  if (normalizeKorean(profile.rootFolderName) !== normalizeKorean(descriptor.rootFolderName)) return 0;
  const previous = profile.manifest || [];
  const current = descriptor.manifest || [];
  if (sameFolderManifest(previous, current)) return 1;
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

function initialFileSettings(manifest, existing = {}, legacyRuleId = null) {
  const result = structuredClone(existing || {});
  manifest.forEach((identity) => {
    const key = profileFileSettingKey(identity);
    const saved = result[key] || {};
    const selectedRuleId = saved.selectedRuleId || legacyRuleId || AUTO_BANK_RULE_ID;
    result[key] = {
      ...saved,
      selectedRuleId,
      resolvedRuleId: saved.resolvedRuleId || (selectedRuleId === AUTO_BANK_RULE_ID ? null : selectedRuleId),
    };
  });
  return result;
}

export function createBankProfile({ displayName, descriptor, bankId } = {}) {
  if (!descriptor) throw new Error("문제은행 폴더 정보가 없습니다.");
  const now = new Date().toISOString();
  return {
    schemaVersion: BANK_CACHE_SCHEMA_VERSION,
    bankId: bankId || globalThis.crypto?.randomUUID?.() || `bank-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    displayName: normalizeKorean(displayName) || descriptor.rootFolderName,
    rootFolderName: descriptor.rootFolderName,
    manifest: descriptor.manifest,
    fileSettings: initialFileSettings(descriptor.manifest),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}

export function updateBankProfileForFolder(profile, descriptor) {
  const now = new Date().toISOString();
  const { ruleId: legacyRuleId = null, ...profileWithoutFolderRule } = profile;
  return {
    ...profileWithoutFolderRule,
    schemaVersion: BANK_CACHE_SCHEMA_VERSION,
    rootFolderName: descriptor.rootFolderName,
    manifest: descriptor.manifest,
    fileSettings: initialFileSettings(descriptor.manifest, profile.fileSettings, legacyRuleId),
    updatedAt: now,
    lastOpenedAt: now,
  };
}

export function fileAnalysisCacheKey(bankId, identity, ruleId = DEFAULT_BANK_RULE_ID) {
  return [
    bankId,
    ruleId,
    BANK_ANALYSIS_VERSION,
    identity.relativePath,
    identity.size,
    identity.lastModified,
  ].join("\u0001");
}

export function serializeBankAnalysis(analysis) {
  if (!analysis?.questions?.length || !analysis.questions.every((question) => question.copyMode === "root-endnote-block")) return null;
  return {
    filename: analysis.filename,
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
  if (analysis?.questions?.length && analysis.questions.every((question) => question.copyMode === "root-endnote-block")) {
    return DEFAULT_BANK_RULE_ID;
  }
  return null;
}
