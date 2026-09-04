export function numberedExamTitle(baseName, sequence) {
  const normalized = String(baseName || "").trim() || "시험지";
  return `${normalized} ${String(sequence).padStart(2, "0")}`;
}
