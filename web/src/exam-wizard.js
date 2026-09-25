import { TRACKS, difficultyCounts, seriesSignature, seriesExams } from './exam-series.js';
import { compileGroupedRules, groupCatalog, initialGroupedConfig, subjectName } from './grouped-generator.js';

export function mountExamWizard({ document: doc, getState, questions, estimate, rules, save, download }) {
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
  const panels = Array.from({ length: 6 }, (_, i) => { const p = make('section', '', 'wizard-panel'); p.id = `wizard-panel-${i}`; return p; });
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
  const actions = $('.quick-actions'), history = $('.history-options');
  panels[3].append(review, history, actions);
  const trackViews = [make('div', '', 'wizard-track'), make('div', '', 'wizard-track')];
  const downloadView = make('div', '', 'wizard-download'); panels[5].append(downloadView);
  const outputOptions = $('.output-options'), outputHome = outputOptions?.parentElement;
  const workflow = make('select'); workflow.setAttribute('aria-label', '출제 순서');
  workflow.add(new Option('인문계 → 자연계', 'pair')); workflow.add(new Option('일반 출제', 'single'));
  const workflowField = make('label', '', 'wizard-field'); workflowField.append(make('span', '출제 순서'), workflow); panels[0].prepend(workflowField);
  workflow.addEventListener('change', () => { getState().quick.workflow = workflow.value; go(0); });
  const paired = () => mode.value === 'grouped' && getState().quick.workflow !== 'single' && !getState().handoffExams?.length;
  const activeTrack = () => paired() && (step === 3 || step === 4) ? TRACKS[step - 3] : null;
  const ready = track => seriesExams(getState(), track).length > 0;
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
    // Group selection and per-track difficulty quotas are independent controls.
    // Clear legacy group filters so restored workspaces cannot apply hidden restrictions.
    for (const subject of c.subjects) for (const group of subject.groups) delete group.difficulty;
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
      if (g.units.length > 1) card.append(button('묶음 해제', () => { s.groups.splice(i, 1, ...g.units.map(unit => ({ units: [unit], count: 'auto' }))); renderGroups(); changed(); }));
      grid.append(card);
    }); groups.append(grid); renderPositions(s, name);
  }
  function renderPositions(subject, unitName) {
    const field = make('label', '', 'wizard-field'), select = make('select');
    field.append(make('span', '번호 설정'), select); select.setAttribute('aria-label', `${subject.name} 번호 설정`);
    for (const [value, label] of [['auto', '자동'], ['unit', '단원별 · 난이도별'], ['group', '묶음별 · 난이도별']]) select.add(new Option(label, value));
    select.value = subject.positionMode || 'auto';
    select.addEventListener('change', () => { subject.positionMode = select.value; renderGroups(); changed(); });
    groups.append(field);
    if (!['unit', 'group'].includes(subject.positionMode)) return;
    const rows = subject.positionMode === 'group'
      ? subject.groups.map((g, i) => ({ label: `묶음 ${i + 1} · ${g.units.map(unitName).join(' · ')}`, cells: g.positions ||= {} }))
      : [...new Set(subject.groups.flatMap(g => g.units))].map(unit => ({ label: unitName(unit), cells: (subject.unitPositions ||= {})[unit] ||= {} }));
    rows.unshift({ label: subject.positionMode === 'group' ? '묶음 전체' : '단원 전체', cells: (subject.allPositions ||= {})[subject.positionMode] ||= {} });
    const table = make('table', '', 'rule-matrix'), head = make('thead'), header = make('tr');
    const difficulties = [['lv1', '하'], ['lv2', '중'], ['lv3', '상'], ['any', '난이도 전체']];
    header.append(make('th', subject.positionMode === 'group' ? '묶음' : '단원'));
    difficulties.forEach(([, label]) => header.append(make('th', label))); head.append(header); table.append(head);
    const tbody = make('tbody');
    for (const row of rows) {
      const tr = make('tr'); tr.append(make('th', row.label));
      for (const [key, label] of difficulties) {
        const td = make('td'), input = make('input'); input.type = 'text'; input.value = row.cells[key] || ''; input.placeholder = '1, 3~5';
        input.setAttribute('aria-label', `${subject.name} ${row.label} ${label} 출제 번호`);
        input.addEventListener('input', () => { row.cells[key] = input.value; changed(); }); td.append(input); tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody); const scroll = make('div', '', 'bank-matrix-scroll'); scroll.append(table); groups.append(scroll);
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
        for (const g of s.groups) card.append(make('div', `${g.units.map(u => catalog.find(item => item.name === s.name)?.units.get(u) || u).join(' · ')} → ${g.count === 'auto' ? '자동' : g.count + '문항'}`, 'wizard-review-group'));
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
      step = Math.max(0, Math.min(5, Number(quickRef.wizardStep) || 0)); reached = step;
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
    if (!paired() && step > 4) step = 0;
    $("#quick-question-count-label").textContent = paired() ? "계열별 문항 수" : "시험지당 문항 수";
    const copiesLabel = $("#quick-exam-count").parentElement.firstChild;
    if (copiesLabel.nodeType === 3) copiesLabel.textContent = paired() ? "계열별 시험지 수" : "시험지 수";
    workflow.value = paired() ? "pair" : "single"; workflowField.hidden = !grouped;
    renderReview(); renderResults(); renderSeries(); renderSteps();
  }
  function renderSeries() {
    const pair = paired(), state = getState();
    review.hidden = pair; results.hidden = pair;
    trackViews.forEach((view, i) => {
      view.hidden = !pair; panels[3 + i].prepend(view);
      if (!pair) return;
      const track = TRACKS[i]; state.quick.series ||= {};
      const profile = state.quick.series[track] ||= { counts: { lv1: '', lv2: '', lv3: '' } };
      view.replaceChildren(make('h2', track));
      const fields = make('div', '', 'wizard-difficulty');
      const total = make('p');
      const update = () => { total.textContent = `${Object.values(profile.counts).reduce((n, v) => n + (Number(v) || 0), 0)} / ${state.quick.questionCount}문항`; };
      for (const [key, label] of [['lv1', '하'], ['lv2', '중'], ['lv3', '상']]) {
        const field = make('label', '', 'wizard-field'), input = make('input');
        input.type = 'number'; input.min = 0; input.max = state.quick.questionCount; input.step = 1; input.value = profile.counts[key];
        input.setAttribute('aria-label', `${track} ${label} 문항 수`);
        input.addEventListener('input', () => { profile.counts[key] = input.value; update(); renderSteps(); estimate(); save(); });
        field.append(make('span', label), input); fields.append(field);
      }
      update(); view.append(fields, total);
      const available = seriesExams(state, track);
      if (available.length) {
        const list = make('div');
        const byCode = new Map(state.questions.map(q => [q.code, q]));
        available.forEach(exam => {
          const details = make('details'); details.append(make('summary', `${exam.title} · ${exam.codesText.trim().split(/\s+/).length}문항`));
          const units = make('ol');
          for (const code of exam.codesText.trim().split(/\s+/)) {
            const q = byCode.get(code);
            units.append(make('li', q ? `${subjectName(q.subject)} · ${q.unitName || q.unitKey} · ${{lv1:'하',lv2:'중',lv3:'상'}[q.difficulty] || q.difficulty}` : code));
          }
          details.append(units); list.append(details);
        });
        view.append(list);
      }
    });
    const target = pair && step === 4 ? 4 : 3;
    panels[target].append(history, actions);
    downloadView.replaceChildren();
    if (pair) {
      downloadView.append(make('h2', '다운로드'));
      for (const track of TRACKS) {
        const available = seriesExams(state, track);
        downloadView.append(make('p', `${track} · ${available.length}부`));
      }
      const status = make('p'); status.setAttribute('role', 'status');
      const start = button('두 계열 HWPX 다운로드', async () => {
        if (!TRACKS.every(ready)) { status.textContent = '인문계와 자연계를 다시 출제하세요.'; return; }
        start.disabled = true;
        const original = $('#build-status');
        const observer = original && new doc.defaultView.MutationObserver(() => { status.textContent = original.textContent; });
        observer?.observe(original, { childList: true, subtree: true, characterData: true });
        try { await download({ examIds: TRACKS.flatMap(t => seriesExams(getState(), t).map(e => e.id)) }); }
        finally { observer?.disconnect(); start.disabled = false; if (original) status.textContent = original.textContent; }
      });
      start.classList.add('primary'); start.disabled = !TRACKS.every(ready);
      downloadView.append(start, status);
    }
    if (outputOptions) (pair && screen === 'draw' && step === 5 ? downloadView : outputHome).append(outputOptions);
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
    const labels = paired() ? ['시험지', '과목 비율', '단원 묶음', '인문계', '자연계', '다운로드'] : ['시험지', '과목 비율', '단원 묶음', '확인', '결과'];
    steps.replaceChildren(...labels.map((name, i) => {
      if (mode.value !== 'grouped' && i === 1) name = '교재 배분';
      if (mode.value !== 'grouped' && i === 2) name = '출제 조건';
      const b = button(`${i < step ? '✓' : i + 1} ${name}`, () => go(i)); b.disabled = i > reached || (paired() && ((i >= 4 && !ready('인문계')) || (i >= 5 && !ready('자연계')))); b.setAttribute('aria-controls', panels[i].id); if (step === i) b.setAttribute('aria-current', 'step'); return b;
    }));
    panels.forEach((panel, i) => { panel.hidden = i !== step; });
    previous.disabled = step === 0; progress.textContent = `${step + 1} / ${labels.length}`;
    next.hidden = paired() ? step === 5 : step === 3;
    next.disabled = paired() && step >= 3 && !ready(activeTrack());
    next.textContent = paired() ? (step === 3 ? '자연계 →' : step === 4 ? '다운로드 →' : '다음 →') : step === 4 ? '시험지 열기 →' : '다음 →';
    $('#quick-generate').textContent = `${activeTrack() || ''} ${$('#quick-exam-count').value}부 ${ready(activeTrack()) ? '다시 출제' : '출제'}`.trim();
  }
  function go(nextStep) { step = Math.max(0, Math.min(paired() ? 5 : 4, nextStep)); reached = Math.max(reached, step); getState().quick.wizardStep = step; error.textContent = ''; refresh(); if (step === 3 || (paired() && step === 4)) estimate(); steps.querySelector('[aria-current]')?.focus(); save(); }
  function advance() {
    error.textContent = '';
    try {
      if (step === 0) {
        for (const id of ['#quick-question-count', '#quick-exam-count']) { const input = $(id); if (!input.readOnly && !input.checkValidity()) { input.reportValidity(); return; } }
      }
      if (mode.value === 'grouped' && step > 0) compileGroupedRules(config(), Number($('#quick-question-count').value));
      if (!paired() && step === 4) { showScreen('papers'); return; }
      if (paired() && step >= 3 && !ready(activeTrack())) return;
      if (step === 2) rules();
      go(step + 1); save();
    } catch (e) { error.textContent = e.message; }
  }
  function showScreen(value) {
    screen = value; doc.body.dataset.workspaceScreen = value;
    nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.screen === value)));
    if (value === 'banks') $('#bank-manager').open = true;
    if (value === 'draw') refresh();
    else if (outputOptions) outputHome.append(outputOptions);
  }
  mode.addEventListener('change', () => { go(0); changed(); });
  $('#quick-body').addEventListener('input', event => { if (!event.target.closest('.exam-list-card')) { reached = Math.min(reached, 3); renderSteps(); } });
  showScreen('draw'); refresh();
  return { refresh, config, activeTrack, difficulty() { const t = activeTrack(); return t ? difficultyCounts(getState().quick.series?.[t]?.counts, Number($('#quick-question-count').value)) : null; }, conditions() { showScreen('draw'); go(2); }, generated(count) {
      const track = activeTrack();
      if (track) {
        const state = getState();
        state.quick.series[track].result = { signature: seriesSignature(state.quick, track), exams: state.exams.slice(-count).map(e => ({ id: e.id, codesText: e.codesText })) };
        if (track === '인문계' && state.quick.series['자연계']) delete state.quick.series['자연계'].result;
        reached = Math.max(reached, step + 1); refresh(); save(); return;
      }
      getState().quick.wizardResultIds = getState().exams.slice(-count).map(e => e.id); resultIndex = 0; showScreen('draw'); go(4); }, showScreen };
}
