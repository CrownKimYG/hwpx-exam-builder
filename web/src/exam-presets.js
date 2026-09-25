import { compileMixedRules } from "./mixed-generator.js";
import { compileGroupedRules } from "./grouped-generator.js";
import { compileBankMatrixRules, compileBankQuotaRules } from "./quick-generator.js";

export function presetRules(preset) {
  if (preset.mode === "grouped") return compileGroupedRules(preset.grouped, preset.questionCount);
  if (preset.mode === "mixed") return compileMixedRules(preset.banks.map(b=>({...b,range:preset.mixed?.bankRanges?.[b.bankId]})),preset.mixed?.rows);
  return preset.mode === "matrix" ? compileBankMatrixRules(preset.banks) : compileBankQuotaRules(preset.banks);
}

export function createExamPreset({ id, name, profiles, quick, mode }) {
  if (!name.trim()) throw new Error("템플릿 이름을 입력해 주세요.");
  const banks = profiles.map((p) => ({
    bankId: p.bankId, name: p.displayName, ruleId: p.ruleId,
    count: Number(quick.bankCounts[p.bankId] || 0),
    cells: Object.entries(quick.cells).flatMap(([key, value]) => {
      const [bankId, unitKey, difficulty] = JSON.parse(key);
      return bankId === p.bankId && String(value).trim() ? [{ unitKey, difficulty, value }] : [];
    }),
  }));
  const preset = { version: 1, id, name: name.trim(), banks, mode,
    grouped: structuredClone(quick.grouped || null), questionCount: Number(quick.questionCount),
    mixed: structuredClone(quick.mixed || null),
    examName: quick.examName, examCount: Number(quick.examCount), updatedAt: new Date().toISOString() };
  if (!Number.isInteger(preset.examCount) || preset.examCount < 1) throw new Error("시험지 수는 1 이상의 정수로 입력해 주세요.");
  presetRules(preset);
  return preset;
}

export function applyExamPreset(preset, profiles, unitsByBank, currentQuick) {
  if (preset.version !== 1 || !["banks", "matrix", "mixed", "grouped"].includes(preset.mode)) throw new Error("지원하지 않는 출제 템플릿입니다.");
  presetRules(preset);
  for (const bank of preset.banks) {
    const profile = profiles.find((p) => p.bankId === bank.bankId);
    if (!profile) throw new Error(`${bank.name}: 저장된 문제은행이 없습니다.`);
    if (profile.ruleId !== bank.ruleId) throw new Error(`${bank.name}: 처리 방식이 변경되어 조건을 적용할 수 없습니다.`);
    for (const cell of bank.cells) {
      if (preset.mode === "matrix" && bank.count > 0 && cell.unitKey && !unitsByBank[bank.bankId]?.includes(cell.unitKey)) {
        throw new Error(`${bank.name}: 저장된 조건의 단원을 찾지 못했습니다. 은행 구성을 확인해 주세요.`);
      }
    }
  }
  if (preset.mode === "mixed") for (const row of preset.mixed.rows) {
    if (row.unitKey && !unitsByBank[row.bankId]?.includes(row.unitKey)) throw new Error("혼합 배치 조건의 단원을 찾지 못했습니다.");
  }
  if (preset.mode === "grouped") {
    const units = new Set(Object.values(unitsByBank).flat());
    for (const s of preset.grouped.subjects) {
      if (s.groups.some(g => g.units.some(u => !units.has(u)))) throw new Error(`${s.name}: 저장된 묶음의 단원을 찾지 못했습니다.`);
      if (s.bankWeights && Object.keys(s.bankWeights).some(id => !profiles.some(p => p.bankId === id))) throw new Error(`${s.name}: 교재 비율의 문제은행을 찾지 못했습니다.`);
    }
  }
  const bankCounts = Object.fromEntries(profiles.map((p) => [p.bankId, 0]));
  const cells = {};
  for (const bank of preset.banks) {
    bankCounts[bank.bankId] = bank.count;
    for (const cell of bank.cells) cells[JSON.stringify([bank.bankId, cell.unitKey || null, cell.difficulty || null])] = cell.value;
  }
  return { ...currentQuick, wizardStep: 0, wizardResultIds: null, grouped: structuredClone(preset.grouped || null), mixed: structuredClone(preset.mixed || null), bankCounts, cells, examName: preset.examName, examCount: preset.examCount,
    questionCount: preset.mode === 'grouped' ? preset.questionCount : preset.banks.reduce((sum, bank) => sum + bank.count, 0) };
}

export const EXAM_PRESETS_KEY = "exam-builder-condition-presets-v1";
export function readExamPresets(storage) {
  const presets = JSON.parse(storage.getItem(EXAM_PRESETS_KEY) || "[]");
  if (!Array.isArray(presets)) throw new Error("저장된 출제 템플릿을 읽지 못했습니다.");
  return presets;
}
export function writeExamPresets(storage, presets) {
  storage.setItem(EXAM_PRESETS_KEY, JSON.stringify(presets));
}
