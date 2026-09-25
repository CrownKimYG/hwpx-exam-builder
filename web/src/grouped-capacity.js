import { allocateGroupedExamSets } from './grouped-generator.js';

// Report a demonstrated feasible count, not an unproven mathematical maximum:
// ratio rounding can make feasibility non-monotonic between paper counts.
export function estimateGroupedCapacity({ questions, rules, usedCodes = new Set(), seed = 'estimate' }, { budgetMs = 5000 } = {}) {
  const available = questions.filter(q => !usedCodes.has(q.code)).length;
  const cap = Math.min(Math.floor(available / rules.size), Math.floor(1000 / rules.size));
  let low = 0, high = cap, limited = false, growing = true;
  const deadline = Date.now() + budgetMs;
  while (low < high) {
    if (Date.now() >= deadline) { limited = true; break; }
    const count = low === 0 ? 1 : growing ? Math.min(high, low * 2) : Math.ceil((low + high) / 2);
    try {
      allocateGroupedExamSets({ questions, rules, usedCodes, seed, examCount: count });
      low = count;
    } catch (error) {
      if (/한도/.test(error.message)) { limited = true; break; }
      if (count === 1) return { count: 0, limited: false, reason: error.message };
      high = count - 1; growing = false;
    }
  }
  return { count: low, limited, capped: low === Math.floor(1000 / rules.size) };
}
