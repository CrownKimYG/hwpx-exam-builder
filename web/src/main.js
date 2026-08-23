import initRhwp, { HwpDocument } from "@rhwp/core";
import rhwpWasmUrl from "@rhwp/core/rhwp_bg.wasm?url";
import "./styles.css";
import { parseHwpx, prepareHwpxForPreview } from "./parser.js";
import { applyTemplateFieldValues, inspectTemplateFields } from "./template-fields.js";
import {
  buildExamFromTemplateHwpx,
  inspectTemplateSlots,
  validateGeneratedExamHwpx,
} from "./template-builder.js";

const DEFAULT_TEMPLATE_URL = "./templates/basic-math-exam.hwpx";

const elements = {
  file: document.querySelector("#hwpx-file"),
  fileDrop: document.querySelector(".file-drop"),
  templateFile: document.querySelector("#template-file"),
  templateDrop: document.querySelector("#template-drop"),
  templateFileName: document.querySelector("#template-file-name"),
  templateFields: document.querySelector("#template-fields"),
  fieldGrid: document.querySelector("#field-grid"),
  downloadFilledTemplate: document.querySelector("#download-filled-template"),
  status: document.querySelector("#status"),
  workspace: document.querySelector("#workspace"),
  total: document.querySelector("#metric-total"),
  multiple: document.querySelector("#metric-multiple"),
  short: document.querySelector("#metric-short"),
  pages: document.querySelector("#metric-pages"),
  previous: document.querySelector("#previous-page"),
  next: document.querySelector("#next-page"),
  pageLabel: document.querySelector("#page-label"),
  pageStage: document.querySelector("#page-stage"),
  pageCanvas: document.querySelector("#page-canvas"),
  pageLoading: document.querySelector("#page-loading"),
  questionOrder: document.querySelector("#question-order"),
  clearOrder: document.querySelector("#clear-order"),
  selectedCount: document.querySelector("#selected-count"),
  buildExam: document.querySelector("#build-exam"),
  buildStatus: document.querySelector("#build-status"),
};

const FIELD_LABELS = {
  title: "시험지 제목",
  time: "시험 시간(분)",
  test_questions_count: "총 문항 수",
  quest_count: "총 문항 수",
};
const QUESTION_COUNT_FIELDS = new Set(["test_questions_count", "quest_count"]);

let measureContext = null;
let lastMeasuredFont = "";
globalThis.measureTextWidth = (font, text) => {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  if (font !== lastMeasuredFont) {
    measureContext.font = font;
    lastMeasuredFont = font;
  }
  return measureContext.measureText(text).width;
};

const rhwpReady = initRhwp({ module_or_path: rhwpWasmUrl });
let documentViewer = null;
let currentPage = 0;
let pageCount = 0;
let analysisResult = null;
let sourceBytes = null;
let sourceFilename = "";
let templateBytes = null;
let templateFilename = "";
let templateFieldDefinitions = [];
let templateSlotCount = 0;
let selectedOrdinals = [];
let defaultTemplatePromise = null;
const templateFieldValues = new Map();
const manuallyEditedFields = new Set();

