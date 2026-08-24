import initRhwp, { HwpDocument } from "@rhwp/core";
import rhwpWasmUrl from "@rhwp/core/rhwp_bg.wasm?url";
import JSZip from "jszip";
import "./styles.css";
import { parseHwpx, prepareHwpxForPreview, sanitizeHwpxWatermarks } from "./parser.js";
import {
  bankPreviewBytes,
  isLegacyHwpFile,
  isSupportedBankFile,
  normalizeBankFile,
  repairConvertedHwpxBinData,
} from "./hwp-converter.js";
import { applyTemplateFieldValues, inspectTemplateFields } from "./template-fields.js";
import {
  buildExamFromSourcesHwpx,
  inspectTemplateExplanationMarker,
  inspectTemplateSlots,
  validateGeneratedExamHwpx,
} from "./template-builder.js";
import {
  DIFFICULTIES,
  createProjectSnapshot,
  parseBankFilename,
  parseQuestionCodes,
  projectFileIdentity,
  questionCode,
  sameFileIdentity,
  sortBankFiles,
  unitKey,
  validateProjectSnapshot,
} from "./bank-model.js";
import {
  allocateExamSets,
  compileSlotRules,
  estimateMaximumExamSets,
} from "./quick-generator.js";
import {
  AUTO_BANK_RULE_ID,
  BANK_RULES,
  DEFAULT_BANK_RULE_ID,
  createBankProfile,
  detectBankRule,
  describeBankFolder,
  fileAnalysisCacheKey,
  findMatchingBankProfile,
  hydrateBankAnalysis,
  profileFileSettingKey,
  serializeBankAnalysis,
  updateBankProfileForFolder,
} from "./bank-cache-model.js";
import {
  bankCacheAvailable,
  clearBankFileAnalyses,
  countCachedFiles,
  deleteBankProfile,
  getCachedFileAnalysis,
  listBankProfiles,
  pruneBankFileAnalyses,
  requestPersistentBankCache,
  saveBankProfile,
  saveCachedFileAnalysis,
} from "./bank-cache.js";

const DEFAULT_TEMPLATE_URL = "./templates/basic-math-exam.hwpx";
const FIELD_LABELS = {
  title: "시험지 제목",
  time: "시험 시간(분)",
  test_questions_count: "총 문항 수",
  quest_count: "총 문항 수",
};
const QUESTION_COUNT_FIELDS = new Set(["test_questions_count", "quest_count"]);

const elements = Object.fromEntries([
  "status", "workspace", "generation-bar", "upload-card", "upload-actions", "hero-bank-tools", "folder-input", "files-input", "reset-bank", "bank-drop", "saved-banks",
  "bank-profile-summary", "active-bank-name", "rename-bank-profile", "bank-profile-dialog", "bank-profile-form",
  "bank-profile-dialog-title", "bank-profile-name", "cancel-bank-profile", "saved-banks-dialog", "saved-bank-list", "close-saved-banks",
  "metric-files", "metric-total", "metric-units", "metric-unclassified", "bank-attention", "bank-attention-text", "bank-manager",
  "bank-bulk-actions", "bank-selection-count", "bulk-bank-rule", "apply-bank-rule", "clear-bank-selection", "select-all-bank-files",
  "bank-file-rows", "question-metadata",
  "preview-file", "previous-page", "next-page", "page-label", "page-stage", "page-canvas", "page-loading",
  "zoom-out", "zoom-fit", "zoom-in", "zoom-label", "toggle-quick", "quick-body", "quick-question-count",
  "quick-exam-count", "quick-seed", "matrix-wrap", "quick-status", "quick-generate", "add-exam",
    "clear-exams", "exam-list", "template-file", "template-file-name", "output-type", "save-project",
    "project-file", "question-format", "build-exams", "template-fields", "field-grid", "build-status", "cancel-build",
].map((id) => [id.replace(/-([a-z])/g, (_, character) => character.toUpperCase()), document.querySelector(`#${id}`)]));

const state = {
  files: [],
  questions: [],
  exams: [],
  quick: {
    questionCount: 8,
    examCount: 1,
    seed: `seed-${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "")}`,
    cells: {},
  },
  settings: { outputType: "problem", questionFormat: "original" },
  currentFileCode: null,
  zoom: "fit",
  nextExamId: 1,
  pendingProject: null,
  bankProfile: null,
  selectedBankFiles: new Set(),
};

const templateState = {
  bytes: null,
  filename: "",
  fields: [],
  slots: [],
  hasExplanationMarker: false,
  values: new Map(),
  defaultPromise: null,
};

let documentViewer = null;
let currentPage = 0;
let pageCount = 0;
let previewRequest = 0;
let estimateTimer = null;
let measureContext = null;
let lastMeasuredFont = "";
let activeBuild = null;
let profileSaveQueue = Promise.resolve();
let bankReanalysisActive = false;

globalThis.measureTextWidth = (font, text) => {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  if (font !== lastMeasuredFont) {
    measureContext.font = font;
    lastMeasuredFont = font;
  }
  return measureContext.measureText(text).width;
};

const RHWP_INIT_TIMEOUT_MS = 15000;
const rhwpReady = Promise.race([
  Promise.resolve().then(() => initRhwp({ module_or_path: rhwpWasmUrl })),
  new Promise((_, reject) => window.setTimeout(
    () => reject(new Error("RHWP 렌더러 초기화 시간이 초과되었습니다. 페이지를 새로고침해 주세요.")),
    RHWP_INIT_TIMEOUT_MS,
  )),
]);

function setStatus(message, level = "") {
  elements.status.className = `status ${level}`.trim();
  elements.status.textContent = message;
}

function setBuildStatus(message, level = "") {
  elements.buildStatus.className = `build-status ${level}`.trim();
  elements.buildStatus.textContent = message;
}

class BuildCancelledError extends Error {
  constructor() {
    super("시험지 생성을 취소했습니다.");
    this.name = "BuildCancelledError";
  }
}

function ensureBuildActive(build) {
  if (build.cancelled) throw new BuildCancelledError();
}

function cancelActiveBuild() {
  if (!activeBuild || activeBuild.cancelled) return;
  activeBuild.cancelled = true;
  elements.cancelBuild.disabled = true;
  elements.cancelBuild.textContent = "취소 중...";
}

function createElement(name, { className = "", text = "", attributes = {} } = {}) {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text) element.textContent = text;
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function ruleLabel(ruleId) {
  return BANK_RULES.find((rule) => rule.id === ruleId)?.label || ruleId;
}

function selectedBankRuleId(ruleId) {
  return BANK_RULES.some((rule) => rule.id === ruleId) ? ruleId : AUTO_BANK_RULE_ID;
}

function resolvedBankRuleId(ruleId) {
  return ruleId !== AUTO_BANK_RULE_ID && BANK_RULES.some((rule) => rule.id === ruleId) ? ruleId : null;
}

function renderBankProfileSummary() {
  const profile = state.bankProfile;
  elements.bankProfileSummary.classList.toggle("hidden", !profile);
  elements.activeBankName.textContent = profile ? profile.displayName : "";
}

function setBankControlsCompact(compact) {
  if (compact) {
    elements.heroBankTools.append(elements.uploadActions, elements.bankProfileSummary, elements.status);
    elements.heroBankTools.classList.remove("hidden");
    elements.uploadCard.classList.add("hidden");
    return;
  }
  elements.bankDrop.insertBefore(elements.uploadActions, elements.folderInput);
  elements.bankDrop.insertBefore(elements.bankProfileSummary, elements.folderInput);
  elements.uploadCard.append(elements.status);
  elements.heroBankTools.classList.add("hidden");
  elements.uploadCard.classList.remove("hidden");
}

function queueBankProfileSave() {
  if (!state.bankProfile || !bankCacheAvailable()) return;
  state.bankProfile.updatedAt = new Date().toISOString();
  const snapshot = structuredClone(state.bankProfile);
  profileSaveQueue = profileSaveQueue
    .then(() => saveBankProfile(snapshot))
    .catch((error) => setStatus(`문제은행 캐시 저장 실패: ${error.message}`, "error"));
}

