import { normalizeEquationScript } from './parser.js';

const tag = n => n.localName || n.nodeName.split(':').pop();
const all = (n, name) => [...n.getElementsByTagNameNS('*', name)];
const key = equation => normalizeEquationScript(all(equation, 'script')[0]?.textContent || '').replace(/\s+/g, '');
const compact = value => value.replace(/\s+/g, ' ').trim();

function solutionTokens(table) {
  let note = table.parentElement;
  while (note && tag(note) !== 'endNote') note = note.parentElement;
  if (!note) return [];
  const result = [];
  const visit = n => {
    if (['tbl', 'pic', 'shapeComment'].includes(tag(n))) return;
    if (tag(n) === 'equation') { result.push({ key: key(n), after: '' }); return; }
    if (tag(n) === 't' && result.length) {
      const inlineText = node => node.nodeType === 3 ? node.nodeValue
        : tag(node) === 'lineBreak' ? ' ' : [...node.childNodes].map(inlineText).join('');
      result.at(-1).after += inlineText(n);
      return;
    }
    if (tag(n) === 'lineBreak' && result.length) result.at(-1).after += ' ';
    [...n.children].forEach(visit);
    if (tag(n) === 'p' && result.length) result.at(-1).after += ' ';
  };
  visit(note);
  return result;
}

// Restore only source-backed connectors; never infer a mathematical relation.
function recoverConnectors(list, tokens) {
  if (all(list, 't').some(n => n.textContent.trim())) return;
  const equations = all(list, 'equation');
  if (!equations.length || !tokens.length) return;
  const keys = equations.map(key);
  const matches = [];
  for (let start = 0; start < tokens.length; start++) {
    if (tokens[start].key !== keys[0]) continue;
    const indices = [start];
    for (const k of keys.slice(1)) {
      const next = tokens.findIndex((t, i) => i > indices.at(-1) && t.key === k);
      if (next < 0) break;
      indices.push(next);
    }
    if (indices.length === keys.length) matches.push(indices);
  }
  if (!matches.length) return;
  const distance = m => m.at(-1) - m[0];
  const shortest = Math.min(...matches.map(distance));
  const candidates = matches.filter(m => distance(m) === shortest);
  const connector = (m, i) => {
    const following = compact(tokens[m[i]].after);
    if (i < m.length - 1 && m[i + 1] === m[i] + 1) {
      // Adjacent equations have no omitted mathematical objects between them.
      return following.length <= 40 && !/[\[\]]/.test(following) ? following : '';
    }
    return following.match(/^(?:일\s*때|에서|이므로|이어서|이고|이면|이어야\s*한다\.?|이다\.?|또는|이거나|을\s*만족하는|를\s*만족하는)/u)?.[0] || '';
  };
  equations.forEach((equation, i) => {
    const options = new Set(candidates.map(m => connector(m, i)));
    if (options.size !== 1) return; // Repeated formulas with different contexts are ambiguous.
    const value = [...options][0];
    if (!value) return;
    const t = list.ownerDocument.createElementNS(equation.namespaceURI, `${equation.prefix ? equation.prefix + ':' : ''}t`);
    t.textContent = `${value} `;
    equation.after(t);
  });
}

export function normalizeRubricCriterion(list, table) {
  recoverConnectors(list, solutionTokens(table));
  const paragraphs = [...list.children].filter(n => tag(n) === 'p');
  const first = paragraphs[0];
  if (!first) return;
  for (const p of paragraphs) {
    for (const br of all(p, 'lineBreak')) br.replaceWith(p.ownerDocument.createTextNode(' '));
    for (const t of all(p, 't')) {
      // Touch text nodes only, preserving tabs, fields and equation controls.
      for (const node of [...t.childNodes]) if (node.nodeType === 3) node.nodeValue = node.nodeValue.replace(/[\r\n]+/g, ' ');
    }
    if (p === first) continue;
    const run = [...p.children].find(n => tag(n) === 'run');
    if (run) {
      const t = p.ownerDocument.createElementNS(run.namespaceURI, `${run.prefix ? run.prefix + ':' : ''}t`);
      t.textContent = ' ';
      run.prepend(t);
    }
    [...p.children].filter(n => tag(n) !== 'linesegarray').forEach(n => first.appendChild(n));
    p.remove();
  }
  all(first, 'linesegarray').forEach(n => n.remove());
}
