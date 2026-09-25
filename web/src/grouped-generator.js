import { difficultyCounts } from './exam-series.js';
import { seededRandom } from './quick-generator.js';

export function subjectName(value) {
  const s = String(value || '과목 미분류').normalize('NFKC').replace(/\s+/g, '');
  if (/^수학(?:1|I)$/i.test(s)) return '수학Ⅰ';
  if (/^수학(?:2|II)$/i.test(s)) return '수학Ⅱ';
  return String(value || '과목 미분류').trim();
}

export function groupCatalog(questions) {
  const subjects = new Map();
  for (const q of questions) {
    const name = subjectName(q.subject);
    if (!subjects.has(name)) subjects.set(name, { name, units: new Map(), banks: new Set() });
    const subject = subjects.get(name);
    subject.units.set(q.unitKey, q.unitName || q.unitKey);
    subject.banks.add(q.bankId);
  }
  return [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
}

export function initialGroupedConfig(questions) {
  return { subjects: groupCatalog(questions).map(s => ({
    name: s.name, weight: 1, bankWeights: null,
    groups: [...s.units.keys()].map(unit => ({ units: [unit], count: 'auto', difficulty: '' })),
  })) };
}

export function compileGroupedRules(config, size) {
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('문항 수를 1~100 사이로 입력하세요.');
  if (!config?.subjects?.length) throw new Error('문제은행을 연결하세요.');
  const names = new Set();
  const subjects = structuredClone(config.subjects);
  for (const s of subjects) {
    if (!s.name || names.has(s.name)) throw new Error('과목이 중복되었습니다.');
    names.add(s.name);
    s.weight = Number(s.weight);
    if (!Number.isFinite(s.weight) || s.weight < 0) throw new Error(`${s.name}: 비율은 0 이상이어야 합니다.`);
    if (s.bankWeights && (!Object.keys(s.bankWeights).length || Object.values(s.bankWeights).some(w => !Number.isFinite(Number(w)) || Number(w) < 0) || !Object.values(s.bankWeights).some(w => Number(w) > 0))) throw new Error(`${s.name}: 교재 비율을 입력하세요.`);
    const seen = new Set();
    for (const g of s.groups) {
      if (!g.units.length || g.units.some(u => seen.has(u))) throw new Error(`${s.name}: 단원 묶음이 비었거나 중복되었습니다.`);
      g.units.forEach(u => seen.add(u));
      if (g.count !== 'auto') {
        g.count = Number(g.count);
        if (!Number.isInteger(g.count) || g.count < 0 || g.count > g.units.length) throw new Error(`${s.name}: 묶음 문항 수는 단원 수 이하여야 합니다.`);
      }
    }
  }
  if (!subjects.some(s => s.weight > 0)) throw new Error('과목 비율을 입력하세요.');
  return { kind: 'grouped', size, subjects };
}

// Largest remainder per paper, with cumulative deficit breaking ties. Each
// paper stays within floor/ceil of the requested ratio; remainders rotate.
export function apportion(total, weights, used, previousTotal, random) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => total * w / sum);
  const counts = exact.map(Math.floor);
  const ranked = weights.map((w, i) => ({ i, fraction: exact[i] - counts[i], deficit: (previousTotal + total) * w / sum - used[i] - counts[i], tie: random() }))
    .filter(x => weights[x.i] > 0 && x.fraction > 1e-9)
    .sort((a, b) => b.deficit - a.deficit || b.fraction - a.fraction || a.tie - b.tie);
  for (let i = 0, left = total - counts.reduce((a, b) => a + b, 0); i < left; i++) counts[ranked[i].i]++;
  return counts;
}

