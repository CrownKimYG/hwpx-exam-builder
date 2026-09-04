import initRhwp, { HwpDocument } from "@rhwp/core";
import rhwpWasmUrl from "@rhwp/core/rhwp_bg.wasm?url";
import JSZip from "jszip";
import "./styles.css";
import { parseHwpx, prepareHwpxForPreview, sanitizeHwpxWatermarks } from "./parser.js";
import { EBSI_KOREAN_PREPROCESS_MODE, prepareEbsiKoreanHwpx } from "./ebsi-korean-parser.js";
import { prepareSuteukShortEssayHwpx } from "./suteuk-short-essay-parser.js";
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
  parseBankFilename,
  parseQuestionCodes,
  projectFileIdentity,
  questionCode,
  sameFileIdentity,
  sortBankFiles,
  unitKey,
} from "./bank-model.js";
import {
  allocateExamSets,
  compileSlotRules,
  estimateMaximumExamSets,
} from "./quick-generator.js";
import {
  AUTO_BANK_RULE_ID,
  BANK_RULES,
  CONCRETE_BANK_RULES,
  DEFAULT_BANK_RULE_ID,
  EBSI_KOREAN_RULE_ID,
  SUTEUK_SHORT_ESSAY_RULE_ID,
  bankRuleRequiresPreprocessing,
  bankSubjectForRule,
  createBankProfile,
  detectBankRule,
  detectBankRuleFromFilenames,
  describeBankFolder,
  fileAnalysisCacheKey,
  findMatchingBankProfile,
  hydrateBankAnalysis,
  migrateBankProfile,
  preferHwpxDuplicates,
  profileFileSettingKey,
  serializeBankAnalysis,
  updateBankProfileForFolder,
} from "./bank-cache-model.js";
import {
  bankCacheAvailable,
  deleteBankProfile,
  getCachedFileAnalysis,
  listCachedFileAnalysisRecords,
  listBankProfiles,
  pruneBankFileAnalyses,
  requestPersistentBankCache,
  saveBankProfile,
  saveCachedFileAnalysis,
} from "./bank-cache.js";
import {
  createHandoffHwpx,
  finalizeHandoffHwpx,
  inspectHandoffHwpx,
} from "./handoff.js";
import {
  appendCompletelyBlankPageHwpx,
  insertCompletelyBlankPageBeforeEndnotesHwpx,
  removeEndnotesHwpx,
  renumberEndnotesHwpx,
} from "./hwpx-output.js";
import { collectSelectedBuildWarnings } from "./build-warnings.js";
import { numberedExamTitle } from "./exam-naming.js";

const DEFAULT_TEMPLATE_URL = "./templates/basic-math-exam.hwpx";
const FIELD_LABELS = {
  title: "시험지 제목",
  time: "시험 시간(분)",
  test_questions_count: "총 문항 수",
  quest_count: "총 문항 수",
};
const QUESTION_COUNT_FIELDS = new Set(["test_questions_count", "quest_count"]);

const elements = Object.fromEntries([
  "status", "workspace", "generation-bar", "upload-card", "upload-actions", "hero-bank-tools", "app-home", "folder-input", "files-input", "handoff-input", "bank-drop", "bank-home", "bank-home-rows", "bank-home-empty",
  "bank-title-separator", "bank-profile-summary", "active-bank-name", "bank-profile-dialog", "bank-profile-form",
  "bank-profile-dialog-title", "bank-profile-name", "bank-profile-rule", "bank-profile-summary-text", "bank-profile-error", "cancel-bank-profile",
  "metric-files", "metric-total", "metric-units", "metric-unclassified", "bank-attention", "bank-attention-text", "bank-manager",
  "bank-file-rows", "question-metadata",
  "preview-file", "previous-page", "next-page", "page-label", "page-stage", "page-canvas", "page-loading",
  "zoom-out", "zoom-fit", "zoom-in", "zoom-label", "toggle-quick", "quick-body", "quick-exam-name", "quick-question-count-label", "quick-question-count",
  "quick-exam-count", "quick-seed", "matrix-wrap", "quick-status", "quick-generate", "add-exam",
    "clear-exams", "exam-list", "template-file", "template-file-name", "output-type",
    "question-format", "show-subject-title", "save-handoff", "build-exams", "template-fields", "field-grid", "build-status", "cancel-build",
    "build-warning-dialog", "build-warning-list",
].map((id) => [id.replace(/-([a-z])/g, (_, character) => character.toUpperCase()), document.querySelector(`#${id}`)]));

