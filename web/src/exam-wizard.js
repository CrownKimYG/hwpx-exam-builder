import { compileGroupedRules, groupCatalog, initialGroupedConfig, subjectName } from './grouped-generator.js';

export function mountExamWizard({ document: doc, getState, questions, estimate, rules, save }) {
  const $ = selector => doc.querySelector(selector);
  const make = (tag, text, className) => { const el = doc.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
  const button = (text, action) => { const el = make('button', text); el.type = 'button'; el.addEventListener('click', action); return el; };
  const mode = $('#quick-mode');
  mode.add(new Option('과목 비율 · 단원 묶음', 'grouped'), 0); mode.value = 'grouped';
  let step = 0, reached = 0, subjectIndex = 0, screen = 'draw';
  let quickRef = getState().quick, resultIndex = 0;
  const selections = new Set();
  const workspace = $('#workspace'), body = $('#quick-body'), builder = $('.builder-panel'), exams = $('.exam-list-card');
  const nav = make('nav', '', 'workspace-nav'); nav.setAttribute('aria-label', '작업 화면');
  for (const [key, label] of [['banks', '문제은행'], ['draw', '출제'], ['papers', '시험지']]) {
    const b = button(label, () => showScreen(key)); b.dataset.screen = key; nav.append(b);
  }
  workspace.prepend(nav);
  const steps = make('nav', '', 'wizard-steps'); steps.setAttribute('aria-label', '출제 단계');
  const panels = Array.from({ length: 5 }, (_, i) => { const p = make('section', '', 'wizard-panel'); p.id = `wizard-panel-${i}`; return p; });
  const controls = make('div', '', 'wizard-controls');
  const previous = button('이전', () => go(step - 1));
  const progress = make('span');
  const next = button('다음 →', () => advance()); next.classList.add('primary');
  controls.append(previous, progress, next);
  const error = make('p', '', 'wizard-error'); error.setAttribute('role', 'alert');
  const ratio = make('div', '', 'wizard-ratios'), groups = make('div', '', 'wizard-groups'), review = make('div', '', 'wizard-review');
  const automatic = make('div', '', 'wizard-automatic');
  const autoLabel = make('label', '', 'wizard-check'), autoCheck = make('input');
  autoCheck.type = 'checkbox'; autoCheck.checked = true; autoCheck.disabled = true;
  autoLabel.append(autoCheck, doc.createTextNode('단원 균등 추첨'));
  automatic.append(autoLabel, button('단원·난이도 지정', () => { mode.value = 'matrix'; mode.dispatchEvent(new doc.defaultView.Event('change')); go(2); }));
  const settings = $('.exam-settings'); settings.open = true;
  panels[0].append($('.preset-picker'), $('#exam-preset-status'), settings, mode.closest('.bank-selection'));
  panels[1].append(ratio, $('#bank-quotas'));
  panels[2].append(groups, automatic, $('#mixed-config'), $('#matrix-tabs'), $('#matrix-wrap'));
  panels[3].append(review, $('.history-options'), $('.quick-actions'));
  const results = make('div', '', 'wizard-results'); panels[4].append(results);
  builder.append(exams);
  body.replaceChildren(steps, ...panels, error, controls);
  $('#toggle-quick').hidden = true;
  $('.preset-manage-body p')?.remove();
  $('.history-options p:not([id])')?.remove();
  const config = () => {
    const state = getState();
    state.quick.grouped ||= initialGroupedConfig(questions());
    const c = state.quick.grouped;
    // New sources appear as new singleton groups; removed references remain
    // visible and invalid until the user explicitly removes them.
    for (const subject of groupCatalog(questions())) {
      let current = c.subjects.find(s => s.name === subject.name);
      if (!current) { current = { name: subject.name, weight: 1, bankWeights: null, groups: [] }; c.subjects.push(current); }
      const included = new Set(current.groups.flatMap(g => g.units));
      for (const key of subject.units.keys()) if (!included.has(key)) current.groups.push({ units: [key], count: 'auto', difficulty: '' });
    }
    return c;
  };
  function changed() { reached = Math.min(reached, 3); error.textContent = ''; estimate(); save(); }
  function numberField(label, value, change, { min = 0, max = 100 } = {}) {
    const field = make('label', '', 'wizard-field'); field.append(make('span', label));
    const input = make('input'); input.type = 'number'; input.min = min; input.max = max; input.step = '1'; input.value = value;
    input.addEventListener('input', () => { change(input.value === '' ? NaN : Number(input.value)); changed(); }); field.append(input); return field;
  }
  function renderRatios() {
    ratio.replaceChildren();
    const c = config(), catalog = groupCatalog(questions());
    c.subjects.forEach(s => {
      const card = make('div', '', 'wizard-subject');
      card.append(numberField(s.name, s.weight, value => { s.weight = value; }));
      const books = make('details'); books.append(make('summary', '교재 비율'));
      const automatic = make('label', '', 'wizard-check'), checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = !s.bankWeights;
      automatic.append(checkbox, doc.createTextNode('자동')); books.append(automatic);
      const banks = [...(catalog.find(item => item.name === s.name)?.banks || [])];
      checkbox.addEventListener('change', () => { s.bankWeights = checkbox.checked ? null : Object.fromEntries(banks.map(id => [id, 1])); renderRatios(); changed(); });
      if (s.bankWeights) for (const id of new Set([...banks, ...Object.keys(s.bankWeights)])) {
        books.append(numberField(getState().bankProfiles.find(b => b.bankId === id)?.displayName || '연결되지 않은 교재', s.bankWeights[id] ?? 0, value => { s.bankWeights[id] = value; }));
      }
      card.append(books); ratio.append(card);
    });
  }
  function renderGroups() {
    groups.replaceChildren();
    const c = config();
    if (!c.subjects.length) { groups.append(make('p', '문제은행을 연결하세요.')); return; }
    subjectIndex = Math.min(subjectIndex, c.subjects.length - 1);
    const tabs = make('div', '', 'wizard-subject-tabs');
    c.subjects.forEach((s, i) => { const b = button(s.name, () => { subjectIndex = i; selections.clear(); renderGroups(); }); b.setAttribute('aria-pressed', String(i === subjectIndex)); tabs.append(b); });
    groups.append(tabs);
    const s = c.subjects[subjectIndex];
    const catalog = groupCatalog(questions()).find(item => item.name === s.name);
    const name = key => {
      const label = catalog?.units.get(key);
      if (!label) return `${key.split('::').at(-1)} · 연결 필요`;
      if ([...catalog.units.values()].filter(n => n === label).length < 2) return label;
      const ids = new Set(questions().filter(q => q.unitKey === key).map(q => q.bankId));
      return `${label} · ${getState().bankProfiles.filter(b => ids.has(b.bankId)).map(b => b.displayName).join(', ')}`;
    };
    const chips = make('div', '', 'wizard-unit-picker');
    for (const key of new Set(s.groups.flatMap(g => g.units))) {
      const b = button(name(key), () => { selections.has(key) ? selections.delete(key) : selections.add(key); renderGroups(); [...groups.querySelectorAll('.wizard-unit-picker button')].find(el => el.textContent === name(key))?.focus(); }); b.setAttribute('aria-pressed', String(selections.has(key))); chips.append(b);
    }
    const merge = button('선택 단원 묶기', () => {
      s.groups = s.groups.map(g => ({ ...g, units: g.units.filter(u => !selections.has(u)) })).filter(g => g.units.length).map(g => ({ ...g, count: g.count === 'auto' ? 'auto' : Math.min(Number(g.count), g.units.length) }));
      s.groups.push({ units: [...selections], count: 'auto', difficulty: '' }); selections.clear(); renderGroups(); changed();
    }); merge.disabled = !selections.size;
    groups.append(chips, merge);
    const grid = make('div', '', 'wizard-group-grid');
    s.groups.forEach((g, i) => {
      const card = make('div', '', 'wizard-group'); const head = make('div', '', 'wizard-group-head'); head.append(make('span', `묶음 ${i + 1}`));
      const select = make('select'); select.setAttribute('aria-label', `${s.name} 묶음 ${i + 1} 문항 수`);
      select.add(new Option('자동', 'auto')); for (let n = 0; n <= g.units.length; n++) select.add(new Option(`${n}문항`, n)); select.value = g.count;
      select.addEventListener('change', () => { g.count = select.value; changed(); }); head.append(select); card.append(head);
      const list = make('div', '', 'wizard-group-units'); for (const key of g.units) list.append(make('span', name(key))); card.append(list);
      const details = make('details'); details.append(make('summary', '조건'));
      const difficulty = make('select'); difficulty.setAttribute('aria-label', `${s.name} 묶음 ${i + 1} 난이도`);
      for (const [v, t] of [['', '난이도 전체'], ['lv1', '하 / lv1'], ['lv2', '중 / lv2'], ['lv3', '상 / lv3'], ['유제', '유제'], ['미분류', '미분류']]) difficulty.add(new Option(t, v));
      difficulty.value = g.difficulty || ''; difficulty.addEventListener('change', () => { g.difficulty = difficulty.value; changed(); }); details.append(difficulty);
      if (g.units.length > 1) details.append(button('묶음 해제', () => { s.groups.splice(i, 1, ...g.units.map(unit => ({ units: [unit], count: 'auto', difficulty: g.difficulty }))); renderGroups(); changed(); }));
      card.append(details); grid.append(card);
    }); groups.append(grid);
  }
  function renderReview() {
    review.replaceChildren();
    const state = getState();
    for (const [label, value, target] of [['시험지', `${$('#quick-question-count').value}문항 × ${$('#quick-exam-count').value}부`, 0], ['출제 방식', mode.selectedOptions[0]?.textContent || '', 0]]) {
      const row = make('div', '', 'wizard-review-row'); row.append(make('span', label), make('strong', value), button('수정', () => go(target))); review.append(row);
    }
    if (mode.value === 'grouped') {
      const c = config();
      const row = make('div', '', 'wizard-review-row'); row.append(make('span', '과목 비율'), make('strong', c.subjects.map(s => `${s.name} ${s.weight}`).join(' : ')), button('수정', () => go(1))); review.append(row);
      const catalog = groupCatalog(questions());
      for (const s of c.subjects) {
        const card = make('div', '', 'wizard-review-subject'); card.append(make('strong', s.name));
        if (s.bankWeights) card.append(make('p', Object.entries(s.bankWeights).map(([id, w]) => `${state.bankProfiles.find(b => b.bankId === id)?.displayName || '연결 필요'} ${w}`).join(' : ')));
        for (const g of s.groups) card.append(make('div', `${g.units.map(u => catalog.find(item => item.name === s.name)?.units.get(u) || u).join(' · ')} → ${g.count === 'auto' ? '자동' : g.count + '문항'}${g.difficulty ? ' · ' + g.difficulty : ''}`, 'wizard-review-group'));
        card.append(button('수정', () => { subjectIndex = c.subjects.indexOf(s); go(2); })); review.append(card);
      }
    } else {
      review.append(button('교재 배분 수정', () => go(1)), button('조건 수정', () => go(2)));
    }
  }
  function refresh() {
    settings.open = true;
    if (quickRef !== getState().quick) {
      quickRef = getState().quick;
      step = Math.max(0, Math.min(4, Number(quickRef.wizardStep) || 0)); reached = step;
      selections.clear();
    }
    const grouped = mode.value === 'grouped';
    body.classList.remove('hidden'); builder.classList.remove('quick-collapsed');
    $('#quick-question-count').readOnly = !grouped;
    ratio.hidden = !grouped; groups.hidden = !grouped;
    automatic.hidden = mode.value !== 'banks';
    $('#bank-quotas').classList.toggle('hidden', grouped);
    if (grouped) {
      $('#quick-question-count').value = getState().quick.questionCount;
      $('#matrix-tabs').classList.add('hidden'); $('#matrix-wrap').classList.add('hidden');
      renderRatios(); renderGroups();
    }
    renderReview(); renderResults(); renderSteps();
  }
  function renderResults() {
    const state = getState(), ids = state.quick.wizardResultIds;
    const available = ids ? state.exams.filter(e => ids.includes(e.id)) : state.exams;
    results.replaceChildren();
    if (!available.length) { results.append(make('p', '생성된 시험지가 없습니다.')); return; }
    resultIndex = Math.min(resultIndex, available.length - 1);
    const chooser = make('select'); chooser.setAttribute('aria-label', '추첨 결과 시험지');
    available.forEach((exam, i) => chooser.add(new Option(exam.title, i))); chooser.value = resultIndex;
    chooser.addEventListener('change', () => { resultIndex = Number(chooser.value); renderResults(); results.querySelector('select')?.focus(); });
    const list = make('ol');
    const selected = available[resultIndex].codesText.trim().split(/[\s,]+/).filter(Boolean);
    const byCode = new Map(getState().questions.map(q => [q.code, q]));
    for (const code of selected) {
      const q = byCode.get(code), row = make('li');
      if (q) { row.append(make('span', subjectName(q.subject)), make('strong', q.unitName), make('small', `${state.bankProfiles.find(b => b.bankId === q.bankId)?.displayName || ''} · ${q.difficulty}`)); }
      else row.textContent = code;
      list.append(row);
    }
    results.append(chooser, list, make('p', `${selected.length}문항 · ${available.length}부`));
  }
  function renderSteps() {
    steps.replaceChildren(...['시험지', '과목 비율', '단원 묶음', '확인', '결과'].map((name, i) => {
      if (mode.value !== 'grouped' && i === 1) name = '교재 배분';
      if (mode.value !== 'grouped' && i === 2) name = '출제 조건';
      const b = button(`${i < step ? '✓' : i + 1} ${name}`, () => go(i)); b.disabled = i > reached; b.setAttribute('aria-controls', panels[i].id); if (step === i) b.setAttribute('aria-current', 'step'); return b;
    }));
    panels.forEach((panel, i) => { panel.hidden = i !== step; });
    previous.disabled = step === 0; progress.textContent = `${step + 1} / 5`;
    next.hidden = step === 3; next.textContent = step === 4 ? '시험지 열기 →' : '다음 →';
    $('#quick-generate').textContent = `${$('#quick-exam-count').value}부 추첨`;
  }
  function go(nextStep) { step = Math.max(0, Math.min(4, nextStep)); reached = Math.max(reached, step); getState().quick.wizardStep = step; error.textContent = ''; refresh(); if (step === 3) estimate(); steps.querySelector('[aria-current]')?.focus(); save(); }
  function advance() {
    error.textContent = '';
    try {
      if (step === 0) {
        for (const id of ['#quick-question-count', '#quick-exam-count']) { const input = $(id); if (!input.readOnly && !input.checkValidity()) { input.reportValidity(); return; } }
      }
      if (mode.value === 'grouped' && step > 0) compileGroupedRules(config(), Number($('#quick-question-count').value));
      if (step === 4) { showScreen('papers'); return; }
      if (step === 2) rules();
      go(step + 1); save();
    } catch (e) { error.textContent = e.message; }
  }
  function showScreen(value) {
    screen = value; doc.body.dataset.workspaceScreen = value;
    nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.screen === value)));
    if (value === 'banks') $('#bank-manager').open = true;
    if (value === 'draw') refresh();
  }
  mode.addEventListener('change', () => { go(0); changed(); });
  $('#quick-body').addEventListener('input', event => { if (!event.target.closest('.exam-list-card')) { reached = Math.min(reached, 3); renderSteps(); } });
  showScreen('draw'); refresh();
  return { refresh, config, conditions() { showScreen('draw'); go(2); }, generated(count) { getState().quick.wizardResultIds = getState().exams.slice(-count).map(e => e.id); resultIndex = 0; showScreen('draw'); go(4); }, showScreen };
}