function applyBankProfileSettings(record) {
  const profile = state.bankProfile;
  if (!profile || record.bankId !== profile.bankId) return;
  const saved = profile.fileSettings?.[profileFileSettingKey(record.identity)];
  if (saved) {
    record.metadata = { ...record.metadata, ...(saved.metadata || {}) };
    record.questionOverrides = { ...(saved.questionOverrides || {}) };
  }
  record.selectedRuleId = selectedBankRuleId(saved?.selectedRuleId);
  record.resolvedRuleId = resolvedBankRuleId(saved?.resolvedRuleId);
  record.ruleId = record.resolvedRuleId || (
    record.selectedRuleId === AUTO_BANK_RULE_ID ? DEFAULT_BANK_RULE_ID : record.selectedRuleId
  );
}

function updateBankProfileFileSettings(record) {
  const profile = state.bankProfile;
  if (!profile || record.bankId !== profile.bankId) return;
  profile.fileSettings ||= {};
  profile.fileSettings[profileFileSettingKey(record.identity)] = {
    metadata: structuredClone(record.metadata),
    questionOverrides: structuredClone(record.questionOverrides || {}),
    selectedRuleId: record.selectedRuleId || AUTO_BANK_RULE_ID,
    resolvedRuleId: record.resolvedRuleId || null,
  };
  queueBankProfileSave();
}

function requestBankProfileDetails({ profile = null, descriptor, title = "문제은행 저장" }) {
  elements.bankProfileDialogTitle.textContent = title;
  elements.bankProfileName.value = profile?.displayName || descriptor.rootFolderName;
  return new Promise((resolve) => {
    const onClose = () => {
      elements.bankProfileDialog.removeEventListener("close", onClose);
      if (elements.bankProfileDialog.returnValue !== "confirm") {
        resolve(null);
        return;
      }
      resolve({
        displayName: elements.bankProfileName.value.trim() || descriptor.rootFolderName,
      });
    };
    elements.bankProfileDialog.addEventListener("close", onClose);
    elements.bankProfileDialog.returnValue = "";
    elements.bankProfileDialog.showModal();
    elements.bankProfileName.select();
  });
}

async function resolveFolderProfile(files) {
  const descriptor = describeBankFolder(files);
  if (!descriptor) return null;
  let profiles = [];
  try {
    profiles = await listBankProfiles();
  } catch {
    profiles = [];
  }
  const match = findMatchingBankProfile(profiles, descriptor);
  let profile;
  if (match) {
    profile = updateBankProfileForFolder(match.profile, descriptor);
  } else {
    const details = await requestBankProfileDetails({ descriptor });
    if (!details) return null;
    profile = createBankProfile({ ...details, descriptor });
  }
  try {
    await saveBankProfile(profile);
    requestPersistentBankCache();
  } catch {
    // 캐시가 차단돼도 현재 세션에서는 문제은행을 계속 사용할 수 있다.
  }
  return profile;
}

async function renameActiveBankProfile() {
  const profile = state.bankProfile;
  if (!profile) return;
  const descriptor = { rootFolderName: profile.rootFolderName, manifest: profile.manifest };
  const details = await requestBankProfileDetails({ profile, descriptor, title: "문제은행 수정" });
  if (!details) return;
  profile.displayName = details.displayName;
  try {
    await saveBankProfile(profile);
  } catch (error) {
    setStatus(`문제은행 캐시 저장 실패: ${error.message}`, "error");
  }
  renderBankProfileSummary();
}

async function renderSavedBankList() {
  let profiles;
  try {
    profiles = await listBankProfiles();
  } catch (error) {
    elements.savedBankList.replaceChildren(createElement("p", { className: "saved-bank-empty", text: error.message }));
    return;
  }
  if (!profiles.length) {
    elements.savedBankList.replaceChildren(createElement("p", { className: "saved-bank-empty", text: "저장된 문제은행이 없습니다." }));
    return;
  }
  const counts = await Promise.all(profiles.map(async (profile) => {
    try {
      return await countCachedFiles(profile.bankId);
    } catch {
      return 0;
    }
  }));
  const rows = profiles.map((profile, index) => {
    const row = createElement("div", { className: "saved-bank-row" });
    const main = createElement("div", { className: "saved-bank-main" });
    const name = createElement("input", { attributes: { type: "text", maxlength: "80", "aria-label": `${profile.displayName} 이름` } });
    name.value = profile.displayName;
    name.addEventListener("change", async () => {
      profile.displayName = name.value.trim() || profile.rootFolderName;
      profile.updatedAt = new Date().toISOString();
      await saveBankProfile(profile);
      if (state.bankProfile?.bankId === profile.bankId) {
        state.bankProfile.displayName = profile.displayName;
        renderBankProfileSummary();
      }
    });
    const meta = createElement("span", {
      className: "saved-bank-meta",
      text: `${profile.rootFolderName} · ${profile.manifest?.length || 0}개 파일 · 캐시 ${counts[index]}개 · 파일별 처리 방식`,
    });
    main.append(name, meta);
    const actions = createElement("div", { className: "saved-bank-actions" });
    const clear = createElement("button", { text: "분석 초기화", attributes: { type: "button" } });
    clear.addEventListener("click", async () => {
      if (!window.confirm(`${profile.displayName}의 분석 캐시를 초기화할까요?`)) return;
      await clearBankFileAnalyses(profile.bankId);
      await renderSavedBankList();
    });
    const remove = createElement("button", { text: "삭제", attributes: { type: "button" } });
    remove.addEventListener("click", async () => {
      if (!window.confirm(`${profile.displayName}과 분석 캐시를 삭제할까요?`)) return;
      await deleteBankProfile(profile.bankId);
      if (state.bankProfile?.bankId === profile.bankId) {
        state.bankProfile = null;
        renderBankProfileSummary();
      }
      await renderSavedBankList();
    });
    actions.append(clear, remove);
    row.append(main, actions);
    return row;
  });
  elements.savedBankList.replaceChildren(...rows);
}

async function showSavedBanks() {
  await renderSavedBankList();
  elements.savedBanksDialog.showModal();
}