const state = {
  files: [],
  questions: [],
  exams: [],
  quick: {
    examName: "시험지",
    questionCount: 8,
    examCount: 1,
    seed: `seed-${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "")}`,
    cells: {},
  },
  settings: { outputType: "problem", questionFormat: "original" },
  currentFileCode: null,
  zoom: "fit",
  nextExamId: 1,
  bankProfile: null,
  handoffExams: [],
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

function renderBankProfileSummary() {
  const profile = state.bankProfile;
  const hasFiles = state.files.length > 0;
  elements.bankTitleSeparator.classList.toggle("hidden", !hasFiles);
  elements.bankProfileSummary.classList.toggle("hidden", !hasFiles);
  elements.activeBankName.textContent = profile?.displayName || (hasFiles ? "추가한 파일" : "");
  const originalOnly = [EBSI_KOREAN_RULE_ID, SUTEUK_SHORT_ESSAY_RULE_ID].includes(profile?.ruleId);
  if (originalOnly) {
    elements.questionFormat.value = "original";
    state.settings.questionFormat = "original";
  }
  elements.questionFormat.disabled = originalOnly;
}

function setBankControlsCompact(compact) {
  if (compact) {
    elements.heroBankTools.prepend(elements.uploadActions);
    elements.heroBankTools.append(elements.status);
    elements.uploadCard.classList.add("hidden");
    return;
  }
  elements.bankDrop.insertBefore(elements.uploadActions, elements.folderInput);
  elements.uploadCard.append(elements.status);
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
  record.selectedRuleId = profile.ruleId;
  record.resolvedRuleId = profile.ruleId;
  record.ruleId = profile.ruleId;
}

function updateBankProfileFileSettings(record) {
  const profile = state.bankProfile;
  if (!profile || record.bankId !== profile.bankId) return;
  profile.fileSettings ||= {};
  profile.fileSettings[profileFileSettingKey(record.identity)] = {
    metadata: structuredClone(record.metadata),
    questionOverrides: structuredClone(record.questionOverrides || {}),
    selectedRuleId: profile.ruleId,
    resolvedRuleId: profile.ruleId,
  };
  queueBankProfileSave();
}

async function requestBankProfileDetails({ profile = null, descriptor, ruleId, title = "문제은행 저장" }) {
  const profiles = await listBankProfiles().catch(() => []);
  elements.bankProfileDialogTitle.textContent = title;
  elements.bankProfileName.value = profile?.displayName || descriptor.rootFolderName;
  elements.bankProfileRule.value = ruleId || profile?.ruleId || DEFAULT_BANK_RULE_ID;
  elements.bankProfileRule.disabled = Boolean(profile);
  elements.bankProfileSummaryText.dataset.fileCount = String(descriptor.fileCount || descriptor.manifest?.length || 0);
  elements.bankProfileSummaryText.textContent = `파일 ${elements.bankProfileSummaryText.dataset.fileCount}개 · ${ruleLabel(elements.bankProfileRule.value)}`;
  elements.bankProfileError.textContent = "";
  return new Promise((resolve) => {
    const onSubmit = (event) => {
      event.preventDefault();
      const displayName = elements.bankProfileName.value.trim() || descriptor.rootFolderName;
      const duplicate = profiles.find((saved) => (
        saved.bankId !== profile?.bankId && saved.displayName.normalize("NFC") === displayName.normalize("NFC")
      ));
      if (duplicate) {
        elements.bankProfileError.textContent = "같은 이름의 문제은행이 이미 있습니다.";
        elements.bankProfileName.focus();
        return;
      }
      elements.bankProfileDialog.close("confirm");
    };
    const onClose = () => {
      elements.bankProfileDialog.removeEventListener("close", onClose);
      elements.bankProfileForm.removeEventListener("submit", onSubmit);
      if (elements.bankProfileDialog.returnValue !== "confirm") {
        resolve(null);
        return;
      }
      resolve({
        displayName: elements.bankProfileName.value.trim() || descriptor.rootFolderName,
        ruleId: elements.bankProfileRule.value,
      });
    };
    elements.bankProfileForm.addEventListener("submit", onSubmit);
    elements.bankProfileDialog.addEventListener("close", onClose);
    elements.bankProfileDialog.returnValue = "";
    elements.bankProfileDialog.showModal();
    elements.bankProfileName.select();
  });
}

async function resolveFolderProfile(files) {
  const descriptor = describeBankFolder(files);
  if (!descriptor) return null;
  const detectedRuleId = detectBankRuleFromFilenames(files);
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
    if (profile.ruleId !== detectedRuleId) {
      throw new Error(`${profile.displayName}은 ${ruleLabel(profile.ruleId)} 문제은행입니다. 다른 처리 방식의 파일은 추가할 수 없습니다.`);
    }
  } else {
    const details = await requestBankProfileDetails({ descriptor, ruleId: detectedRuleId });
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
  const input = createElement("input", { attributes: { type: "text", maxlength: "80", "aria-label": "문제은행 이름" } });
  input.value = profile.displayName;
  elements.activeBankName.replaceWith(input);
  elements.activeBankName = input;
  input.select();
  let settled = false;
  const finish = async (save) => {
    if (settled) return;
    settled = true;
    const nextName = input.value.trim();
    if (save && nextName) {
      const profiles = await listBankProfiles().catch(() => []);
      if (profiles.some((saved) => saved.bankId !== profile.bankId && saved.displayName.normalize("NFC") === nextName.normalize("NFC"))) {
        setStatus("같은 이름의 문제은행이 이미 있습니다.", "error");
      } else {
        profile.displayName = nextName;
        await saveBankProfile(profile).catch((error) => setStatus(error.message, "error"));
      }
    }
    const button = createElement("button", { text: profile.displayName, attributes: { id: "active-bank-name", type: "button", "aria-label": "문제은행 이름 변경" } });
    input.replaceWith(button);
    elements.activeBankName = button;
    button.addEventListener("click", renameActiveBankProfile);
    await renderHomeBankList();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void finish(true); }
    if (event.key === "Escape") { event.preventDefault(); void finish(false); }
  });
  input.addEventListener("blur", () => { void finish(true); });
}

function summaryFromCachedRecords(profile, records) {
  const analyses = records.map((record) => hydrateBankAnalysis(record.analysis)).filter(Boolean);
  const questions = analyses.flatMap((analysis) => analysis.questions || []);
  const units = profile.ruleId === EBSI_KOREAN_RULE_ID
    ? new Set(questions.map((question) => question.lectureNumber).filter(Boolean))
    : new Set((profile.manifest || []).map((identity) => parseBankFilename(identity.name)).map(unitKey));
  return {
    files: profile.manifest?.length || records.length,
    questions: questions.length,
    units: units.size,
    unclassified: profile.ruleId === EBSI_KOREAN_RULE_ID
      ? 0
      : questions.filter((question) => (question.difficulty || "미분류") === "미분류").length,
  };
}

