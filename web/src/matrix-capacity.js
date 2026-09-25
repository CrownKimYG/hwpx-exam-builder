// Identical candidate sets are pooled. A max-flow feasibility check allocates
// every slot once per paper without repeatedly generating/shuffling exam sets.
export function matrixCapacity({ questions, rules, usedCodes = new Set(), cap = 999 }, matches) {
  if (!rules.size) return 0;
  const slots = [...rules.values()], pools = new Map(), seen = new Set();
  for (const q of questions) {
    if (usedCodes.has(q.code) || seen.has(q.code)) continue;
    seen.add(q.code);
    const allowed = slots.flatMap((predicates, i) => matches(q, predicates) ? [i] : []);
    if (!allowed.length) continue;
    const key = allowed.join(',');
    if (!pools.has(key)) pools.set(key, { allowed, count: 0 });
    pools.get(key).count++;
  }
  const groups = [...pools.values()];
  const capacities = slots.map((_, i) => groups.reduce((n, p) => n + (p.allowed.includes(i) ? p.count : 0), 0));
  let low = 0, high = Math.min(cap, Math.floor(groups.reduce((n, p) => n + p.count, 0) / slots.length), ...capacities);
  function feasible(copies) {
    const source = 0, slotBase = 1, poolBase = slotBase + slots.length, sink = poolBase + groups.length;
    const edges = Array.from({ length: sink + 1 }, () => []);
    const add = (from, to, capacity) => {
      const forward = { to, capacity, reverse: edges[to].length };
      const backward = { to: from, capacity: 0, reverse: edges[from].length };
      edges[from].push(forward); edges[to].push(backward);
    };
    slots.forEach((_, i) => add(source, slotBase + i, copies));
    groups.forEach((pool, i) => { add(poolBase + i, sink, pool.count); pool.allowed.forEach(slot => add(slotBase + slot, poolBase + i, copies)); });
    let flow = 0;
    while (true) {
      const level = Array(edges.length).fill(-1), queue = [source]; level[source] = 0;
      for (let head = 0; head < queue.length; head++) for (const edge of edges[queue[head]]) {
        if (edge.capacity > 0 && level[edge.to] < 0) { level[edge.to] = level[queue[head]] + 1; queue.push(edge.to); }
      }
      if (level[sink] < 0) return flow === copies * slots.length;
      const next = Array(edges.length).fill(0);
      function send(node, amount) {
        if (node === sink) return amount;
        for (; next[node] < edges[node].length; next[node]++) {
          const edge = edges[node][next[node]];
          if (edge.capacity <= 0 || level[edge.to] !== level[node] + 1) continue;
          const sent = send(edge.to, Math.min(amount, edge.capacity));
          if (sent) { edge.capacity -= sent; edges[edge.to][edge.reverse].capacity += sent; return sent; }
        }
        return 0;
      }
      let sent;
      while ((sent = send(source, copies * slots.length - flow)) > 0) flow += sent;
      if (flow === copies * slots.length) return true;
    }
  }
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (feasible(middle)) low = middle; else high = middle - 1;
  }
  return low;
}