function safeSvg(svgSource, label) {
  const parsed = new DOMParser().parseFromString(svgSource, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error(`${label} SVG를 읽지 못했습니다.`);
  parsed.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if ((name === "href" || name.endsWith(":href")) && !value.startsWith("data:") && !value.startsWith("#")) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  const root = parsed.documentElement;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", label);
  root.removeAttribute("width");
  root.removeAttribute("height");
  return document.importNode(root, true);
}

function applyZoom() {
  const svg = elements.pageCanvas.querySelector("svg");
  if (!svg) return;
  const viewBox = (svg.getAttribute("viewBox") || "").split(/[ ,]+/).map(Number);
  const aspect = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox[2] / viewBox[3] : 0.707;
  const availableWidth = Math.max(240, elements.pageStage.clientWidth - 32);
  const availableHeight = Math.max(320, elements.pageStage.clientHeight - 32);
  if (state.zoom === "fit") {
    const width = Math.min(availableWidth, availableHeight * aspect);
    elements.pageCanvas.style.width = `${Math.floor(width)}px`;
    elements.zoomLabel.textContent = "맞춤";
  } else {
    elements.pageCanvas.style.width = `${Math.floor(availableWidth * state.zoom)}px`;
    elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }
}

function renderPage(pageIndex) {
  if (!documentViewer || pageIndex < 0 || pageIndex >= pageCount) return;
  elements.pageLoading.classList.remove("hidden");
  elements.pageCanvas.classList.add("hidden");
  try {
    const svg = documentViewer.renderPageSvg(pageIndex);
    elements.pageCanvas.replaceChildren(safeSvg(svg, `HWPX 원본 ${pageIndex + 1}페이지`));
    currentPage = pageIndex;
    const record = state.files.find((item) => item.code === state.currentFileCode);
    if (record) record.lastPage = currentPage;
    elements.pageLabel.textContent = `${currentPage + 1} / ${pageCount}`;
    elements.previousPage.disabled = currentPage === 0;
    elements.nextPage.disabled = currentPage === pageCount - 1;
    elements.pageStage.scrollTo({ top: 0, left: 0, behavior: "instant" });
    elements.pageCanvas.classList.remove("hidden");
    applyZoom();
  } catch (error) {
    elements.pageCanvas.replaceChildren();
    setStatus(`페이지 표시 실패: ${error.message}`, "error");
  } finally {
    elements.pageLoading.classList.add("hidden");
  }
}

async function activatePreviewFile(code) {
  const record = state.files.find((item) => item.code === code && item.analysis && !item.error);
  if (!record) return;
  const request = ++previewRequest;
  state.currentFileCode = code;
  elements.previewFile.value = code;
  renderQuestionMetadata(record);
  elements.pageLoading.textContent = `${record.file.name} 페이지를 구성하는 중입니다...`;
  elements.pageLoading.classList.remove("hidden");
  elements.pageCanvas.classList.add("hidden");
  try {
    const previewBytes = await prepareHwpxForPreview(bankPreviewBytes(record));
    await rhwpReady;
    if (request !== previewRequest) return;
    documentViewer?.free?.();
    documentViewer = new HwpDocument(previewBytes);
    pageCount = documentViewer.pageCount();
    if (!pageCount) throw new Error("렌더링할 페이지를 찾지 못했습니다.");
    renderPage(Math.min(record.lastPage || 0, pageCount - 1));
    setStatus(`${record.code} · ${record.file.name} · ${record.questions.length}문항 준비 완료`, "success");
  } catch (error) {
    if (request !== previewRequest) return;
    documentViewer?.free?.();
    documentViewer = null;
    pageCount = 0;
    elements.pageLabel.textContent = "0 / 0";
    elements.pageLoading.textContent = `미리보기 실패: ${error.message}`;
    elements.pageLoading.classList.remove("hidden");
    setStatus(`미리보기 실패: ${error.message}`, "error");
  }
}

function switchPreviewFile(delta) {
  const available = state.files.filter((record) => record.analysis && !record.error);
  if (!available.length) return;
  const currentIndex = Math.max(0, available.findIndex((record) => record.code === state.currentFileCode));
  const target = available[Math.max(0, Math.min(available.length - 1, currentIndex + delta))];
  if (target.code !== state.currentFileCode) activatePreviewFile(target.code);
}

function renderPreviewOptions() {
  const options = state.files.filter((record) => record.analysis && !record.error).map((record) => {
    const option = createElement("option", { text: `${record.code} · ${record.metadata.subject} · ${record.metadata.unitName} · ${record.file.name}` });
    option.value = record.code;
    return option;
  });
  elements.previewFile.replaceChildren(...options);
  if (state.currentFileCode && options.some((option) => option.value === state.currentFileCode)) {
    elements.previewFile.value = state.currentFileCode;
  }
}

function countsFor(record) {
  const counts = Object.fromEntries([...DIFFICULTIES, "미분류"].map((difficulty) => [difficulty, 0]));
  record.questions.forEach((question) => { counts[question.difficulty] = (counts[question.difficulty] || 0) + 1; });
  return counts;
}

const PROCESSING_STATUS_LABELS = Object.freeze({
  pending: "대기",
  loading: "분석 중",
  cached: "캐시 사용",
  complete: "완료",
  "needs-review": "확인 필요",
  error: "처리 실패",
});

function recordNeedsAttention(record) {
  return record.processingStatus === "needs-review" || record.processingStatus === "error";
}

function renderBankSelectionControls() {
  const knownCodes = new Set(state.files.map((record) => record.code));
  state.selectedBankFiles = new Set([...state.selectedBankFiles].filter((code) => knownCodes.has(code)));
  const count = state.selectedBankFiles.size;
  elements.bankBulkActions.classList.toggle("hidden", count === 0);
  elements.bankSelectionCount.textContent = `${count}개 파일 선택됨`;
  elements.selectAllBankFiles.checked = Boolean(state.files.length) && count === state.files.length;
  elements.selectAllBankFiles.indeterminate = count > 0 && count < state.files.length;
  elements.bulkBankRule.disabled = bankReanalysisActive;
  elements.applyBankRule.disabled = bankReanalysisActive;
  elements.clearBankSelection.disabled = bankReanalysisActive;
}

function updateBankAttention() {
  const count = state.files.filter(recordNeedsAttention).length;
  elements.bankAttention.classList.toggle("hidden", count === 0);
  elements.bankAttentionText.textContent = `처리 방식을 확인해야 하는 파일이 ${count}개 있습니다.`;
}

function renderBankManager() {
  const rows = state.files.map((record) => {
    const row = createElement("tr", { className: recordNeedsAttention(record) ? "needs-attention" : "" });
    row.dataset.fileCode = record.code;
    const selectionCell = createElement("td");
    const checkbox = createElement("input", { attributes: { type: "checkbox", "aria-label": `${record.code} 선택` } });
    checkbox.checked = state.selectedBankFiles.has(record.code);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedBankFiles.add(record.code);
      else state.selectedBankFiles.delete(record.code);
      renderBankSelectionControls();
    });
    selectionCell.append(checkbox);
    const codeCell = createElement("td", { text: record.code });
    const filenameCell = createElement("td", { className: "filename", text: record.file.name });
    filenameCell.title = record.file.name;
    if (record.convertedFromHwp) filenameCell.append(createElement("span", { className: "format-badge", text: "HWP → HWPX" }));
    const ruleCell = createElement("td");
    const rule = createElement("select", { attributes: { "aria-label": `${record.code} 처리 방식` } });
    BANK_RULES.forEach((definition) => {
      const option = createElement("option", { text: definition.label });
      option.value = definition.id;
      rule.append(option);
    });
    rule.value = record.selectedRuleId || AUTO_BANK_RULE_ID;
    rule.disabled = bankReanalysisActive || record.processingStatus === "loading";
    rule.addEventListener("change", () => { void reanalyzeBankRecords([record], rule.value); });
    ruleCell.append(rule);
    const subjectCell = createElement("td");
    const subject = createElement("input", { attributes: { value: record.metadata.subject, "aria-label": `${record.code} 과목` } });
    subject.value = record.metadata.subject;
    subject.addEventListener("change", () => {
      record.metadata.subject = subject.value.trim() || "과목 미분류";
      updateBankProfileFileSettings(record);
      rebuildQuestionIndex();
    });
    subjectCell.append(subject);
    const unitCell = createElement("td");
    const unit = createElement("input", { attributes: { "aria-label": `${record.code} 단원` } });
    unit.value = record.metadata.unitName;
    unit.addEventListener("change", () => {
      record.metadata.unitName = unit.value.trim() || record.file.name.replace(/\.(?:hwp|hwpx)$/i, "");
      updateBankProfileFileSettings(record);
      rebuildQuestionIndex();
    });
    unitCell.append(unit);
    const counts = countsFor(record);
    const countCell = createElement("td", {
      className: "difficulty-counts",
      text: DIFFICULTIES.map((difficulty) => `${difficulty} ${counts[difficulty]}`).concat(`미분류 ${counts.미분류}`).join(" · "),
    });
    const resolvedLabel = record.selectedRuleId === AUTO_BANK_RULE_ID && record.resolvedRuleId
      ? ` · ${ruleLabel(record.resolvedRuleId)}`
      : "";
    const statusCell = createElement("td", {
      className: `processing-status ${record.processingStatus || "pending"}`,
      text: `${PROCESSING_STATUS_LABELS[record.processingStatus] || PROCESSING_STATUS_LABELS.pending}${resolvedLabel}`,
    });
    statusCell.title = record.processingMessage || record.error || "";
    if (recordNeedsAttention(record) && (record.processingMessage || record.error)) {
      statusCell.append(createElement("small", { text: record.processingMessage || record.error }));
    }
    const actionCell = createElement("td", { className: "bank-row-actions" });
    const view = createElement("button", { className: "icon-button", text: "보기", attributes: { type: "button" } });
    view.disabled = !record.analysis || Boolean(record.error);
    view.addEventListener("click", () => activatePreviewFile(record.code));
    const reanalyze = createElement("button", { className: "icon-button", text: "재분석", attributes: { type: "button" } });
    reanalyze.disabled = bankReanalysisActive || record.processingStatus === "loading";
    reanalyze.addEventListener("click", () => {
      void reanalyzeBankRecords([record], record.selectedRuleId || AUTO_BANK_RULE_ID);
    });
    const remove = createElement("button", { className: "icon-button", text: "삭제", attributes: { type: "button" } });
    remove.disabled = bankReanalysisActive;
    remove.addEventListener("click", () => removeBankRecord(record.code));
    actionCell.append(view, reanalyze, remove);
    row.append(selectionCell, codeCell, filenameCell, ruleCell, subjectCell, unitCell, countCell, statusCell, actionCell);
    return row;
  });
  elements.bankFileRows.replaceChildren(...rows);
  renderBankSelectionControls();
  updateBankAttention();
}

