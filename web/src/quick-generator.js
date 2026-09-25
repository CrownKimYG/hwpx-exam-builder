import { allocateMixedExamSets } from "./mixed-generator.js";
import { createUnitBalance } from "./unit-balance.js";
import { allocateGroupedExamSets } from "./grouped-generator.js";
function hashSeed(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function parseSlotReferences(value, questionCount) {
  const source = String(value || "").trim();
  if (!source) return [];
  const tokens = source.split(/[\s,]+/).filter(Boolean);
  if (tokens.some((token) => /^all$/i.test(token))) {
    if (tokens.length !== 1) throw new Error("All은 다른 문항 번호와 함께 입력할 수 없습니다.");
    return Array.from({ length: questionCount }, (_, index) => index + 1);
  }
  const slots = [];
  for (const token of tokens) {
    const single = token.match(/^#?(\d+)$/);
    if (single) {
      slots.push(Number(single[1]));
      continue;
    }
    const range = token.match(/^#?(\d+)~{1,2}#?(\d+)$/);
    if (!range) {
      throw new Error(`${token}은 올바른 문항 위치가 아닙니다. #1, #1~~4 또는 All 형식으로 입력하세요.`);
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start > end) throw new Error(`${token}은 시작 번호가 끝 번호보다 큽니다.`);
    for (let slot = start; slot <= end; slot += 1) slots.push(slot);
  }
  const invalid = slots.find((slot) => slot < 1 || slot > questionCount);
  if (invalid != null) throw new Error(`#${invalid}은 시험지 문항 수 범위를 벗어났습니다.`);
  const duplicate = slots.find((slot, index) => slots.indexOf(slot) !== index);
  if (duplicate != null) throw new Error(`같은 칸에 #${duplicate}이 중복되었습니다.`);
  return slots;
}

export function compileSlotRules(cells, questionCount) {
  const rules = new Map(Array.from({ length: questionCount }, (_, index) => [index + 1, []]));
  cells.forEach(({ unitKey = null, unitKeys = null, difficulty = null, value = "" }) => {
    parseSlotReferences(value, questionCount).forEach((slot) => {
      rules.get(slot).push({ unitKey: unitKey || null, ...(unitKeys ? { unitKeys } : {}), difficulty: difficulty || null });
    });
  });
  const missing = [...rules.entries()].filter(([, predicates]) => predicates.length === 0).map(([slot]) => `#${slot}`);
  if (missing.length) throw new Error(`조건이 없는 문항 위치가 있습니다: ${missing.join(", ")}`);
  return rules;
}

export function questionMatches(question, predicates) {
  return predicates.some((predicate) => (
    (!predicate.bankId || predicate.bankId === question.bankId)
    &&
    (!predicate.unitKey || predicate.unitKey === question.unitKey)
    && (!predicate.unitKeys || predicate.unitKeys.includes(question.unitKey))
    && (!predicate.difficulty || predicate.difficulty === question.difficulty)
  ));
}

export function compileBankQuotaRules(quotas) {
  const rules = new Map();
  const seen = new Set();
  for (const { bankId, count, name = bankId } of quotas) {
    if (!bankId || seen.has(bankId)) throw new Error("문제은행이 중복되었거나 식별자가 없습니다.");
    seen.add(bankId);
    if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error(`${name} 문항 수를 0~100 사이의 정수로 입력하세요.`);
    for (let i = 0; i < count; i += 1) rules.set(rules.size + 1, [{ bankId }]);
  }
  if (!rules.size || rules.size > 100) throw new Error("문제은행별 문항 수의 합계를 1~100 사이로 설정하세요.");
  return rules;
}

export function compileBankMatrixRules(banks) {
  // Validate counts and identities before composing each bank's local slots.
  compileBankQuotaRules(banks);
  const combined = new Map();
  for (const { bankId, count, name = bankId, cells = [], groups = [] } of banks) {
    if (count === 0) continue;
    let local;
    try {
      local = compileSlotRules(cells.map(cell => {
        if (!cell.unitKey?.startsWith('group:')) return cell;
        const group = groups.find(g => `group:${g.id}` === cell.unitKey);
        if (!group?.units?.length) throw new Error('번호를 지정한 묶음을 찾지 못했습니다.');
        return { ...cell, unitKey: null, unitKeys: group.units };
      }), count);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
    for (const predicates of local.values()) {
      combined.set(combined.size + 1, predicates.map((predicate) => ({ ...predicate, bankId })));
    }
  }
  return combined;
}

function candidateMap(questions, rules, examCount, usedCodes, random) {
  const available = questions.filter((question) => !usedCodes.has(question.code));
  const demands = [];
  for (let examIndex = 0; examIndex < examCount; examIndex += 1) {
    for (const [slot, predicates] of rules) {
      demands.push({
        id: `${examIndex}:${slot}`,
        examIndex,
        slot,
        candidates: shuffled(
          available.filter((question) => questionMatches(question, predicates)).map((question) => question.code),
          random,
        ),
      });
    }
  }
  return shuffled(demands, random).sort((left, right) =>
    left.examIndex - right.examIndex || left.candidates.length - right.candidates.length);
}

function matchDemands(demands, questions, examCount, random) {
  const questionToDemand = new Map();
  const demandToQuestion = new Map();
  const byId = new Map(demands.map((demand) => [demand.id, demand]));
  const byCode = new Map(questions.map(question => [question.code, question]));
  const balance = createUnitBalance(examCount, random);

  function assign(demand, visited) {
    const candidates = demand.candidates.filter(code => !visited.has(code));
    // Use unused questions first; only displace an earlier assignment when
    // necessary to keep all explicit slot conditions feasible.
    const ordered = [false, true].flatMap(occupied => balance.order(
      demand.examIndex,
      candidates.filter(code => questionToDemand.has(code) === occupied),
      code => byCode.get(code),
    ));
    for (const code of ordered) {
      if (visited.has(code)) continue;
      visited.add(code);
      const occupiedBy = questionToDemand.get(code);
      if (!occupiedBy || assign(byId.get(occupiedBy), visited)) {
        const previous = demandToQuestion.get(demand.id);
        if (previous) balance.add(demand.examIndex, byCode.get(previous), -1);
        balance.add(demand.examIndex, byCode.get(code), 1);
        questionToDemand.set(code, demand.id);
        demandToQuestion.set(demand.id, code);
        return true;
      }
    }
    return false;
  }

  for (const demand of demands) {
    if (!assign(demand, new Set())) return null;
  }
  return demandToQuestion;
}

export function allocateExamSets({ questions, rules, examCount, usedCodes = new Set(), seed = "hwpx" }) {
  if (rules.kind === "grouped") return allocateGroupedExamSets({ questions, rules, examCount, usedCodes, seed });
  if (rules.kind === "mixed") return allocateMixedExamSets({ questions, rules, examCount, usedCodes, seed });
  if (!Number.isInteger(examCount) || examCount < 1) throw new Error("생성할 시험지 수를 1 이상 입력하세요.");
  const random = seededRandom(seed);
  const demands = candidateMap(questions, rules, examCount, usedCodes, random);
  const empty = demands.find((demand) => demand.candidates.length === 0);
  if (empty) throw new Error(`시험지 ${empty.examIndex + 1}의 #${empty.slot} 조건에 맞는 문항이 없습니다.`);
  const matched = matchDemands(demands, questions, examCount, random);
  if (!matched) throw new Error(`${examCount}부를 중복 없이 구성할 수 없습니다.`);
  return Array.from({ length: examCount }, (_, examIndex) => [...rules.keys()]
    .sort((left, right) => left - right)
    .map((slot) => matched.get(`${examIndex}:${slot}`)));
}

export function estimateMaximumExamSets({ questions, rules, usedCodes = new Set(), seed = "estimate", cap = 999 }) {
  const availableCount = questions.filter((question) => !usedCodes.has(question.code)).length;
  const upperBound = Math.min(cap, Math.floor(availableCount / Math.max(1, rules.size)));
  let low = 0;
  let high = upperBound;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    try {
      allocateExamSets({ questions, rules, examCount: middle, usedCodes, seed });
      low = middle;
    } catch {
      high = middle - 1;
    }
  }
  return low;
}