async function openCachedBankProfile(profile) {
  const preserveHandoff = state.handoffExams.length > 0;
  resetBank({ keepHome: true, preserveHandoff });
  state.bankProfile = migrateBankProfile(profile);
  const cached = await listCachedFileAnalysisRecords(profile.bankId);
  const newestByPath = new Map();
  cached.forEach((record) => newestByPath.set(record.identity.relativePath, record));
  state.files = [...newestByPath.values()].map((cachedRecord, index) => {
    const identity = cachedRecord.identity;
    const metadata = parseBankFilename(identity.name);
    const analysis = hydrateBankAnalysis(cachedRecord.analysis);
    const saved = state.bankProfile.fileSettings?.[profileFileSettingKey(identity)] || {};
    return {
      code: String(index + 1).padStart(2, "0"),
      file: { name: identity.name },
      identity,
      metadata: { ...metadata, ...(saved.metadata || {}) },
      analysis,
      questions: [],
      questionOverrides: { ...(saved.questionOverrides || {}) },
      bytes: null,
      sourceBytes: null,
      convertedFromHwp: false,
      preprocessedFromEbsi: state.bankProfile.ruleId === EBSI_KOREAN_RULE_ID,
      error: null,
      lastPage: 0,
      bankId: profile.bankId,
      selectedRuleId: state.bankProfile.ruleId,
      resolvedRuleId: state.bankProfile.ruleId,
      ruleId: state.bankProfile.ruleId,
      cacheHit: true,
      cacheNeedsWrite: false,
      processingStatus: analysis ? "cached" : "error",
      processingMessage: analysis ? "원본 폴더 연결 필요" : "분석 캐시 없음",
      needsReconnect: true,
    };
  });
  elements.bankHome.classList.add("hidden");
  elements.workspace.classList.remove("hidden");
  elements.generationBar.classList.remove("hidden");
  setBankControlsCompact(true);
  renderBankProfileSummary();
  rebuildQuestionIndex();
  applyHandoffExams();
  setStatus("원본 미리보기와 시험지 생성을 사용하려면 폴더를 연결하세요.");
}

async function renderHomeBankList() {
  if (!bankCacheAvailable()) return;
  const profiles = await listBankProfiles().catch(() => []);
  const rows = [];
  for (const profile of profiles) {
    const records = await listCachedFileAnalysisRecords(profile.bankId).catch(() => []);
    const summary = summaryFromCachedRecords(profile, records);
    const row = createElement("tr", { className: "bank-home-row" });
    const cells = [
      createElement("td", { className: "bank-home-name", text: profile.displayName }),
      createElement("td", { text: ruleLabel(profile.ruleId) }),
      createElement("td", { className: "bank-home-number", text: String(summary.files) }),
      createElement("td", { className: "bank-home-number", text: String(summary.questions) }),
      createElement("td", { className: "bank-home-number", text: String(summary.units) }),
      createElement("td", { className: "bank-home-number", text: String(summary.unclassified) }),
    ];
    const actionCell = createElement("td");
    const remove = createElement("button", { className: "bank-home-delete", text: "캐시 삭제", attributes: { type: "button" } });
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!window.confirm(`${profile.displayName}의 브라우저 캐시만 삭제할까요? 원본 파일은 삭제되지 않습니다.`)) return;
      await deleteBankProfile(profile.bankId);
      await renderHomeBankList();
    });
    actionCell.append(remove);
    row.append(...cells, actionCell);
    row.addEventListener("click", () => { void openCachedBankProfile(profile); });
    rows.push(row);
    if (profile.schemaVersion !== migrateBankProfile(profile).schemaVersion) void saveBankProfile(migrateBankProfile(profile));
  }
  elements.bankHomeRows.replaceChildren(...rows);
  elements.bankHomeEmpty.classList.toggle("hidden", rows.length > 0);
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

function updateBankAttention() {
  const count = state.files.filter(recordNeedsAttention).length;
  elements.bankAttention.classList.toggle("hidden", count === 0);
  elements.bankAttentionText.textContent = `처리 방식을 확인해야 하는 파일이 ${count}개 있습니다.`;
}

function renderBankManager() {
  const rows = state.files.map((record) => {
    const row = createElement("tr", { className: recordNeedsAttention(record) ? "needs-attention" : "" });
    row.dataset.fileCode = record.code;
    const codeCell = createElement("td", { text: record.code });
    const filenameCell = createElement("td", { className: "filename", text: record.file.name });
    filenameCell.title = record.file.name;
    if (record.convertedFromHwp) filenameCell.append(createElement("span", { className: "format-badge", text: "HWP → HWPX" }));
    const ruleCell = createElement("td", { text: ruleLabel(record.ruleId) });
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
    view.disabled = !record.bytes || !record.analysis || Boolean(record.error);
    view.addEventListener("click", () => activatePreviewFile(record.code));
    const reanalyze = createElement("button", { className: "icon-button", text: "재분석", attributes: { type: "button" } });
    reanalyze.disabled = !record.file?.arrayBuffer || record.needsReconnect || bankReanalysisActive || record.processingStatus === "loading";
    reanalyze.addEventListener("click", () => {
      void reanalyzeBankRecords([record], record.selectedRuleId || AUTO_BANK_RULE_ID);
    });
    const remove = createElement("button", { className: "icon-button", text: "삭제", attributes: { type: "button" } });
    remove.disabled = bankReanalysisActive;
    remove.addEventListener("click", () => removeBankRecord(record.code));
    actionCell.append(view, reanalyze, remove);
    row.append(codeCell, filenameCell, ruleCell, subjectCell, unitCell, countCell, statusCell, actionCell);
    return row;
  });
  elements.bankFileRows.replaceChildren(...rows);
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
    select.disabled = record.ruleId === EBSI_KOREAN_RULE_ID;
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
    record.questions = record.analysis.questions.map((question) => {
      const korean = record.ruleId === EBSI_KOREAN_RULE_ID;
      const metadata = korean && question.lectureNumber
        ? { subject: "국어", unitNumber: String(question.lectureNumber).padStart(2, "0"), unitName: `${question.lectureNumber}강` }
        : record.metadata;
      return {
        ...question,
        fileCode: record.code,
        code: questionCode(record.code, question.ordinal),
        subject: metadata.subject,
        unitNumber: metadata.unitNumber,
        unitName: metadata.unitName,
        unitKey: unitKey(metadata),
        difficulty: korean ? "미분류" : (record.questionOverrides[question.ordinal] || question.difficulty || "미분류"),
      };
    });
    return record.questions;
  });
  elements.metricFiles.textContent = state.files.length;
  elements.metricTotal.textContent = state.questions.length;
  elements.metricUnits.textContent = new Set(state.questions.map((question) => question.unitKey)).size;
  elements.metricUnclassified.textContent = state.bankProfile?.ruleId === EBSI_KOREAN_RULE_ID
    ? "0"
    : state.questions.filter((question) => question.difficulty === "미분류").length;
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