export function allocateGroupedExamSets({ questions, rules, examCount, usedCodes = new Set(), seed = 'groups', nodeLimit = 150000 }) {
  if (!Number.isInteger(examCount) || examCount < 1) throw new Error('시험지 수를 1 이상 입력하세요.');
  if (examCount * rules.size > 1000) throw new Error('한 번에 총 1,000문항까지 출제할 수 있습니다.');
  const difficulty = rules.difficultyCounts ? difficultyCounts(rules.difficultyCounts, rules.size) : null;
  const difficultyLeft = Array.from({ length: examCount }, () => difficulty && { ...difficulty });
  const random = seededRandom(seed);
  const shuffle = list => list.map(value => ({ value, tie: random() })).sort((a, b) => a.tie - b.tie).map(x => x.value);
  const poolMap = new Map();
  for (const q of questions) {
    if (usedCodes.has(q.code)) continue;
    const subject = subjectName(q.subject);
    const key = JSON.stringify([subject, q.bankId, q.unitKey, q.difficulty]);
    if (!poolMap.has(key)) poolMap.set(key, { ...q, subject, codes: [] });
    poolMap.get(key).codes.push(q.code);
  }
  const pool = [...poolMap.values()].map(g => ({ ...g, codes: shuffle(g.codes) }));
  const remaining = pool.map(g => g.codes.length);
  const subjectUsed = rules.subjects.map(() => 0);
  const bankUsed = rules.subjects.map(() => ({}));
  const bankLeft = Array.from({ length: examCount }, () => []);
  const demands = [];
  for (let e = 0; e < examCount; e++) {
    const quotas = apportion(rules.size, rules.subjects.map(s => s.weight), subjectUsed, e * rules.size, random);
    rules.subjects.forEach((s, si) => {
      if (s.weight === 0) return;
      const banks = s.bankWeights ? Object.keys(s.bankWeights) : [];
      if (banks.length) {
        const amounts = apportion(quotas[si], banks.map(b => Number(s.bankWeights[b])), banks.map(b => bankUsed[si][b] || 0), subjectUsed[si], random);
        bankLeft[e][si] = Object.fromEntries(banks.map((b, i) => { bankUsed[si][b] = (bankUsed[si][b] || 0) + amounts[i]; return [b, amounts[i]]; }));
      }
      subjectUsed[si] += quotas[si];
      const fixed = s.groups.reduce((n, g) => n + (g.count === 'auto' ? 0 : g.count), 0);
      const auto = quotas[si] - fixed;
      if (auto < 0) throw new Error(`시험지 ${e + 1} · ${s.name}: 묶음 배정 ${fixed}문항이 과목 배정 ${quotas[si]}문항을 초과합니다.`);
      const add = allowed => {
        const options = allowed.flatMap(gi => pool.flatMap((p, pi) => p.subject === s.name && s.groups[gi].units.includes(p.unitKey) && (!s.groups[gi].difficulty || s.groups[gi].difficulty === p.difficulty) && (!banks.length || banks.includes(p.bankId)) ? [{ gi, pi }] : []));
        demands.push({ e, si, options });
      };
      s.groups.forEach((g, gi) => { if (g.count !== 'auto') for (let n = 0; n < g.count; n++) add([gi]); });
      const autoGroups = s.groups.flatMap((g, i) => g.count === 'auto' ? [i] : []);
      for (let n = 0; n < auto; n++) add(autoGroups);
      const eligibleUnits = new Set(pool.filter(p => p.subject === s.name && s.groups.some(g => (g.count === 'auto' || g.count > 0) && g.units.includes(p.unitKey) && (!g.difficulty || g.difficulty === p.difficulty)) && (!banks.length || Number(s.bankWeights[p.bankId]) > 0)).map(p => p.unitKey));
      if (eligibleUnits.size < quotas[si]) throw new Error(`시험지 ${e + 1} · ${s.name}: 출제 가능한 단원 ${eligibleUnits.size}개, 필요한 문항 ${quotas[si]}개입니다.`);
    });
  }
  const selected = Array(demands.length).fill(null);
  const requirements = new Map();
  for (const d of demands) {
    const indices = [...new Set(d.options.map(o => o.pi))].sort((a, b) => a - b);
    const key = indices.join(',');
    if (!requirements.has(key)) requirements.set(key, { indices, count: 0, si: d.si });
    requirements.get(key).count++;
  }
  for (const { indices, count, si } of requirements.values()) {
    const available = indices.reduce((sum, i) => sum + remaining[i], 0);
    if (available < count) throw new Error(`${rules.subjects[si].name}: 묶음 조건의 미사용 문항 ${available}개, 필요한 문항 ${count}개입니다.`);
  }
  const unitsUsed = Array.from({ length: examCount }, () => new Set());
  const localGroup = Array.from({ length: examCount }, () => new Map());
  const totalGroup = new Map(), totalUnit = new Map();
  const unitKey = (d, o) => JSON.stringify([d.si, pool[o.pi].unitKey]);
  const groupKey = (d, o) => `${d.si}:${o.gi}`;
  const change = (map, key, delta) => map.set(key, (map.get(key) || 0) + delta);
  let nodes = 0;
  const deadline = Date.now() + 2500;
  function search(depth) {
    if (++nodes > nodeLimit || Date.now() > deadline) throw new Error('추첨 탐색 한도에 도달했습니다. 부수를 줄이거나 묶음 조건을 조정하세요.');
    if (depth === demands.length) return true;
    let best = -1, choices;
    for (let i = 0; i < demands.length; i++) {
      if (selected[i]) continue;
      const d = demands[i];
      const available = d.options.filter(o => remaining[o.pi] > 0 && (!difficultyLeft[d.e] || difficultyLeft[d.e][pool[o.pi].difficulty] > 0) && !unitsUsed[d.e].has(unitKey(d, o)) && (!bankLeft[d.e][d.si] || bankLeft[d.e][d.si][pool[o.pi].bankId] > 0));
      if (!available.length) return false;
      if (best < 0 || available.length < choices.length) { best = i; choices = available; }
    }
    const d = demands[best];
    // One random tie per unit, not per question or difficulty group.
    const ties = new Map();
    choices.forEach(o => { const k = unitKey(d, o); if (!ties.has(k)) ties.set(k, random()); });
    choices = shuffle(choices).sort((a, b) => (localGroup[d.e].get(groupKey(d, a)) || 0) - (localGroup[d.e].get(groupKey(d, b)) || 0)
      || (totalGroup.get(groupKey(d, a)) || 0) - (totalGroup.get(groupKey(d, b)) || 0)
      || (totalUnit.get(unitKey(d, a)) || 0) - (totalUnit.get(unitKey(d, b)) || 0)
      || ties.get(unitKey(d, a)) - ties.get(unitKey(d, b)));
    for (const o of choices) {
      const u = unitKey(d, o), g = groupKey(d, o), bank = bankLeft[d.e][d.si], b = pool[o.pi].bankId;
      selected[best] = o; remaining[o.pi]--; unitsUsed[d.e].add(u);
      change(localGroup[d.e], g, 1); change(totalGroup, g, 1); change(totalUnit, u, 1);
      if (bank) bank[b]--;
      if (difficultyLeft[d.e]) difficultyLeft[d.e][pool[o.pi].difficulty]--;
      if (search(depth + 1)) return true;
      if (bank) bank[b]++;
      if (difficultyLeft[d.e]) difficultyLeft[d.e][pool[o.pi].difficulty]++;
      selected[best] = null; remaining[o.pi]++; unitsUsed[d.e].delete(u);
      change(localGroup[d.e], g, -1); change(totalGroup, g, -1); change(totalUnit, u, -1);
    }
    return false;
  }
  const empty = demands.find(d => !d.options.length);
  if (empty) throw new Error(`시험지 ${empty.e + 1} · ${rules.subjects[empty.si].name}: 묶음 조건에 맞는 미사용 문항이 없습니다.`);
  if (!search(0)) throw new Error('과목·교재 비율, 난이도와 묶음 조건을 만족하는 미사용 단원이 부족합니다. 비율이나 묶음을 조정하세요.');
  const result = Array.from({ length: examCount }, () => []);
  selected.forEach((o, i) => result[demands[i].e].push(pool[o.pi].codes.pop()));
  return result.map(shuffle);
}
