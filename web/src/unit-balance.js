// Count units separately for each bank. Balance is a preference: explicit
// conditions and availability always take precedence.
export function createUnitBalance(examCount, random) {
  const exams = Array.from({ length: examCount }, () => new Map());
  const total = new Map();
  const keyOf = q => JSON.stringify([q.bankId ?? null, q.unitKey ?? null]);
  return {
    add(exam, question, delta) {
      const key = keyOf(question);
      exams[exam].set(key, (exams[exam].get(key) || 0) + delta);
      total.set(key, (total.get(key) || 0) + delta);
    },
    order(exam, values, questionOf) {
      const groups = new Map();
      for (const value of values) {
        const key = keyOf(questionOf(value));
        if (!groups.has(key)) groups.set(key, { key, tie: random(), values: [] });
        groups.get(key).values.push(value);
      }
      return [...groups.values()].sort((a, b) =>
        (exams[exam].get(a.key) || 0) - (exams[exam].get(b.key) || 0)
        || (total.get(a.key) || 0) - (total.get(b.key) || 0)
        || a.tie - b.tie
      ).flatMap(group => {
        const items = group.values;
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
      });
    },
  };
}