function renderQuestionMetadata(record) {
  if (!record?.analysis) {
    elements.questionMetadata.replaceChildren();
    return;
  }
  const heading = createElement("p", { className: "question-label", text: `${record.code} 문항별 난이도` });
  const rows = record.questions.map((question) => {
    const row = createElement("div", { className: "question-meta-row" });
    const code = createElement("strong", { text: question.code });
    const label = createElement("span", { className: "question-label", text: `${question.sourceLabel} · ${question.questionText || "본문"}` });
    label.title = question.questionText;
    const select = createElement("select", { attributes: { "aria-label": `${question.code} 난이도` } });
    [...DIFFICULTIES, "미분류"].forEach((difficulty) => {
      const option = createElement("option", { text: difficulty });
      option.value = difficulty;
      select.append(option);
    });
    select.value = question.difficulty;
    select.addEventListener("change", () => {
      record.questionOverrides[question.ordinal] = select.value;
      updateBankProfileFileSettings(record);
      rebuildQuestionIndex();
    });
    row.append(code, label, select);
    return row;
  });
  elements.questionMetadata.replaceChildren(heading, ...rows);
}

function rebuildQuestionIndex({ renderManager = true } = {}) {
  state.questions = state.files.flatMap((record) => {
    if (!record.analysis || record.error) {
      record.questions = [];
      return [];
    }
    const key = unitKey(record.metadata);
    record.questions = record.analysis.questions.map((question) => ({
      ...question,
      fileCode: record.code,
      code: questionCode(record.code, question.ordinal),
      subject: record.metadata.subject,
      unitNumber: record.metadata.unitNumber,
      unitName: record.metadata.unitName,
      unitKey: key,
      difficulty: record.questionOverrides[question.ordinal] || question.difficulty || "미분류",
    }));
    return record.questions;
  });
  elements.metricFiles.textContent = state.files.filter((record) => record.analysis && !record.error).length;
  elements.metricTotal.textContent = state.questions.length;
  elements.metricUnits.textContent = new Set(state.questions.map((question) => question.unitKey)).size;
  elements.metricUnclassified.textContent = state.questions.filter((question) => question.difficulty === "미분류").length;
  renderPreviewOptions();
  if (renderManager) renderBankManager();
  const selected = state.files.find((record) => record.code === state.currentFileCode);
  if (selected) renderQuestionMetadata(selected);
  renderQuickMatrix();
  validateExamDrafts();
}

function nextFileCode() {
  const maximum = Math.max(0, ...state.files.map((record) => Number(record.code) || 0));
  return String(maximum + 1).padStart(2, "0");
}

function resetBank({ clearProject = true } = {}) {
  previewRequest += 1;
  documentViewer?.free?.();
  documentViewer = null;
  state.files = [];
  state.questions = [];
  state.currentFileCode = null;
  state.bankProfile = null;
  state.selectedBankFiles.clear();
  pageCount = 0;
  currentPage = 0;
  if (clearProject) state.pendingProject = null;
  elements.pageCanvas.replaceChildren();
  elements.pageCanvas.classList.add("hidden");
  elements.pageLoading.textContent = "";
  elements.pageLoading.classList.remove("hidden");
  elements.pageLabel.textContent = "0 / 0";
  elements.workspace.classList.add("hidden");
  elements.generationBar.classList.add("hidden");
  setBankControlsCompact(false);
  renderBankProfileSummary();
  rebuildQuestionIndex();
  setStatus("초기화 완료.");
}

function removeBankRecord(code) {
  state.selectedBankFiles.delete(code);
  state.files = state.files.filter((record) => record.code !== code);
  if (state.currentFileCode === code) {
    state.currentFileCode = state.files.find((record) => record.analysis && !record.error)?.code || null;
    if (state.currentFileCode) activatePreviewFile(state.currentFileCode);
  }
  rebuildQuestionIndex();
}

function projectRecordFor(record) {
  return state.pendingProject?.files.find((saved) => sameFileIdentity(saved.identity, record.identity)) || null;
}

async function analyzeBankFileByRule(file, ruleId) {
  if (ruleId === DEFAULT_BANK_RULE_ID) return parseHwpx(file);
  throw new Error(`${ruleLabel(ruleId)} 처리 방식은 아직 사용할 수 없습니다.`);
}

async function processBankRecord(record, { force = false } = {}) {
  const isHwp = isLegacyHwpFile(record.file);
  record.cacheHit = false;
  record.cacheNeedsWrite = false;
  let cached = null;
  if (record.bankId && !force) {
    try {
      cached = await getCachedFileAnalysis(record.bankId, record.identity, record.ruleId);
    } catch {
      cached = null;
    }
  }
  const cachedAnalysis = hydrateBankAnalysis(cached?.analysis);
  if (!isHwp && cachedAnalysis) {
    const bytes = new Uint8Array(await record.file.arrayBuffer());
    record.bytes = bytes;
    record.sourceBytes = bytes;
    record.convertedFromHwp = false;
    record.analysis = cachedAnalysis;
    record.cacheHit = true;
    return;
  } else if (cachedAnalysis && cached.normalizedBytes) {
    record.bytes = new Uint8Array(cached.normalizedBytes);
    record.sourceBytes = null;
    record.convertedFromHwp = true;
    record.analysis = cachedAnalysis;
    record.cacheHit = true;
    return;
  }

  const normalized = await normalizeBankFile(record.file, {
    convertHwp: isHwp ? async (sourceBytes) => {
      await rhwpReady;
      const sourceDocument = new HwpDocument(sourceBytes);
      try {
        const convertedBytes = sourceDocument.exportHwpx();
        return await repairConvertedHwpxBinData(
          convertedBytes,
          (key) => sourceDocument.getSourceImageBytes(key),
        );
      } finally {
        sourceDocument.free?.();
      }
    } : null,
  });
  record.bytes = normalized.bytes;
  record.sourceBytes = normalized.sourceBytes;
  record.convertedFromHwp = normalized.convertedFromHwp;
  if (cachedAnalysis) {
    record.analysis = cachedAnalysis;
    record.cacheHit = true;
    record.cacheNeedsWrite = isHwp && !cached?.normalizedBytes;
  } else {
    record.analysis = await analyzeBankFileByRule(normalized.parserFile, record.ruleId);
    record.cacheNeedsWrite = Boolean(record.bankId);
  }
}

