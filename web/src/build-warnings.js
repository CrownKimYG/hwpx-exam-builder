import { EBSI_KOREAN_RULE_ID } from "./bank-cache-model.js";

function nonempty(value) {
  return String(value || "").trim();
}

function warningLabels(question) {
  const labels = new Set((question?.warnings || []).map(nonempty).filter(Boolean));
  if (!nonempty(question?.answerText)) labels.add("정답 내용 누락");
  if (!nonempty(question?.explanationText)) labels.add("해설 내용 누락");
  return [...labels];
}

export function collectSelectedBuildWarnings(exams, questionByCode, ruleId) {
  if (ruleId !== EBSI_KOREAN_RULE_ID) return [];
  const records = [];
  exams.forEach((exam, examIndex) => {
    const seen = new Set();
    (exam.codes || []).forEach((code) => {
      if (seen.has(code)) return;
      seen.add(code);
      const question = questionByCode.get(code);
      const warnings = warningLabels(question);
      if (!warnings.length) return;
      records.push({
        examTitle: nonempty(exam.title) || `시험지 ${String(examIndex + 1).padStart(2, "0")}`,
        code,
        warnings,
      });
    });
  });
  return records;
}
