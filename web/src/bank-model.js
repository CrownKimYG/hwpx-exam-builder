export const DIFFICULTIES = Object.freeze(["유제", "lv1", "lv2", "lv3"]);

export function normalizeKorean(value) {
  return String(value || "").normalize("NFC").trim();
}

export function difficultyFromLabel(label) {
  const normalized = normalizeKorean(label).replace(/\s+/g, "");
  if (/예제|유제/.test(normalized)) return "유제";
  if (/기초(?:연습)?/.test(normalized)) return "lv1";
  if (/기본(?:연습)?/.test(normalized)) return "lv2";
  if (/실력(?:완성)?/.test(normalized)) return "lv3";
  return "미분류";
}

export function parseBankFilename(filename) {
  const normalized = normalizeKorean(filename);
  const stem = normalized.replace(/\.(?:hwp|hwpx)$/i, "");
  // The unit name may itself contain parenthesized parts such as
  // "도함수의 활용(1)". Treat only the final numeric parentheses
  // immediately before the subject separator as the volume number.
  const match = stem.match(/(\d{1,3})\.\s*([^\[_]+?)\s*\((\d+)\)\s*[_-]\s*([^\[\]]+?)(?:\s*\[(\d+)\s*문제\])?$/);
  if (!match) {
    return {
      subject: "과목 미분류",
      unitNumber: "",
      unitName: stem,
      volume: "",
      declaredQuestionCount: null,
      parsed: false,
    };
  }
  return {
    subject: normalizeKorean(match[4]),
    unitNumber: match[1].padStart(2, "0"),
    unitName: normalizeKorean(match[2]),
    volume: match[3].padStart(2, "0"),
    declaredQuestionCount: match[5] ? Number(match[5]) : null,
    parsed: true,
  };
}

export function unitKey(metadata) {
  return [metadata.subject, metadata.unitNumber, metadata.unitName].map(normalizeKorean).join("::");
}

export function fileCode(index) {
  return String(index + 1).padStart(2, "0");
}

export function questionCode(code, ordinal) {
  return `${code}-${String(ordinal).padStart(3, "0")}`;
}

export function normalizeQuestionCode(value) {
  const normalized = normalizeKorean(value);
  return /^\d{2}-\d{3}$/.test(normalized) ? normalized : null;
}

export function parseQuestionCodes(value) {
  const tokens = normalizeKorean(value).split(/[\s,]+/).filter(Boolean);
  const invalid = tokens.filter((token) => !normalizeQuestionCode(token));
  if (invalid.length) {
    throw new Error(`문항 코드는 01-003 형식으로 입력해야 합니다: ${invalid.join(", ")}`);
  }
  const codes = tokens.map(normalizeQuestionCode);
  const duplicate = codes.find((code, index) => codes.indexOf(code) !== index);
  if (duplicate) throw new Error(`${duplicate} 문항이 한 시험지에 중복되었습니다.`);
  return codes;
}

export function projectFileIdentity(file) {
  return {
    name: normalizeKorean(file.name),
    relativePath: normalizeKorean(file.webkitRelativePath || file._relativePath || file.name),
    size: file.size,
    lastModified: file.lastModified,
  };
}

export function sameFileIdentity(left, right) {
  return left.relativePath === right.relativePath
    && left.size === right.size
    && left.lastModified === right.lastModified;
}

export function sortBankFiles(files) {
  return [...files].sort((left, right) => normalizeKorean(left.name).localeCompare(
    normalizeKorean(right.name),
    "ko",
    { numeric: true, sensitivity: "base" },
  ));
}

export function createProjectSnapshot(state) {
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    files: state.files.map((record) => ({
      code: record.code,
      identity: record.identity,
      metadata: record.metadata,
      questionOverrides: record.questionOverrides || {},
      selectedRuleId: record.selectedRuleId || "auto",
      resolvedRuleId: record.resolvedRuleId || null,
    })),
    quick: state.quick,
    exams: state.exams,
    settings: state.settings,
  };
}

export function validateProjectSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.files)) {
    throw new Error("지원하지 않는 프로젝트 설정 파일입니다.");
  }
  return snapshot;
}