function finishProcessedRecord(record) {
  const detectedRuleId = detectBankRule(record.analysis);
  record.resolvedRuleId = record.selectedRuleId === AUTO_BANK_RULE_ID
    ? detectedRuleId
    : record.selectedRuleId;
  record.ruleId = record.resolvedRuleId || DEFAULT_BANK_RULE_ID;
  record.error = null;
  const issues = [];
  const questionCount = record.analysis?.questions?.length || 0;
  if (!questionCount) issues.push("문항을 찾지 못했습니다.");
  if (record.selectedRuleId === AUTO_BANK_RULE_ID && !detectedRuleId) {
    issues.push("처리 방식을 자동으로 확정하지 못했습니다.");
  }
  const declared = record.metadata.declaredQuestionCount;
  if (declared && declared !== questionCount) {
    const warning = `파일명의 ${declared}문제와 실제 ${questionCount}문항이 다릅니다.`;
    issues.push(warning);
    const warnings = record.analysis?.questions?.[0]?.warnings;
    if (warnings && !warnings.includes(warning)) warnings.push(warning);
  }
  record.processingMessage = issues.join(" ") || (
    record.selectedRuleId === AUTO_BANK_RULE_ID && record.resolvedRuleId
      ? `자동 감지: ${ruleLabel(record.resolvedRuleId)}`
      : ""
  );
  record.processingStatus = issues.length
    ? "needs-review"
    : (record.cacheHit ? "cached" : "complete");
  updateBankProfileFileSettings(record);
}

async function cacheProcessedRecord(record) {
  if (!record.bankId || !record.analysis || record.error || (!record.cacheNeedsWrite && record.cacheHit)) return;
  const analysis = serializeBankAnalysis(record.analysis);
  if (!analysis) return;
  try {
    await saveCachedFileAnalysis({
      bankId: record.bankId,
      identity: record.identity,
      ruleId: record.ruleId,
      analysis,
      normalizedBytes: record.convertedFromHwp ? record.bytes : null,
    });
    record.cacheNeedsWrite = false;
  } catch {
    // 캐시 저장 실패는 원본 분석과 시험지 생성을 막지 않는다.
  }
}

async function reanalyzeBankRecords(records, selectedRuleId) {
  if (bankReanalysisActive || !BANK_RULES.some((rule) => rule.id === selectedRuleId)) return 0;
  const targets = [...new Set(records)].filter((record) => state.files.includes(record));
  if (!targets.length) return 0;
  bankReanalysisActive = true;
  elements.applyBankRule.disabled = true;
  let failures = 0;
  try {
    for (let index = 0; index < targets.length; index += 1) {
      const record = targets[index];
      const previous = {
        selectedRuleId: record.selectedRuleId,
        resolvedRuleId: record.resolvedRuleId,
        ruleId: record.ruleId,
        analysis: record.analysis,
        bytes: record.bytes,
        sourceBytes: record.sourceBytes,
        convertedFromHwp: record.convertedFromHwp,
        cacheHit: record.cacheHit,
        cacheNeedsWrite: record.cacheNeedsWrite,
        processingStatus: record.processingStatus,
        processingMessage: record.processingMessage,
        error: record.error,
      };
      record.selectedRuleId = selectedRuleId;
      record.resolvedRuleId = selectedRuleId === AUTO_BANK_RULE_ID ? null : selectedRuleId;
      record.ruleId = record.resolvedRuleId || DEFAULT_BANK_RULE_ID;
      record.processingStatus = "loading";
      record.processingMessage = "";
      record.error = null;
      renderBankManager();
      setStatus(`${index + 1} / ${targets.length} · ${record.file.name} 재분석 중...`, "loading");
      try {
        await processBankRecord(record, { force: true });
        finishProcessedRecord(record);
        await cacheProcessedRecord(record);
      } catch (error) {
        Object.assign(record, previous);
        record.processingStatus = "error";
        record.processingMessage = `${error.message} 이전 분석 결과를 유지합니다.`;
        updateBankProfileFileSettings(record);
        failures += 1;
      }
      rebuildQuestionIndex();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    setStatus(
      failures ? `${targets.length}개 파일 재분석 완료 · 실패 ${failures}개` : `${targets.length}개 파일 재분석 완료`,
      failures ? "error" : "success",
    );
    return failures;
  } finally {
    bankReanalysisActive = false;
    renderBankManager();
  }
}

async function addBankFiles(rawFiles, { replace = false, folderMode = false } = {}) {
  const candidates = [...rawFiles].filter(isSupportedBankFile);
  if (!candidates.length) {
    setStatus("선택한 항목에서 HWP 또는 HWPX 파일을 찾지 못했습니다.", "error");
    return;
  }
  const folderProfile = folderMode ? await resolveFolderProfile(candidates) : null;
  if (folderMode && !folderProfile) return;
  if (replace) resetBank({ clearProject: false });
  if (folderProfile) {
    state.bankProfile = folderProfile;
    renderBankProfileSummary();
  }
  const ordered = replace ? sortBankFiles(candidates) : candidates;
  const existingIdentities = state.files.map((record) => record.identity);
  let nextCode = nextFileCode();
  const additions = [];
  ordered.forEach((file) => {
    const identity = projectFileIdentity(file);
    if (existingIdentities.some((existing) => sameFileIdentity(existing, identity))) return;
    const record = {
      code: nextCode,
      file,
      identity,
      metadata: parseBankFilename(file.name),
      analysis: null,
      questions: [],
      questionOverrides: {},
      bytes: null,
      sourceBytes: null,
      convertedFromHwp: false,
      error: null,
      lastPage: 0,
      bankId: folderProfile?.bankId || null,
      selectedRuleId: AUTO_BANK_RULE_ID,
      resolvedRuleId: null,
      ruleId: DEFAULT_BANK_RULE_ID,
      cacheHit: false,
      cacheNeedsWrite: false,
      processingStatus: "pending",
      processingMessage: "",
    };
    applyBankProfileSettings(record);
    const saved = projectRecordFor(record);
    if (saved) {
      record.metadata = { ...record.metadata, ...saved.metadata };
      record.questionOverrides = saved.questionOverrides || {};
      record.selectedRuleId = selectedBankRuleId(saved.selectedRuleId || record.selectedRuleId);
      record.resolvedRuleId = resolvedBankRuleId(saved.resolvedRuleId) || (
        record.selectedRuleId === AUTO_BANK_RULE_ID ? null : record.selectedRuleId
      );
      record.ruleId = record.resolvedRuleId || DEFAULT_BANK_RULE_ID;
    }
    state.files.push(record);
    additions.push(record);
    nextCode = String(Number(nextCode) + 1).padStart(2, "0");
    existingIdentities.push(identity);
  });
  if (!additions.length) {
    setStatus("이미 추가된 문제은행 파일입니다.");
    return;
  }
  elements.workspace.classList.remove("hidden");
  elements.generationBar.classList.remove("hidden");
  setBankControlsCompact(true);
  renderBankManager();
  let cacheHits = 0;
  for (let index = 0; index < additions.length; index += 1) {
    const record = additions[index];
    const isHwp = isLegacyHwpFile(record.file);
    setStatus(`${index + 1} / ${additions.length} · ${record.file.name} 캐시 확인 중...`, "loading");
    try {
      setStatus(`${index + 1} / ${additions.length} · ${record.file.name} ${isHwp ? "HWP 변환 또는 캐시 복원 중..." : "문항 구분 또는 캐시 복원 중..."}`, "loading");
      record.processingStatus = "loading";
      renderBankManager();
      await processBankRecord(record);
      finishProcessedRecord(record);
      await cacheProcessedRecord(record);
      if (record.cacheHit) cacheHits += 1;
    } catch (error) {
      record.error = error.message;
      record.processingStatus = "error";
      record.processingMessage = error.message;
      updateBankProfileFileSettings(record);
    }
    rebuildQuestionIndex();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  if (folderProfile) {
    const validKeys = state.files
      .filter((record) => record.bankId === folderProfile.bankId)
      .map((record) => fileAnalysisCacheKey(record.bankId, record.identity, record.ruleId));
    try {
      await pruneBankFileAnalyses(folderProfile.bankId, validKeys);
    } catch {
      // 오래된 캐시 정리에 실패해도 현재 작업은 유지한다.
    }
  }
  await applyPendingProjectSettings();
  const first = state.files.find((record) => record.analysis && !record.error);
  if (first && !state.currentFileCode) await activatePreviewFile(first.code);
  const failures = state.files.filter((record) => record.error).length;
  const converted = state.files.filter((record) => record.convertedFromHwp && !record.error).length;
  setStatus(`${state.files.length}개 파일 · ${state.questions.length}문항 구분 완료${cacheHits ? ` · 캐시 ${cacheHits}개` : ""}${converted ? ` · HWP 변환 ${converted}개` : ""}${failures ? ` · 실패 ${failures}개` : ""}`, failures ? "error" : "success");
}

async function filesFromEntry(entry, path = "") {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    Object.defineProperty(file, "_relativePath", { value: `${path}${file.name}`, configurable: true });
    return [file];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => filesFromEntry(child, `${path}${entry.name}/`)));
  return nested.flat();
}