function resetBank({ keepHome = false, preserveHandoff = false } = {}) {
  previewRequest += 1;
  documentViewer?.free?.();
  documentViewer = null;
  state.files = [];
  state.questions = [];
  state.currentFileCode = null;
  state.bankProfile = null;
  state.exams = [];
  state.nextExamId = 1;
  if (!preserveHandoff) state.handoffExams = [];
  pageCount = 0;
  currentPage = 0;
  elements.pageCanvas.replaceChildren();
  elements.pageCanvas.classList.add("hidden");
  elements.pageLoading.textContent = "";
  elements.pageLoading.classList.remove("hidden");
  elements.pageLabel.textContent = "0 / 0";
  elements.previousPage.disabled = true;
  elements.nextPage.disabled = true;
  elements.workspace.classList.add("hidden");
  elements.generationBar.classList.add("hidden");
  elements.bankHome.classList.toggle("hidden", keepHome);
  setBankControlsCompact(false);
  renderBankProfileSummary();
  rebuildQuestionIndex();
  renderExamDrafts();
  setStatus("");
  if (!keepHome) void renderHomeBankList();
}

function removeBankRecord(code) {
  state.files = state.files.filter((record) => record.code !== code);
  if (state.currentFileCode === code) {
    state.currentFileCode = state.files.find((record) => record.analysis && !record.error)?.code || null;
    if (state.currentFileCode) activatePreviewFile(state.currentFileCode);
  }
  rebuildQuestionIndex();
}

async function analyzeBankFileByRule(file, ruleId) {
  if (ruleId === DEFAULT_BANK_RULE_ID) {
    return { analysis: await parseHwpx(file), bytes: null };
  }
  if (ruleId === EBSI_KOREAN_RULE_ID) return prepareEbsiKoreanHwpx(file);
  if (ruleId === SUTEUK_SHORT_ESSAY_RULE_ID) return prepareSuteukShortEssayHwpx(file);
  throw new Error(`${ruleLabel(ruleId)} 처리 방식은 아직 사용할 수 없습니다.`);
}