function setStatus(message, state = "") {
  elements.status.className = `status ${state}`.trim();
  elements.status.textContent = message;
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

function renderPage(pageIndex) {
  if (!documentViewer || pageIndex < 0 || pageIndex >= pageCount) return;
  elements.pageLoading.classList.remove("hidden");
  elements.pageCanvas.classList.add("hidden");
  try {
    const svg = documentViewer.renderPageSvg(pageIndex);
    elements.pageCanvas.replaceChildren(safeSvg(svg, `HWPX 원본 ${pageIndex + 1}페이지`));
    currentPage = pageIndex;
    elements.pageLabel.textContent = `${currentPage + 1} / ${pageCount}`;
    elements.previous.disabled = currentPage === 0;
    elements.next.disabled = currentPage === pageCount - 1;
    elements.pageStage.scrollTo({ top: 0, behavior: "instant" });
    elements.pageCanvas.classList.remove("hidden");
  } catch (error) {
    elements.pageCanvas.replaceChildren();
    setStatus(`페이지 표시 실패: ${error.message}`, "error");
  } finally {
    elements.pageLoading.classList.add("hidden");
  }
}

function fieldValuesObject() {
  return Object.fromEntries(templateFieldValues.entries());
}

function syncQuestionCountField() {
  const value = String(selectedOrdinals.length);
  templateFieldDefinitions
    .filter((field) => QUESTION_COUNT_FIELDS.has(field.name))
    .forEach((field) => {
      if (manuallyEditedFields.has(field.name)) return;
      templateFieldValues.set(field.name, value);
      const input = elements.fieldGrid.querySelector(`[data-field-name="${field.name}"]`);
      if (input) input.value = value;
    });
}

function renderTemplateFields(fields) {
  templateFieldDefinitions = fields;
  templateFieldValues.clear();
  manuallyEditedFields.clear();
  const controls = fields.map((field) => {
    const label = document.createElement("label");
    label.className = "field-control";
    const caption = document.createElement("span");
    caption.textContent = `${FIELD_LABELS[field.name] || field.name} · ${field.count}곳`;
    const input = document.createElement("input");
    input.type = field.name === "time" || QUESTION_COUNT_FIELDS.has(field.name) ? "number" : "text";
    input.dataset.fieldName = field.name;
    input.placeholder = field.placeholder || field.name;
    const preservedValue = /\{\{[^{}]+\}\}/.test(field.placeholder || "") ? "" : field.placeholder || "";
    const initialValue = QUESTION_COUNT_FIELDS.has(field.name) ? String(selectedOrdinals.length) : preservedValue;
    input.value = initialValue;
    templateFieldValues.set(field.name, initialValue);
    input.addEventListener("input", () => {
      manuallyEditedFields.add(field.name);
      templateFieldValues.set(field.name, input.value);
    });
    label.append(caption, input);
    return label;
  });
  elements.fieldGrid.replaceChildren(...controls);
  elements.templateFields.classList.toggle("hidden", !fields.length);
  elements.downloadFilledTemplate.disabled = !fields.length || !templateBytes;
}

function parseQuestionOrder(value, { reportEmpty = false } = {}) {
  const trimmed = value.trim();
  if (!trimmed) {
    if (reportEmpty) throw new Error("문항 번호를 띄어쓰기로 입력하세요. 예: 4 1 5 6");
    return [];
  }
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  if (tokens.some((token) => !/^\d+$/.test(token))) {
    throw new Error("문항 번호는 숫자와 띄어쓰기만 사용하세요.");
  }
  const ordinals = tokens.map(Number);
  const maximum = analysisResult?.questions.length || 0;
  const invalid = ordinals.find((ordinal) => ordinal < 1 || ordinal > maximum);
  if (invalid != null) throw new Error(`${invalid}번 문항은 없습니다. 1부터 ${maximum}까지 입력하세요.`);
  const duplicate = ordinals.find((ordinal, index) => ordinals.indexOf(ordinal) !== index);
  if (duplicate != null) throw new Error(`${duplicate}번 문항이 중복 입력되었습니다.`);
  return ordinals;
}

function refreshOrder({ showError = false } = {}) {
  try {
    selectedOrdinals = analysisResult ? parseQuestionOrder(elements.questionOrder.value) : [];
    const exceedsSlots = Boolean(templateBytes && templateSlotCount > 0 && selectedOrdinals.length > templateSlotCount);
    const unusableTemplate = Boolean(templateBytes && templateSlotCount === 0);
    elements.selectedCount.textContent = selectedOrdinals.length;
    elements.buildExam.disabled = !analysisResult || selectedOrdinals.length === 0 || exceedsSlots || unusableTemplate;
    elements.questionOrder.setAttribute("aria-invalid", "false");
    syncQuestionCountField();
    if (exceedsSlots) {
      elements.buildStatus.textContent = `입력 문항 ${selectedOrdinals.length}개가 템플릿 문제 슬롯 ${templateSlotCount}개를 초과했습니다.`;
    } else if (showError) {
      elements.buildStatus.textContent = selectedOrdinals.length
        ? `${selectedOrdinals.join(" → ")} 순서로 ${selectedOrdinals.length}문항을 생성합니다.`
        : "";
    }
    return true;
  } catch (error) {
    selectedOrdinals = [];
    elements.selectedCount.textContent = "0";
    elements.buildExam.disabled = true;
    elements.questionOrder.setAttribute("aria-invalid", "true");
    if (showError || elements.questionOrder.value.trim()) elements.buildStatus.textContent = error.message;
    syncQuestionCountField();
    return false;
  }
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/vnd.hancom.hwpx" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ensureHwpxFile(file, label) {
  if (!file?.name.toLowerCase().endsWith(".hwpx")) throw new Error(`${label}은 HWPX 파일만 사용할 수 있습니다.`);
}

async function loadQuestionBank(file) {
  try {
    ensureHwpxFile(file, "문제은행");
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }
  setStatus("HWPX 문항을 분석하고 원본 페이지를 구성하는 중입니다...", "loading");
  elements.workspace.classList.add("hidden");
  elements.pageCanvas.replaceChildren();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const [analysis, previewBytes] = await Promise.all([parseHwpx(file), prepareHwpxForPreview(bytes), rhwpReady]);
    documentViewer?.free?.();
    documentViewer = new HwpDocument(previewBytes);
    pageCount = documentViewer.pageCount();
    if (!pageCount) throw new Error("렌더링할 페이지를 찾지 못했습니다.");
    elements.total.textContent = analysis.questions.length;
    elements.multiple.textContent = analysis.questions.filter((question) => question.answerType === "multiple_choice").length;
    elements.short.textContent = analysis.questions.filter((question) => question.answerType === "short_answer").length;
    elements.pages.textContent = pageCount;
    analysisResult = analysis;
    sourceBytes = bytes;
    sourceFilename = file.name;
    selectedOrdinals = [];
    elements.questionOrder.value = "";
    elements.workspace.classList.remove("hidden");
    renderPage(0);
    refreshOrder();
    elements.buildStatus.textContent = templateBytes
      ? `템플릿 문제 슬롯 ${templateSlotCount}개가 준비됐습니다. 문항 번호를 입력하세요.`
      : "문항 번호를 입력하면 내장 빈 2단 템플릿으로 생성합니다.";
    setStatus(`${file.name} · ${analysis.questions.length}문항 · ${pageCount}페이지 준비 완료`, "success");
    elements.questionOrder.focus();
  } catch (error) {
    documentViewer?.free?.();
    documentViewer = null;
    analysisResult = null;
    sourceBytes = null;
    sourceFilename = "";
    pageCount = 0;
    setStatus(`분석 실패: ${error.message}`, "error");
  }
}