async function filesFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []);
  return (await Promise.all(entries.map((entry) => filesFromEntry(entry)))).flat();
}

function matrixCellKey(unit, difficulty) {
  return `${unit || "*"}|${difficulty || "*"}`;
}

function currentUnits() {
  const map = new Map();
  state.questions.forEach((question) => {
    if (!map.has(question.unitKey)) map.set(question.unitKey, {
      key: question.unitKey,
      label: `${question.subject} · ${question.unitNumber ? `${question.unitNumber}. ` : ""}${question.unitName}`,
    });
  });
  return [...map.values()].sort((left, right) => left.label.localeCompare(right.label, "ko", { numeric: true }));
}

function renderQuickMatrix() {
  const units = currentUnits();
  if (!units.length) {
    elements.matrixWrap.replaceChildren();
    elements.quickGenerate.disabled = true;
    return;
  }
  const table = createElement("table", { className: "rule-matrix" });
  const header = createElement("thead");
  const headerRow = createElement("tr");
  headerRow.append(createElement("th", { text: "단원 / 난이도" }));
  [...DIFFICULTIES, null].forEach((difficulty) => headerRow.append(createElement("th", {
    text: difficulty || "난이도 랜덤",
    className: difficulty ? "" : "random-cell",
  })));
  header.append(headerRow);
  const body = createElement("tbody");
  [...units, { key: null, label: "단원 랜덤" }].forEach((unit) => {
    const row = createElement("tr");
    row.append(createElement("th", { text: unit.label, className: unit.key ? "" : "random-cell" }));
    [...DIFFICULTIES, null].forEach((difficulty) => {
      const cell = createElement("td", { className: !unit.key || !difficulty ? "random-cell" : "" });
      const key = matrixCellKey(unit.key, difficulty);
      const input = createElement("input", {
        attributes: {
          type: "text",
          "aria-label": `${unit.label} ${difficulty || "난이도 랜덤"}`,
          "data-unit-key": unit.key || "",
          "data-difficulty": difficulty || "",
        },
      });
      input.value = state.quick.cells[key] || "";
      input.addEventListener("input", () => {
        state.quick.cells[key] = input.value;
        scheduleQuickEstimate();
      });
      cell.append(input);
      row.append(cell);
    });
    body.append(row);
  });
  table.append(header, body);
  elements.matrixWrap.replaceChildren(table);
  scheduleQuickEstimate();
}

function quickRules() {
  const count = Number(elements.quickQuestionCount.value);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("시험지당 문항 수를 1~100 사이로 입력하세요.");
  const cells = Array.from(elements.matrixWrap.querySelectorAll("input[data-unit-key]")).map((input) => ({
    unitKey: input.dataset.unitKey || null,
    difficulty: input.dataset.difficulty || null,
    value: input.value,
  }));
  return compileSlotRules(cells, count);
}

function examCodes(exam) {
  return parseQuestionCodes(exam.codesText);
}

function collectUsedCodes() {
  const used = new Set();
  state.exams.forEach((exam) => examCodes(exam).forEach((code) => used.add(code)));
  return used;
}

function scheduleQuickEstimate() {
  window.clearTimeout(estimateTimer);
  estimateTimer = window.setTimeout(updateQuickEstimate, 120);
}

function updateQuickEstimate() {
  if (!state.questions.length) return;
  try {
    const rules = quickRules();
    const usedCodes = collectUsedCodes();
    const maximum = estimateMaximumExamSets({ questions: state.questions, rules, usedCodes, seed: elements.quickSeed.value || "estimate" });
    const requested = Number(elements.quickExamCount.value) || 0;
    elements.quickStatus.className = "quick-status";
    elements.quickStatus.textContent = `현재 ${state.questions.length - usedCodes.size}문항 사용 가능 · 중복 없는 시험지 최대 ${maximum}부`;
    elements.quickGenerate.disabled = maximum < 1 || requested < 1 || requested > maximum;
  } catch (error) {
    elements.quickStatus.className = "quick-status error";
    elements.quickStatus.textContent = error.message;
    elements.quickGenerate.disabled = true;
  }
}

function quickGenerate() {
  try {
    const rules = quickRules();
    const examCount = Number(elements.quickExamCount.value);
    const seed = elements.quickSeed.value.trim() || state.quick.seed;
    const exams = allocateExamSets({
      questions: state.questions,
      rules,
      examCount,
      usedCodes: collectUsedCodes(),
      seed,
    });
    exams.forEach((codes) => addExam(codes));
    state.quick.seed = seed;
    elements.quickStatus.className = "quick-status";
    elements.quickStatus.textContent = `${examCount}부를 시드 ${seed}로 추가했습니다.`;
    updateQuickEstimate();
  } catch (error) {
    elements.quickStatus.className = "quick-status error";
    elements.quickStatus.textContent = error.message;
  }
}

function addExam(codes = [], { title = "" } = {}) {
  const sequence = state.nextExamId++;
  state.exams.push({
    id: `exam-${sequence}`,
    title: title || `시험지 ${String(sequence).padStart(2, "0")}`,
    codesText: Array.isArray(codes) ? codes.join(" ") : String(codes || ""),
  });
  renderExamDrafts();
}

function renderExamDrafts() {
  if (!state.exams.length) {
    elements.examList.replaceChildren();
    validateExamDrafts();
    return;
  }
  const cards = state.exams.map((exam) => {
    const card = createElement("article", { className: "exam-card", attributes: { "data-exam-id": exam.id } });
    const header = createElement("div", { className: "exam-card-header" });
    const title = createElement("input", { attributes: { type: "text", "aria-label": "시험지 제목" } });
    title.value = exam.title;
    title.addEventListener("input", () => { exam.title = title.value; });
    const remove = createElement("button", { className: "remove-exam", text: "×", attributes: { type: "button", "aria-label": `${exam.title} 삭제` } });
    remove.addEventListener("click", () => {
      state.exams = state.exams.filter((item) => item.id !== exam.id);
      renderExamDrafts();
      updateQuickEstimate();
    });
    header.append(title, remove);
    const textarea = createElement("textarea", {
      attributes: {
        "aria-label": `${exam.title} 문항 코드`,
      },
    });
    textarea.value = exam.codesText;
    textarea.addEventListener("input", () => {
      exam.codesText = textarea.value;
      validateExamDrafts();
      scheduleQuickEstimate();
    });
    const validation = createElement("p", { className: "exam-validation", attributes: { "data-validation-for": exam.id } });
    card.append(header, textarea, validation);
    return card;
  });
  elements.examList.replaceChildren(...cards);
  validateExamDrafts();
}

function validateExamDrafts() {
  const known = new Set(state.questions.map((question) => question.code));
  const globallyUsed = new Map();
  let valid = Boolean(state.exams.length && state.questions.length);
  state.exams.forEach((exam, examIndex) => {
    const output = elements.examList.querySelector(`[data-validation-for="${exam.id}"]`);
    try {
      const codes = examCodes(exam);
      if (!codes.length) throw new Error("문항 코드를 한 개 이상 입력하세요.");
      const unknown = codes.filter((code) => !known.has(code));
      if (unknown.length) throw new Error(`없는 문항 코드: ${unknown.join(", ")}`);
      const reused = codes.filter((code) => globallyUsed.has(code));
      if (reused.length) throw new Error(`${reused.join(", ")} 문항이 다른 시험지와 중복됩니다.`);
      codes.forEach((code) => globallyUsed.set(code, examIndex));
      if (output) {
        output.className = "exam-validation";
        output.textContent = `${codes.length}문항 · ${codes.join(" → ")}`;
      }
    } catch (error) {
      valid = false;
      if (output) {
        output.className = "exam-validation error";
        output.textContent = error.message;
      }
    }
  });
  elements.buildExams.disabled = !valid;
  return valid;
}