async function processBankRecord(record, { force = false } = {}) {
  const isHwp = isLegacyHwpFile(record.file);
  const analysisRuleId = record.selectedRuleId === AUTO_BANK_RULE_ID
    ? detectBankRuleFromFilenames([record.file])
    : record.ruleId;
  record.ruleId = analysisRuleId;
  record.cacheHit = false;
  record.cacheNeedsWrite = false;
  record.preprocessedFromEbsi = false;
  record.previewBytes = null;
  let cached = null;
  if (record.bankId && !force) {
    try {
      cached = await getCachedFileAnalysis(record.bankId, record.identity, analysisRuleId);
    } catch {
      cached = null;
    }
  }
  const cachedAnalysis = hydrateBankAnalysis(cached?.analysis);
  if (!isHwp && cachedAnalysis && analysisRuleId === DEFAULT_BANK_RULE_ID) {
    const bytes = new Uint8Array(await record.file.arrayBuffer());
    record.bytes = bytes;
    record.sourceBytes = bytes;
    record.convertedFromHwp = false;
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
  if (analysisRuleId === SUTEUK_SHORT_ESSAY_RULE_ID) record.previewBytes = normalized.bytes;
  // 복사 범위는 전처리한 문서에 속한다. 재연결 시에도 같은 전처리를 실행한다.
  if (cachedAnalysis && !bankRuleRequiresPreprocessing(analysisRuleId)) {
    record.analysis = cachedAnalysis;
    record.cacheHit = true;
    record.cacheNeedsWrite = false;
  } else {
    const analyzed = await analyzeBankFileByRule(normalized.parserFile, analysisRuleId);
    record.analysis = analyzed.analysis;
    if (analyzed.bytes) {
      record.bytes = analyzed.bytes;
      record.preprocessedFromEbsi = analysisRuleId === EBSI_KOREAN_RULE_ID;
    }
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
  const issues = [...(record.analysis?.warnings || [])];
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
      normalizedBytes: null,
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
        previewBytes: record.previewBytes,
        convertedFromHwp: record.convertedFromHwp,
        preprocessedFromEbsi: record.preprocessedFromEbsi,
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
  const candidates = preferHwpxDuplicates([...rawFiles].filter(isSupportedBankFile));
  if (!candidates.length) {
    setStatus("선택한 항목에서 HWP 또는 HWPX 파일을 찾지 못했습니다.", "error");
    return;
  }
  let folderProfile = null;
  const reconnectProfile = replace && state.bankProfile && state.files.some((record) => record.needsReconnect)
    ? state.bankProfile
    : null;
  try {
    const detectedRuleId = detectBankRuleFromFilenames(candidates);
    if (reconnectProfile) {
      if (reconnectProfile.ruleId !== detectedRuleId) {
        throw new Error(`${reconnectProfile.displayName}은 ${ruleLabel(reconnectProfile.ruleId)} 문제은행입니다.`);
      }
      const descriptor = describeBankFolder(candidates);
      const score = findMatchingBankProfile([reconnectProfile], descriptor);
      if (!score) throw new Error("선택한 폴더가 저장된 문제은행과 일치하지 않습니다.");
      folderProfile = updateBankProfileForFolder(reconnectProfile, descriptor);
      await saveBankProfile(folderProfile);
    } else if (state.bankProfile && !replace) {
      if (state.bankProfile.ruleId !== detectedRuleId) {
        throw new Error("처리 방식이 다른 파일은 기존 문제은행에 추가할 수 없습니다. 새 문제은행으로 등록하세요.");
      }
      const identities = [...state.bankProfile.manifest, ...candidates.map(projectFileIdentity)];
      folderProfile = {
        ...state.bankProfile,
        manifest: [...new Map(identities.map((identity) => [identity.relativePath, identity])).values()],
        updatedAt: new Date().toISOString(),
      };
      await saveBankProfile(folderProfile);
    } else {
      folderProfile = await resolveFolderProfile(candidates);
    }
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }
  if (!folderProfile) return;
  if (replace) resetBank({ keepHome: true, preserveHandoff: state.handoffExams.length > 0 });
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
      preprocessedFromEbsi: false,
      error: null,
      lastPage: 0,
      bankId: folderProfile.bankId,
      selectedRuleId: folderProfile.ruleId,
      resolvedRuleId: folderProfile.ruleId,
      ruleId: folderProfile.ruleId,
      cacheHit: false,
      cacheNeedsWrite: false,
      processingStatus: "pending",
      processingMessage: "",
      needsReconnect: false,
    };
    applyBankProfileSettings(record);
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
  elements.bankHome.classList.add("hidden");
  renderBankProfileSummary();
  applyHandoffExams();
  setBankControlsCompact(true);
  renderBankManager();
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
  const first = state.files.find((record) => record.analysis && !record.error);
  if (first && !state.currentFileCode) await activatePreviewFile(first.code);
  const failures = state.files.filter((record) => record.error).length;
  setStatus(failures ? `${failures}개 파일 처리 실패` : "", failures ? "error" : "");
  await renderHomeBankList();
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
  const korean = state.bankProfile?.ruleId === EBSI_KOREAN_RULE_ID;
  const difficulties = korean ? [null] : [...DIFFICULTIES, null];
  headerRow.append(createElement("th", { text: korean ? "강" : "단원 / 난이도" }));
  difficulties.forEach((difficulty) => headerRow.append(createElement("th", {
    text: korean ? "문항 수" : (difficulty || "난이도 랜덤"),
    className: difficulty ? "" : "random-cell",
  })));
  header.append(headerRow);
  const body = createElement("tbody");
  [...units, { key: null, label: "단원 랜덤" }].forEach((unit) => {
    const row = createElement("tr");
    row.append(createElement("th", { text: unit.label, className: unit.key ? "" : "random-cell" }));
    difficulties.forEach((difficulty) => {
      const cell = createElement("td", { className: !unit.key || !difficulty ? "random-cell" : "" });
      const key = matrixCellKey(unit.key, difficulty);
      const input = createElement("input", {
        attributes: {
          type: "text",
          "aria-label": `${unit.label} ${korean ? "문항 수" : (difficulty || "난이도 랜덤")}`,
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
    if (state.handoffExams.length) {
      if (exams.length !== state.exams.length) throw new Error("인계 시험지 개수와 빠른 출제 결과가 다릅니다.");
      exams.forEach((codes, index) => {
        state.exams[index].codesText = codes.join(" ");
        state.handoffExams[index].codesText = state.exams[index].codesText;
      });
      renderExamDrafts();
    } else {
      exams.forEach((codes) => addExam(codes, { baseName: elements.quickExamName.value }));
    }
    state.quick.seed = seed;
    elements.quickStatus.className = "quick-status";
    elements.quickStatus.textContent = `${examCount}부를 시드 ${seed}로 추가했습니다.`;
    updateQuickEstimate();
  } catch (error) {
    elements.quickStatus.className = "quick-status error";
    elements.quickStatus.textContent = error.message;
  }
}

function addExam(codes = [], { title = "", baseName = "시험지" } = {}) {
  if (state.handoffExams.length) return;
  const sequence = state.nextExamId++;
  state.exams.push({
    id: `exam-${sequence}`,
    title: title || numberedExamTitle(baseName, sequence),
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
    title.readOnly = Boolean(exam.locked);
    title.addEventListener("input", () => { exam.title = title.value; });
    const remove = createElement("button", { className: "remove-exam", text: "×", attributes: { type: "button", "aria-label": `${exam.title} 삭제` } });
    remove.classList.toggle("hidden", Boolean(exam.locked));
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
      const disconnected = [...new Set(codes.map((code) => code.split("-")[0]))]
        .filter((fileCode) => !state.files.find((record) => record.code === fileCode)?.bytes);
      if (disconnected.length) throw new Error("원본 폴더를 연결해야 생성할 수 있습니다.");
      const reused = codes.filter((code) => globallyUsed.has(code));
      if (reused.length) throw new Error(`${reused.join(", ")} 문항이 다른 시험지와 중복됩니다.`);
      codes.forEach((code) => globallyUsed.set(code, examIndex));
      if (output) {
        output.className = "exam-validation";
        output.textContent = exam.handoffMetadata
          ? `기존 ${exam.existingSubject} ${exam.existingQuestionCount}문항 + 추가 ${bankSubjectForRule(state.bankProfile?.ruleId)} ${codes.length}문항 = 총 ${exam.existingQuestionCount + codes.length}문항`
          : `${codes.length}문항 · ${codes.join(" → ")}`;
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
  elements.saveHandoff.disabled = !valid || state.handoffExams.length > 0;
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

function missingSubjectFor(metadata) {
  const included = new Set(metadata.includedSubjects.map((item) => item.subject));
  if (included.has("국어") && !included.has("수학")) return "수학";
  if (included.has("수학") && !included.has("국어")) return "국어";
  return "";
}

async function handoffEntriesFromFiles(files) {
  const entries = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.hwpx$/i.test(file.name)) {
      entries.push({ name: file.name, bytes });
      continue;
    }
    if (!/\.zip$/i.test(file.name)) continue;
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    for (const name of Object.keys(zip.files).filter((path) => /\.hwpx$/i.test(path) && !zip.files[path].dir)) {
      entries.push({ name: name.split("/").at(-1), bytes: await zip.file(name).async("uint8array") });
    }
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name, "ko", { numeric: true }));
}

function applyHandoffExams() {
  if (!state.handoffExams.length) {
    elements.quickQuestionCountLabel.textContent = "시험지당 문항 수";
    elements.quickExamCount.disabled = false;
    elements.templateFile.disabled = false;
    elements.addExam.disabled = false;
    elements.clearExams.disabled = false;
    elements.saveHandoff.disabled = !validateExamDrafts();
    return;
  }
  elements.quickQuestionCountLabel.textContent = "이번 과목에서 추가할 문항 수";
  const missingSubject = missingSubjectFor(state.handoffExams[0].metadata);
  const currentSubject = bankSubjectForRule(state.bankProfile?.ruleId);
  elements.quickExamCount.value = String(state.handoffExams.length);
  elements.quickExamCount.disabled = true;
  elements.templateFile.disabled = true;
  elements.addExam.disabled = true;
  elements.clearExams.disabled = true;
  elements.saveHandoff.disabled = true;
  if (!state.bankProfile) return;
  if (currentSubject !== missingSubject) {
    state.exams = [];
    setStatus(`${missingSubject} 문제은행을 선택해야 이어 만들 수 있습니다.`, "error");
    renderExamDrafts();
    return;
  }
  state.exams = state.handoffExams.map((handoff, index) => ({
    id: `handoff-${index + 1}`,
    title: handoff.metadata.title,
    codesText: handoff.codesText || "",
    locked: true,
    handoffBytes: handoff.bytes,
    handoffMetadata: handoff.metadata,
    existingSubject: handoff.metadata.includedSubjects[0].subject,
    existingQuestionCount: handoff.metadata.questionCount,
  }));
  state.nextExamId = state.exams.length + 1;
  renderExamDrafts();
  updateQuickEstimate();
}

function selectedBuildWarnings() {
  const questionByCode = new Map(state.questions.map((question) => [question.code, question]));
  const exams = state.exams.map((exam) => ({
    title: exam.title,
    codes: examCodes(exam),
  }));
  return collectSelectedBuildWarnings(exams, questionByCode, state.bankProfile?.ruleId);
}

function confirmBuildWarnings() {
  const warnings = selectedBuildWarnings();
  if (!warnings.length) return Promise.resolve(true);
  elements.buildWarningList.replaceChildren();
  warnings.forEach((record) => {
    const item = createElement("div", { className: "build-warning-item" });
    item.append(
      createElement("strong", { text: `${record.examTitle} · ${record.code}` }),
      createElement("span", { text: record.warnings.join(" · ") }),
    );
    elements.buildWarningList.append(item);
  });
  elements.buildWarningDialog.returnValue = "";
  elements.buildWarningDialog.showModal();
  return new Promise((resolve) => {
    elements.buildWarningDialog.addEventListener("close", () => {
      resolve(elements.buildWarningDialog.returnValue === "confirm");
    }, { once: true });
  });
}

async function loadHandoffFiles(files) {
  try {
    const entries = await handoffEntriesFromFiles(files);
    if (!entries.length) throw new Error("인계용 HWPX를 찾지 못했습니다.");
    const inspected = [];
    for (const entry of entries) {
      inspected.push({ ...entry, metadata: await inspectHandoffHwpx(entry.bytes) });
    }
    const missingSubjects = new Set(inspected.map((entry) => missingSubjectFor(entry.metadata)));
    if (missingSubjects.size !== 1 || ![...missingSubjects][0]) {
      throw new Error("한 번에 불러오는 인계 파일은 같은 과목을 추가해야 합니다.");
    }
    state.handoffExams = inspected;
    state.exams = [];
    applyHandoffExams();
    const missingSubject = [...missingSubjects][0];
    if (!state.bankProfile) {
      setStatus(`인계 파일 ${inspected.length}개를 불러왔습니다. ${missingSubject} 문제은행을 선택하세요.`, "success");
    }
  } catch (error) {
    state.handoffExams = [];
    setStatus(`인계 파일 불러오기 실패: ${error.message}`, "error");
  }
}

async function pageCountFor(bytes) {
  await rhwpReady;
  const documentNode = new HwpDocument(bytes);
  try {
    return documentNode.pageCount();
  } finally {
    documentNode.free?.();
  }
}

function selectedSources(selectedQuestions) {
  return [...new Set(selectedQuestions.map((question) => question.fileCode))].map((code) => {
    const record = state.files.find((item) => item.code === code);
    if (!record?.bytes) throw new Error(`${code} 원본 파일을 다시 연결해야 합니다.`);
    return { id: code, bytes: record.bytes, questions: record.questions };
  });
}

async function assembleExamVariant({ exam, selectedQuestions, variant, transformMode, build }) {
  const existingCount = exam.existingQuestionCount || 0;
  const totalCount = existingCount + selectedQuestions.length;
  const useHandoffTemplate = Boolean(exam.handoffBytes);
  const useDefaultTemplate = !useHandoffTemplate && !templateState.bytes;
  const baseTemplate = exam.handoffBytes || templateState.bytes || await getDefaultTemplateBytes();
  const preparedTemplate = await applyTemplateFieldValues(baseTemplate, templateValuesFor(exam, totalCount));
  ensureBuildActive(build);
  let bytes = await buildExamFromSourcesHwpx(
    selectedSources(selectedQuestions),
    preparedTemplate,
    selectedQuestions,
    {
      hideEndnotes: variant === "problem",
      transformMode,
      includeSolutions: variant === "solution",
      useDefaultLayout: useDefaultTemplate || useHandoffTemplate,
      questionNumberStart: existingCount + 1,
      forceFirstPageBreak: useHandoffTemplate,
      subjectTitle: elements.showSubjectTitle.checked ? bankSubjectForRule(state.bankProfile?.ruleId) : "",
    },
  );
  ensureBuildActive(build);
  bytes = await renumberEndnotesHwpx(bytes);
  if (state.bankProfile?.ruleId === DEFAULT_BANK_RULE_ID) bytes = await sanitizeHwpxWatermarks(bytes);
  ensureBuildActive(build);
  return bytes;
}

function renderedPageIsBlank(svg) {
  const documentNode = new DOMParser().parseFromString(svg, "image/svg+xml");
  const hasText = Array.from(documentNode.querySelectorAll("text"))
    .some((node) => String(node.textContent || "").replace(/\s+/g, ""));
  return !hasText && !documentNode.querySelector("image");
}

async function verifyExamVariant(bytes, {
  exam,
  selectedQuestions,
  variant,
  transformMode,
  expectedBlankPageIndex = null,
}) {
  const totalCount = (exam.existingQuestionCount || 0) + selectedQuestions.length;
  await validateGeneratedExamHwpx(bytes, {
    expectedQuestionCount: totalCount,
    expectedEndnoteCount: totalCount,
    expectedChoiceNumberCount: transformMode === "original" ? null : 0,
    expectedQuestionPageBreakCount: null,
    expectedSolutionColumnCount: null,
    expectHiddenEndnotes: variant === "problem",
    expectHiddenEndnoteMarkers: state.bankProfile?.ruleId !== SUTEUK_SHORT_ESSAY_RULE_ID,
    preserveOriginalContent: true,
  });
  await rhwpReady;
  const documentNode = new HwpDocument(bytes);
  try {
    const pages = documentNode.pageCount();
    if (!pages) throw new Error(`${exam.title}에 표시할 페이지가 없습니다.`);
    if (expectedBlankPageIndex !== null) {
      if (expectedBlankPageIndex >= pages || !renderedPageIsBlank(documentNode.renderPageSvg(expectedBlankPageIndex))) {
        throw new Error(`${exam.title}의 문제와 해설 사이에 완전한 빈 페이지를 만들지 못했습니다.`);
      }
    }
    return pages;
  } finally {
    documentNode.free?.();
  }
}

async function saveHandoffExams() {
  if (!validateExamDrafts() || state.handoffExams.length) return;
  if (!await confirmBuildWarnings()) return;
  const build = { cancelled: false };
  activeBuild = build;
  elements.saveHandoff.disabled = true;
  elements.buildExams.disabled = true;
  elements.cancelBuild.disabled = false;
  elements.cancelBuild.textContent = "취소";
  elements.cancelBuild.classList.remove("hidden");
  const outputs = [];
  try {
    const questionByCode = new Map(state.questions.map((question) => [question.code, question]));
    const subject = bankSubjectForRule(state.bankProfile?.ruleId);
    for (let index = 0; index < state.exams.length; index += 1) {
      const exam = state.exams[index];
      const selectedQuestions = examCodes(exam).map((code) => questionByCode.get(code));
      setBuildStatus(`${index + 1}/${state.exams.length} · ${exam.title} 인계 파일 생성 중...`);
      let bytes = await assembleExamVariant({
        exam,
        selectedQuestions,
        variant: "solution",
        transformMode: elements.questionFormat.value,
        build,
      });
      bytes = await createHandoffHwpx(bytes, {
        title: exam.title,
        includedSubjects: [{ subject, questionCount: selectedQuestions.length }],
        questionCount: selectedQuestions.length,
      });
      await inspectHandoffHwpx(bytes);
      outputs.push({ bytes, filename: `${sanitizeFilename(exam.title)}_${subject}_인계.hwpx` });
    }
    ensureBuildActive(build);
    if (outputs.length === 1) {
      downloadBlob(new Blob([outputs[0].bytes], { type: "application/vnd.hancom.hwpx" }), outputs[0].filename);
    } else {
      const zip = new JSZip();
      outputs.forEach((output) => zip.file(output.filename, output.bytes));
      downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `시험지_${outputs.length}개_인계.zip`);
    }
    setBuildStatus(`${outputs.length}개 인계 파일 생성 완료`);
  } catch (error) {
    if (error instanceof BuildCancelledError) setBuildStatus(error.message);
    else setBuildStatus(`인계 파일 생성 실패: ${error.message}`, "error");
  } finally {
    if (activeBuild === build) activeBuild = null;
    elements.cancelBuild.classList.add("hidden");
    validateExamDrafts();
  }
}

async function buildAllExams() {
  if (!validateExamDrafts()) return;
  if (!await confirmBuildWarnings()) return;
  const build = { cancelled: false };
  activeBuild = build;
  elements.buildExams.disabled = true;
  elements.saveHandoff.disabled = true;
  elements.cancelBuild.disabled = false;
  elements.cancelBuild.textContent = "취소";
  elements.cancelBuild.classList.remove("hidden");
  const outputs = [];
  try {
    const outputType = elements.outputType.value;
    const transformMode = elements.questionFormat.value;
    const variants = outputType === "both" ? ["problem", "solution"] : [outputType];
    const questionByCode = new Map(state.questions.map((question) => [question.code, question]));
    for (let examIndex = 0; examIndex < state.exams.length; examIndex += 1) {
      const exam = state.exams[examIndex];
      const selectedQuestions = examCodes(exam).map((code) => questionByCode.get(code));
      setBuildStatus(`${examIndex + 1}/${state.exams.length} · ${exam.title} 문제 영역 확인 중...`);
      let problemBytes = await assembleExamVariant({ exam, selectedQuestions, variant: "problem", transformMode, build });
      const problemOutputPages = await pageCountFor(problemBytes);
      const problemContentPages = await pageCountFor(await removeEndnotesHwpx(problemBytes));
      const problemOutputNeedsBlankPage = problemOutputPages % 2 === 1;
      const solutionNeedsBlankPage = problemContentPages % 2 === 1;
      if (problemOutputNeedsBlankPage) problemBytes = await appendCompletelyBlankPageHwpx(problemBytes);
      for (const variant of variants) {
        setBuildStatus(`${examIndex + 1}/${state.exams.length} · ${exam.title} ${variant === "problem" ? "문제지" : "해설 포함"} 생성 중...`);
        let bytes = variant === "problem"
          ? problemBytes
          : await assembleExamVariant({ exam, selectedQuestions, variant, transformMode, build });
        if (variant !== "problem" && solutionNeedsBlankPage) {
          bytes = await insertCompletelyBlankPageBeforeEndnotesHwpx(bytes);
        }
        bytes = await finalizeHandoffHwpx(bytes);
        ensureBuildActive(build);
        await verifyExamVariant(bytes, {
          exam,
          selectedQuestions,
          variant,
          transformMode,
          expectedBlankPageIndex: variant !== "problem" && solutionNeedsBlankPage ? problemContentPages : null,
        });
        outputs.push({
          bytes,
          filename: `${sanitizeFilename(exam.title)}_${variant === "problem" ? "문제" : (outputType === "solution" ? "해설포함" : "해설")}.hwpx`,
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
      downloadBlob(blob, `시험지_${state.exams.length}개_${new Date().toISOString().slice(0, 10)}.zip`);
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

function bindEvents() {
  elements.folderInput.addEventListener("change", async () => {
    const files = [...elements.folderInput.files];
    elements.folderInput.value = "";
    await addBankFiles(files, { replace: true, folderMode: true });
  });
  elements.filesInput.addEventListener("change", async () => {
    const files = [...elements.filesInput.files];
    elements.filesInput.value = "";
    await addBankFiles(files, { replace: state.files.some((record) => record.needsReconnect) });
  });
  elements.handoffInput.addEventListener("change", async () => {
    const files = [...elements.handoffInput.files];
    elements.handoffInput.value = "";
    await loadHandoffFiles(files);
  });
  elements.appHome.addEventListener("click", () => {
    resetBank();
  });
  elements.activeBankName.addEventListener("click", renameActiveBankProfile);
  elements.cancelBankProfile.addEventListener("click", () => elements.bankProfileDialog.close("cancel"));
  elements.bankProfileRule.addEventListener("change", () => {
    elements.bankProfileSummaryText.textContent = `파일 ${elements.bankProfileSummaryText.dataset.fileCount || 0}개 · ${ruleLabel(elements.bankProfileRule.value)}`;
  });
  elements.bankAttention.addEventListener("click", () => {
    elements.bankManager.open = true;
    window.requestAnimationFrame(() => {
      elements.bankFileRows.querySelector("tr.needs-attention")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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
  [elements.quickExamName, elements.quickQuestionCount, elements.quickExamCount, elements.quickSeed].forEach((input) => input.addEventListener("input", () => {
    state.quick.examName = elements.quickExamName.value;
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
  elements.saveHandoff.addEventListener("click", saveHandoffExams);
  elements.buildExams.addEventListener("click", buildAllExams);
  elements.cancelBuild.addEventListener("click", cancelActiveBuild);
}

elements.bankProfileRule.replaceChildren(...CONCRETE_BANK_RULES.map((rule) => (
  createElement("option", { text: rule.label, attributes: { value: rule.id } })
)));
elements.quickSeed.value = state.quick.seed;
elements.quickExamName.value = state.quick.examName;
elements.outputType.value = state.settings.outputType;
elements.questionFormat.value = state.settings.questionFormat;
syncSettingsFromControls();
bindEvents();
renderExamDrafts();
renderBankProfileSummary();
void renderHomeBankList();

rhwpReady
  .then(() => {
    elements.status.dataset.rendererState = "ready";
    setStatus("");
  })
  .catch((error) => {
    elements.status.dataset.rendererState = "failed";
    setStatus(`렌더러 준비 실패: ${error.message}`, "error");
  });
