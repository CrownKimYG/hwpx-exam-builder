const KEY = "exam-builder-used-questions-v1";
export function questionHistoryKey(question) {
  return JSON.stringify([question.bankId, String(question.sourcePath).normalize("NFC"), question.ordinal]);
}
export function readExamHistory(storage) {
  const history = JSON.parse(storage.getItem(KEY) || "[]");
  if (!Array.isArray(history)) throw new Error("출제 이력을 읽지 못했습니다.");
  return history;
}
export function historyUsedCodes(history, questions, owner = null) {
  const keys = new Set(history.filter((h) => !owner || h.id !== owner).flatMap((h) => h.keys));
  return new Set(questions.filter((q) => keys.has(questionHistoryKey(q))).map((q) => q.code));
}
export function reserveExamHistory(storage, exams, questions, preventReuse = true) {
  const history = readExamHistory(storage);
  const byCode = new Map(questions.map((q) => [q.code, q]));
  for (const exam of exams) {
    const used = historyUsedCodes(history, questions, exam.historyId);
    if (preventReuse && exam.codes.some((code) => used.has(code))) throw new Error("이전에 출제한 문항이 포함되어 있습니다. 조건을 다시 적용해 출제해 주세요.");
    const keys = exam.codes.map((code) => {
      const question = byCode.get(code);
      if (!question) throw new Error(`없는 문항 코드: ${code}`);
      return questionHistoryKey(question);
    });
    const existing = history.find((h) => h.id === exam.historyId);
    if (existing) { existing.keys = [...new Set([...existing.keys, ...keys])]; existing.title = exam.title; }
    else history.push({ id: exam.historyId, title: exam.title, createdAt: new Date().toISOString(), keys: [...new Set(keys)] });
  }
  storage.setItem(KEY, JSON.stringify(history));
  return history;
}
export function clearExamHistory(storage) { storage.removeItem(KEY); }