async function loadTemplate(file) {
  try {
    ensureHwpxFile(file, "템플릿");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const [fields, slots] = await Promise.all([inspectTemplateFields(bytes), inspectTemplateSlots(bytes)]);
    if (!slots.length) throw new Error("#1, #2 형식의 문제 슬롯을 찾지 못했습니다.");
    templateBytes = bytes;
    templateFilename = file.name;
    templateSlotCount = slots.length;
    renderTemplateFields(fields);
    elements.templateFileName.textContent = `${file.name} · 문제 슬롯 ${templateSlotCount}개 · 누름틀 ${fields.reduce((sum, field) => sum + field.count, 0)}곳`;
    elements.buildStatus.textContent = templateSlotCount
      ? `#1~#${templateSlotCount} 문제 슬롯을 찾았습니다. 입력 순서대로 채웁니다.`
      : "이 템플릿에서 #1, #2 형식의 문제 슬롯을 찾지 못했습니다.";
    refreshOrder();
  } catch (error) {
    templateBytes = null;
    templateFilename = "";
    templateSlotCount = 0;
    renderTemplateFields([]);
    elements.templateFileName.textContent = `템플릿 분석 실패: ${error.message} · 내장 빈 템플릿을 사용합니다.`;
    refreshOrder();
  }
}

function bindDropZone(zone, input, loader) {
  let dragDepth = 0;
  input.addEventListener("change", () => {
    const [file] = input.files;
    if (file) loader(file);
    input.value = "";
  });
  zone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    zone.classList.add("is-dragging");
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  zone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) zone.classList.remove("is-dragging");
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    zone.classList.remove("is-dragging");
    const [file] = event.dataTransfer?.files || [];
    if (file) loader(file);
  });
}

async function getDefaultTemplateBytes() {
  if (!defaultTemplatePromise) {
    defaultTemplatePromise = fetch(DEFAULT_TEMPLATE_URL).then(async (response) => {
      if (!response.ok) throw new Error("내장 빈 템플릿을 불러오지 못했습니다.");
      return new Uint8Array(await response.arrayBuffer());
    });
  }
  return defaultTemplatePromise;
}

