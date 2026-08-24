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
  const malformed = tokens.find((token) => !/^#?\d+$/.test(token));
  if (malformed) throw new Error(`${malformed}은 올바른 문항 위치가 아닙니다. #1 또는 1 형식으로 입력하세요.`);
  const slots = tokens.map((token) => Number(token.replace("#", "")));
  const invalid = slots.find((slot) => slot < 1 || slot > questionCount);
  if (invalid != null) throw new Error(`#${invalid}은 시험지 문항 수 범위를 벗어났습니다.`);
  const duplicate = slots.find((slot, index) => slots.indexOf(slot) !== index);
  if (duplicate != null) throw new Error(`같은 칸에 #${duplicate}이 중복되었습니다.`);
  return slots;
}

export function compileSlotRules(cells, questionCount) {
  const rules = new Map(Array.from({ length: questionCount }, (_, index) => [index + 1, []]));
  cells.forEach(({ unitKey = null, difficulty = null, value = "" }) => {
    parseSlotReferences(value, questionCount).forEach((slot) => {
      rules.get(slot).push({ unitKey: unitKey || null, difficulty: difficulty || null });
    });
  });
  const missing = [...rules.entries()].filter(([, predicates]) => predicates.length === 0).map(([slot]) => `#${slot}`);
  if (missing.length) throw new Error(`조건이 없는 문항 위치가 있습니다: ${missing.join(", ")}`);
  return rules;
}

export function questionMatches(question, predicates) {
  return predicates.some((predicate) => (
    (!predicate.unitKey || predicate.unitKey === question.unitKey)
    && (!predicate.difficulty || predicate.difficulty === question.difficulty)
  ));
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
  return shuffled(demands, random).sort((left, right) => left.candidates.length - right.candidates.length);
}

function matchDemands(demands) {
  const questionToDemand = new Map();
  const demandToQuestion = new Map();
  const byId = new Map(demands.map((demand) => [demand.id, demand]));

  function assign(demand, visited) {
    for (const code of demand.candidates) {
      if (visited.has(code)) continue;
      visited.add(code);
      const occupiedBy = questionToDemand.get(code);
      if (!occupiedBy || assign(byId.get(occupiedBy), visited)) {
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
  if (!Number.isInteger(examCount) || examCount < 1) throw new Error("생성할 시험지 수를 1 이상 입력하세요.");
  const random = seededRandom(seed);
  const demands = candidateMap(questions, rules, examCount, usedCodes, random);
  const empty = demands.find((demand) => demand.candidates.length === 0);
  if (empty) throw new Error(`시험지 ${empty.examIndex + 1}의 #${empty.slot} 조건에 맞는 문항이 없습니다.`);
  const matched = matchDemands(demands);
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