function renderTemplateFields(fields) {
  templateState.fields = fields;
  templateState.values.clear();
  const controls = fields.map((field) => {
    const label = createElement("label", { className: "field-control" });
    const caption = createElement("span", { text: `${FIELD_LABELS[field.name] || field.name} · ${field.count}곳` });
    const input = createElement("input", { attributes: { type: field.name === "time" || QUESTION_COUNT_FIELDS.has(field.name) ? "number" : "text" } });
    const placeholder = /\{\{[^{}]+\}\}/.test(field.placeholder || "") ? "" : field.placeholder || "";
    input.value = placeholder;
    input.placeholder = field.name;
    templateState.values.set(field.name, placeholder);
    input.addEventListener("input", () => templateState.values.set(field.name, input.value));
    label.append(caption, input);
    return label;
  });
  elements.fieldGrid.replaceChildren(...controls);
  elements.templateFields.classList.toggle("hidden", !fields.length);
}

async function loadTemplate(file) {
  if (!file?.name.toLowerCase().endsWith(".hwpx")) {
    setBuildStatus("템플릿은 HWPX 파일만 사용할 수 있습니다.", "error");
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const [fields, slots, hasExplanationMarker] = await Promise.all([
      inspectTemplateFields(bytes),
      inspectTemplateSlots(bytes),
      inspectTemplateExplanationMarker(bytes),
    ]);
    templateState.bytes = bytes;
    templateState.filename = file.name;
    templateState.slots = slots;
    templateState.hasExplanationMarker = hasExplanationMarker;
    renderTemplateFields(fields);
    elements.templateFileName.textContent = file.name;
    setBuildStatus("템플릿 준비 완료.");
  } catch (error) {
    templateState.bytes = null;
    templateState.filename = "";
    templateState.slots = [];
    templateState.hasExplanationMarker = false;
    renderTemplateFields([]);
    elements.templateFileName.textContent = "기본 템플릿";
    setBuildStatus(`템플릿 분석 실패: ${error.message}`, "error");
  }
}

async function getDefaultTemplateBytes() {
  if (!templateState.defaultPromise) {
    templateState.defaultPromise = fetch(DEFAULT_TEMPLATE_URL).then(async (response) => {
      if (!response.ok) throw new Error("내장 빈 템플릿을 불러오지 못했습니다.");
      return new Uint8Array(await response.arrayBuffer());
    });
  }
  return templateState.defaultPromise;
}

function templateValuesFor(exam, questionCount) {
  const values = Object.fromEntries(templateState.values.entries());
  values.title = exam.title;
  values.test_questions_count = String(questionCount);
  values.quest_count = String(questionCount);
  return values;
}

function sanitizeFilename(value) {
  return String(value || "시험지").trim().replace(/[\\/:*?"<>|]+/g, "_") || "시험지";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function buildAllExams() {
  if (!validateExamDrafts()) return;
  const build = { cancelled: false };
  activeBuild = build;
  elements.buildExams.disabled = true;
  elements.cancelBuild.disabled = false;
  elements.cancelBuild.textContent = "취소";
  elements.cancelBuild.classList.remove("hidden");
  const outputs = [];
  try {
    const useDefaultTemplate = !templateState.bytes;
    const baseTemplate = templateState.bytes || await getDefaultTemplateBytes();
    ensureBuildActive(build);
    const outputType = elements.outputType.value;
    const transformMode = elements.questionFormat.value;
    const variants = outputType === "both" ? ["problem", "solution"] : [outputType];
    const questionByCode = new Map(state.questions.map((question) => [question.code, question]));
    for (let examIndex = 0; examIndex < state.exams.length; examIndex += 1) {
      const exam = state.exams[examIndex];
      const codes = examCodes(exam);
      const selectedQuestions = codes.map((code) => questionByCode.get(code));
      const preparedTemplate = await applyTemplateFieldValues(baseTemplate, templateValuesFor(exam, codes.length));
      ensureBuildActive(build);
      const sources = [...new Set(selectedQuestions.map((question) => question.fileCode))].map((code) => {
        const record = state.files.find((item) => item.code === code);
        return { id: code, bytes: record.bytes, questions: record.questions };
      });
      for (const variant of variants) {
        setBuildStatus(`${examIndex + 1}/${state.exams.length} · ${exam.title} ${variant === "problem" ? "문제지" : "해설지"} 생성 중...`);
        const hideEndnotes = variant === "problem";
        let bytes = await buildExamFromSourcesHwpx(
          sources,
          preparedTemplate,
          selectedQuestions,
          {
            hideEndnotes,
            transformMode,
            includeSolutions: false,
            useDefaultLayout: useDefaultTemplate,
          },
        );
        ensureBuildActive(build);
        bytes = await sanitizeHwpxWatermarks(bytes);
        ensureBuildActive(build);
        await validateGeneratedExamHwpx(bytes, {
          expectedQuestionCount: codes.length,
          expectedEndnoteCount: codes.length,
          expectedChoiceNumberCount: transformMode === "original" ? null : 0,
          expectedQuestionPageBreakCount: useDefaultTemplate ? Math.max(0, codes.length - 1) : null,
          expectedSolutionColumnCount: null,
          expectHiddenEndnotes: hideEndnotes,
          preserveOriginalContent: true,
        });
        ensureBuildActive(build);
        await rhwpReady;
        ensureBuildActive(build);
        const verification = new HwpDocument(bytes);
        const pages = verification.pageCount();
        verification.free?.();
        if (!pages) throw new Error(`${exam.title}에 표시할 페이지가 없습니다.`);
        const minimumDefaultPages = codes.length;
        if (useDefaultTemplate && pages < minimumDefaultPages) {
          throw new Error(
            `${exam.title}의 기본 배치는 최소 ${minimumDefaultPages}쪽이어야 하지만 ${pages}쪽입니다.`,
          );
        }
        outputs.push({
          bytes,
          filename: `${sanitizeFilename(exam.title)}_${variant === "problem" ? "문제" : "해설"}.hwpx`,
        });
      }
    }
    ensureBuildActive(build);
    if (outputs.length === 1) {
      downloadBlob(new Blob([outputs[0].bytes], { type: "application/vnd.hancom.hwpx" }), outputs[0].filename);
    } else {
      const zip = new JSZip();
      outputs.forEach((output) => zip.file(output.filename, output.bytes));
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      ensureBuildActive(build);
      downloadBlob(blob, `시험지_${outputs.length}개_${new Date().toISOString().slice(0, 10)}.zip`);
    }
    setBuildStatus(`${state.exams.length}부 · 결과 파일 ${outputs.length}개 검증 및 다운로드 완료`);
  } catch (error) {
    if (error instanceof BuildCancelledError) setBuildStatus(error.message);
    else setBuildStatus(`생성 실패: ${error.message}`, "error");
  } finally {
    if (activeBuild === build) activeBuild = null;
    elements.cancelBuild.classList.add("hidden");
    elements.cancelBuild.disabled = false;
    elements.cancelBuild.textContent = "취소";
    validateExamDrafts();
  }
}

function syncSettingsFromControls() {
  state.settings.outputType = elements.outputType.value;
  state.settings.questionFormat = elements.questionFormat.value;
}

function saveProject() {
  state.quick.questionCount = Number(elements.quickQuestionCount.value);
  state.quick.examCount = Number(elements.quickExamCount.value);
  state.quick.seed = elements.quickSeed.value;
  syncSettingsFromControls();
  const snapshot = createProjectSnapshot({
    files: state.files,
    quick: state.quick,
    exams: state.exams,
    settings: state.settings,
  });
  downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }), "hwpx-exam-project.json");
  setBuildStatus("문제 본문을 제외한 프로젝트 설정 JSON을 저장했습니다.");
}