async function createExam() {
  if (!analysisResult || !sourceBytes || !refreshOrder({ showError: true })) return;
  try {
    selectedOrdinals = parseQuestionOrder(elements.questionOrder.value, { reportEmpty: true });
  } catch (error) {
    elements.buildStatus.textContent = error.message;
    return;
  }
  elements.buildExam.disabled = true;
  const usingCustomTemplate = Boolean(templateBytes);
  elements.buildStatus.textContent = usingCustomTemplate
    ? "입력 순서대로 템플릿 문제 슬롯에 문항과 미주를 붙여넣는 중입니다..."
    : "입력 순서대로 내장 빈 2단 템플릿에 문항과 미주를 붙여넣는 중입니다...";
  try {
    if (usingCustomTemplate && selectedOrdinals.length > templateSlotCount) {
      throw new Error(`입력 문항 ${selectedOrdinals.length}개가 템플릿 문제 슬롯 ${templateSlotCount}개를 초과했습니다.`);
    }
    const baseTemplate = usingCustomTemplate ? templateBytes : await getDefaultTemplateBytes();
    const preparedTemplate = usingCustomTemplate
      ? await applyTemplateFieldValues(baseTemplate, fieldValuesObject())
      : baseTemplate;
    const bytes = await buildExamFromTemplateHwpx(
      sourceBytes,
      preparedTemplate,
      analysisResult.questions,
      selectedOrdinals,
    );
    const validation = await validateGeneratedExamHwpx(bytes, {
      expectedQuestionCount: selectedOrdinals.length,
      expectedEndnoteCount: selectedOrdinals.length,
    });
    const verification = new HwpDocument(bytes);
    const generatedPages = verification.pageCount();
    verification.free?.();
    if (!generatedPages) throw new Error("생성된 시험지에 표시할 페이지가 없습니다.");
    const stem = (usingCustomTemplate ? templateFilename : sourceFilename).replace(/\.hwpx$/i, "") || "시험지";
    downloadBytes(bytes, `${stem}_선택${selectedOrdinals.length}문항.hwpx`);
    elements.buildStatus.textContent = `${selectedOrdinals.join(" → ")} 순서 · 미주 ${validation.endnoteCount}개 · ${generatedPages}페이지 검증 완료`;
  } catch (error) {
    elements.buildStatus.textContent = `시험지 생성 실패: ${error.message}`;
  } finally {
    refreshOrder();
  }
}

bindDropZone(elements.fileDrop, elements.file, loadQuestionBank);
bindDropZone(elements.templateDrop, elements.templateFile, loadTemplate);

document.addEventListener("dragover", (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
});

elements.downloadFilledTemplate.addEventListener("click", async () => {
  if (!templateBytes) return;
  elements.downloadFilledTemplate.disabled = true;
  try {
    const bytes = await applyTemplateFieldValues(templateBytes, fieldValuesObject());
    const stem = templateFilename.replace(/\.hwpx$/i, "");
    downloadBytes(bytes, `${stem}_누름틀입력.hwpx`);
    elements.buildStatus.textContent = "입력값을 실제 누름틀에 적용한 검증용 HWPX를 다운로드했습니다.";
  } catch (error) {
    elements.buildStatus.textContent = `누름틀 입력 실패: ${error.message}`;
  } finally {
    elements.downloadFilledTemplate.disabled = !templateBytes || !templateFieldDefinitions.length;
  }
});

elements.previous.addEventListener("click", () => renderPage(currentPage - 1));
elements.next.addEventListener("click", () => renderPage(currentPage + 1));
elements.questionOrder.addEventListener("input", () => refreshOrder({ showError: true }));
elements.questionOrder.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  createExam();
});
elements.clearOrder.addEventListener("click", () => {
  elements.questionOrder.value = "";
  refreshOrder();
  elements.buildStatus.textContent = "문항 번호를 입력하세요. 예: 4 1 5 6";
  elements.questionOrder.focus();
});
elements.buildExam.addEventListener("click", createExam);

rhwpReady
  .then(() => setStatus("렌더러 준비 완료. HWPX 파일을 놓거나 선택하세요."))
  .catch((error) => setStatus(`렌더러 준비 실패: ${error.message}`, "error"));