async function applyPendingProjectSettings() {
  const project = state.pendingProject;
  if (!project) return;
  const reanalysisGroups = new Map();
  state.files.forEach((record) => {
    const saved = project.files.find((item) => sameFileIdentity(item.identity, record.identity));
    if (!saved) return;
    record.metadata = { ...record.metadata, ...saved.metadata };
    record.questionOverrides = saved.questionOverrides || {};
    if (saved.selectedRuleId) {
      const targetRuleId = selectedBankRuleId(saved.selectedRuleId);
      if (targetRuleId !== record.selectedRuleId) {
        if (!reanalysisGroups.has(targetRuleId)) reanalysisGroups.set(targetRuleId, []);
        reanalysisGroups.get(targetRuleId).push(record);
      }
    }
  });
  state.quick = { ...state.quick, ...(project.quick || {}), cells: project.quick?.cells || {} };
  state.exams = (project.exams || []).map((exam) => ({ ...exam }));
  state.nextExamId = Math.max(1, ...state.exams.map((exam) => Number(String(exam.id).replace(/\D/g, "")) + 1 || 1));
  state.settings = { ...state.settings, ...(project.settings || {}) };
  elements.quickQuestionCount.value = state.quick.questionCount;
  elements.quickExamCount.value = state.quick.examCount;
  elements.quickSeed.value = state.quick.seed;
  elements.outputType.value = state.settings.outputType;
  elements.questionFormat.value = state.settings.questionFormat;
  syncSettingsFromControls();
  rebuildQuestionIndex();
  renderExamDrafts();
  state.pendingProject = null;
  for (const [ruleId, records] of reanalysisGroups) {
    await reanalyzeBankRecords(records, ruleId);
  }
}

async function loadProject(file) {
  try {
    const project = validateProjectSnapshot(JSON.parse(await file.text()));
    state.pendingProject = project;
    if (state.files.length) await applyPendingProjectSettings();
    setStatus(state.files.length ? "설정 적용 완료." : "설정 불러오기 완료.", "success");
  } catch (error) {
    setStatus(`프로젝트 설정 실패: ${error.message}`, "error");
  }
}

function bindEvents() {
  elements.folderInput.addEventListener("change", async () => {
    const files = [...elements.folderInput.files];
    elements.folderInput.value = "";
    await addBankFiles(files, { replace: true, folderMode: true });
  });
  elements.filesInput.addEventListener("change", async () => {
    const files = [...elements.filesInput.files];
    elements.filesInput.value = "";
    await addBankFiles(files);
  });
  elements.resetBank.addEventListener("click", () => resetBank());
  elements.savedBanks.addEventListener("click", showSavedBanks);
  elements.renameBankProfile.addEventListener("click", renameActiveBankProfile);
  elements.cancelBankProfile.addEventListener("click", () => elements.bankProfileDialog.close("cancel"));
  elements.closeSavedBanks.addEventListener("click", () => elements.savedBanksDialog.close());
  elements.bankAttention.addEventListener("click", () => {
    elements.bankManager.open = true;
    window.requestAnimationFrame(() => {
      elements.bankFileRows.querySelector("tr.needs-attention")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  elements.selectAllBankFiles.addEventListener("change", () => {
    state.selectedBankFiles = elements.selectAllBankFiles.checked
      ? new Set(state.files.map((record) => record.code))
      : new Set();
    renderBankManager();
  });
  elements.clearBankSelection.addEventListener("click", () => {
    state.selectedBankFiles.clear();
    renderBankManager();
  });
  elements.applyBankRule.addEventListener("click", async () => {
    const targets = state.files.filter((record) => state.selectedBankFiles.has(record.code));
    const failures = await reanalyzeBankRecords(targets, elements.bulkBankRule.value);
    if (!failures) state.selectedBankFiles.clear();
    renderBankManager();
  });
  let dragDepth = 0;
  elements.bankDrop.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    elements.bankDrop.classList.add("is-dragging");
  });
  elements.bankDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  elements.bankDrop.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) elements.bankDrop.classList.remove("is-dragging");
  });
  elements.bankDrop.addEventListener("drop", async (event) => {
    event.preventDefault();
    dragDepth = 0;
    elements.bankDrop.classList.remove("is-dragging");
    const dropped = await filesFromDrop(event.dataTransfer);
    const folderMode = dropped.some((file) => String(file._relativePath || file.webkitRelativePath || "").includes("/"));
    await addBankFiles(dropped, { replace: state.files.length === 0, folderMode });
  });
  document.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
  });
  elements.previewFile.addEventListener("change", () => activatePreviewFile(elements.previewFile.value));
  elements.previousPage.addEventListener("click", () => renderPage(currentPage - 1));
  elements.nextPage.addEventListener("click", () => renderPage(currentPage + 1));
  elements.zoomFit.addEventListener("click", () => { state.zoom = "fit"; applyZoom(); });
  elements.zoomOut.addEventListener("click", () => {
    state.zoom = state.zoom === "fit" ? 0.75 : Math.max(0.35, state.zoom - 0.1);
    applyZoom();
  });
  elements.zoomIn.addEventListener("click", () => {
    state.zoom = state.zoom === "fit" ? 1 : Math.min(2, state.zoom + 0.1);
    applyZoom();
  });
  window.addEventListener("resize", () => { if (state.zoom === "fit") applyZoom(); });
  document.addEventListener("keydown", (event) => {
    if (!event.shiftKey && !event.ctrlKey) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowUp") switchPreviewFile(-1);
    if (event.key === "ArrowDown") switchPreviewFile(1);
    if (event.key === "ArrowLeft") renderPage(currentPage - 1);
    if (event.key === "ArrowRight") renderPage(currentPage + 1);
  });
  elements.toggleQuick.addEventListener("click", () => {
    const hidden = elements.quickBody.classList.toggle("hidden");
    elements.toggleQuick.textContent = hidden ? "펼치기" : "접기";
    elements.toggleQuick.setAttribute("aria-expanded", String(!hidden));
  });
  [elements.quickQuestionCount, elements.quickExamCount, elements.quickSeed].forEach((input) => input.addEventListener("input", () => {
    state.quick.questionCount = Number(elements.quickQuestionCount.value);
    state.quick.examCount = Number(elements.quickExamCount.value);
    state.quick.seed = elements.quickSeed.value;
    if (input === elements.quickQuestionCount) renderQuickMatrix();
    else scheduleQuickEstimate();
  }));
  elements.quickGenerate.addEventListener("click", quickGenerate);
  elements.addExam.addEventListener("click", () => addExam());
  elements.clearExams.addEventListener("click", () => {
    state.exams = [];
    renderExamDrafts();
    updateQuickEstimate();
  });
  elements.templateFile.addEventListener("change", () => {
    const [file] = elements.templateFile.files;
    if (file) loadTemplate(file);
    elements.templateFile.value = "";
  });
  elements.outputType.addEventListener("change", syncSettingsFromControls);
  elements.questionFormat.addEventListener("change", syncSettingsFromControls);
  elements.saveProject.addEventListener("click", saveProject);
  elements.projectFile.addEventListener("change", () => {
    const [file] = elements.projectFile.files;
    if (file) loadProject(file);
    elements.projectFile.value = "";
  });
  elements.buildExams.addEventListener("click", buildAllExams);
  elements.cancelBuild.addEventListener("click", cancelActiveBuild);
}

elements.quickSeed.value = state.quick.seed;
elements.outputType.value = state.settings.outputType;
elements.questionFormat.value = state.settings.questionFormat;
elements.savedBanks.disabled = !bankCacheAvailable();
syncSettingsFromControls();
bindEvents();
renderExamDrafts();
renderBankProfileSummary();

rhwpReady
  .then(() => {
    elements.status.dataset.rendererState = "ready";
    setStatus("");
  })
  .catch((error) => {
    elements.status.dataset.rendererState = "failed";
    setStatus(`렌더러 준비 실패: ${error.message}`, "error");
  });
