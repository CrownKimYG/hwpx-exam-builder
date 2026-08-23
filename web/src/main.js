import initRhwp, { HwpDocument } from "@rhwp/core";
import rhwpWasmUrl from "@rhwp/core/rhwp_bg.wasm?url";
import "./styles.css";
import { buildExamHwpx, parseHwpx, prepareHwpxForPreview } from "./parser.js";
import { applyTemplateFieldValues, inspectTemplateFields } from "./template-fields.js";

const elements = {
  file: document.querySelector("#hwpx-file"),
  templateFile: document.querySelector("#template-file"),
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
  selectedCount: document.querySelector("#selected-count"),
  selectAll: document.querySelector("#select-all"),
  clearSelection: document.querySelector("#clear-selection"),
  buildExam: document.querySelector("#build-exam"),
  buildStatus: document.querySelector("#build-status"),
  previousQuestion: document.querySelector("#previous-question"),
  nextQuestion: document.querySelector("#next-question"),
  questionPosition: document.querySelector("#question-position"),
  questionType: document.querySelector("#question-type"),
  questionLabel: document.querySelector("#question-label"),
  questionSelected: document.querySelector("#question-selected"),
  questionText: document.querySelector("#question-text"),
  problemEquationCount: document.querySelector("#problem-equation-count"),
  problemEquations: document.querySelector("#problem-equations"),
  answerValue: document.querySelector("#answer-value"),
  answerText: document.querySelector("#answer-text"),
  answerEquations: document.querySelector("#answer-equations"),
  explanationEquationCount: document.querySelector("#explanation-equation-count"),
  explanationText: document.querySelector("#explanation-text"),
  explanationEquations: document.querySelector("#explanation-equations"),
};

const FIELD_LABELS = {
  title: "시험지 제목",
  time: "시험 시간(분)",
  test_questions_count: "총 문항 수",
};

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
let currentQuestion = 0;
let templateBytes = null;
let templateFilename = "";
let templateFieldDefinitions = [];
const selectedQuestions = new Set();
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

function equationCard(equation, label) {
  const card = document.createElement("div");
  card.className = "equation-preview";
  try {
    const svg = documentViewer.renderEquationPreview(equation.normalizedScript, 1100, 0);
    card.appendChild(safeSvg(svg, label));
  } catch (error) {
    card.classList.add("equation-error");
    card.textContent = "수식 미리보기를 만들지 못했습니다.";
    card.title = error.message;
  }
  return card;
}

function renderEquationGroup(container, equations, label) {
  if (!equations.length) {
    const empty = document.createElement("p");
    empty.className = "equation-empty";
    empty.textContent = "수식 없음";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...equations.map((equation, index) => equationCard(equation, `${label} ${index + 1}`)));
}

function fieldValuesObject() {
  return Object.fromEntries(templateFieldValues.entries());
}

function syncQuestionCountField() {
  if (!templateFieldDefinitions.some((field) => field.name === "test_questions_count")) return;
  if (manuallyEditedFields.has("test_questions_count")) return;
  const value = String(selectedQuestions.size);
  templateFieldValues.set("test_questions_count", value);
  const input = elements.fieldGrid.querySelector('[data-field-name="test_questions_count"]');
  if (input) input.value = value;
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
    input.type = field.name === "time" || field.name === "test_questions_count" ? "number" : "text";
    input.dataset.fieldName = field.name;
    input.placeholder = field.placeholder || field.name;
    const initialValue = field.name === "test_questions_count" ? String(selectedQuestions.size) : "";
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

function updateSelection() {
  const count = selectedQuestions.size;
  elements.selectedCount.textContent = count;
  elements.buildExam.disabled = count === 0 || !analysisResult;
  if (analysisResult?.questions[currentQuestion]) {
    elements.questionSelected.checked = selectedQuestions.has(analysisResult.questions[currentQuestion].ordinal);
  }
  syncQuestionCountField();
}

function renderQuestion(index) {
  if (!analysisResult?.questions.length) return;
  currentQuestion = Math.max(0, Math.min(index, analysisResult.questions.length - 1));
  const question = analysisResult.questions[currentQuestion];
  elements.questionPosition.textContent = `${currentQuestion + 1} / ${analysisResult.questions.length}`;
  elements.previousQuestion.disabled = currentQuestion === 0;
  elements.nextQuestion.disabled = currentQuestion === analysisResult.questions.length - 1;
  elements.questionType.textContent = question.answerType === "multiple_choice" ? "5지선다형" : "단답식";
  elements.questionLabel.textContent = question.sourceLabel || `문항 ${question.ordinal}`;
  elements.questionText.textContent = question.questionText || "문항 본문은 원본 페이지에서 확인하세요.";
  elements.problemEquationCount.textContent = question.equations.problem.length;
  elements.answerValue.textContent = question.answerType === "multiple_choice" && question.answer
    ? `${["", "①", "②", "③", "④", "⑤"][question.answer] || question.answer}` : "";
  elements.answerText.textContent = question.answerText || (question.answer ? String(question.answer) : "정답 정보 없음");
  elements.explanationEquationCount.textContent = question.equations.explanation.length;
  elements.explanationText.textContent = question.explanationText || "해설 텍스트 없음";
  renderEquationGroup(elements.problemEquations, question.equations.problem, "문제 수식");
  renderEquationGroup(elements.answerEquations, question.equations.answer, "정답 수식");
  renderEquationGroup(elements.explanationEquations, question.equations.explanation, "해설 수식");
  updateSelection();
}

function moveQuestion(offset) {
  renderQuestion(currentQuestion + offset);
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

elements.file.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
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
    const multiple = analysis.questions.filter((question) => question.answerType === "multiple_choice").length;
    const short = analysis.questions.filter((question) => question.answerType === "short_answer").length;
    elements.total.textContent = analysis.questions.length;
    elements.multiple.textContent = multiple;
    elements.short.textContent = short;
    elements.pages.textContent = pageCount;
    analysisResult = analysis;
    sourceBytes = bytes;
    currentQuestion = 0;
    selectedQuestions.clear();
    elements.workspace.classList.remove("hidden");
    renderPage(0);
    renderQuestion(0);
    elements.buildStatus.textContent = "문항을 선택하고 시험지 템플릿을 지정하세요.";
    setStatus(`${file.name} · ${analysis.questions.length}문항 · ${pageCount}페이지 준비 완료`, "success");
  } catch (error) {
    documentViewer?.free?.();
    documentViewer = null;
    analysisResult = null;
    sourceBytes = null;
    pageCount = 0;
    setStatus(`분석 실패: ${error.message}`, "error");
  }
});

elements.templateFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    templateBytes = new Uint8Array(await file.arrayBuffer());
    templateFilename = file.name;
    const fields = await inspectTemplateFields(templateBytes);
    renderTemplateFields(fields);
    elements.templateFileName.textContent = `${file.name} · 누름틀 ${fields.reduce((sum, field) => sum + field.count, 0)}곳 · 필드 ${fields.length}종`;
    elements.buildStatus.textContent = fields.length
      ? `누름틀 ${fields.map((field) => field.name).join(", ")}를 찾았습니다.`
      : "누름틀(CLICK_HERE) 필드를 찾지 못했습니다.";
  } catch (error) {
    templateBytes = null;
    templateFilename = "";
    renderTemplateFields([]);
    elements.templateFileName.textContent = `템플릿 분석 실패: ${error.message}`;
  }
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
elements.previousQuestion.addEventListener("click", () => moveQuestion(-1));
elements.nextQuestion.addEventListener("click", () => moveQuestion(1));
elements.questionSelected.addEventListener("change", () => {
  const question = analysisResult?.questions[currentQuestion];
  if (!question) return;
  if (elements.questionSelected.checked) selectedQuestions.add(question.ordinal);
  else selectedQuestions.delete(question.ordinal);
  updateSelection();
});
elements.selectAll.addEventListener("click", () => {
  analysisResult?.questions.forEach((question) => selectedQuestions.add(question.ordinal));
  updateSelection();
});
elements.clearSelection.addEventListener("click", () => {
  selectedQuestions.clear();
  updateSelection();
});
elements.buildExam.addEventListener("click", async () => {
  if (!analysisResult || !sourceBytes || !selectedQuestions.size) return;
  elements.buildExam.disabled = true;
  elements.buildStatus.textContent = "선택 문항을 시험지로 배치하는 중입니다...";
  try {
    let bytes = await buildExamHwpx(sourceBytes, analysisResult.questions, [...selectedQuestions]);
    bytes = await applyTemplateFieldValues(bytes, fieldValuesObject());
    const verification = new HwpDocument(bytes);
    const generatedPages = verification.pageCount();
    verification.free?.();
    if (!generatedPages) throw new Error("생성된 시험지에 표시할 페이지가 없습니다.");
    const stem = analysisResult.filename.replace(/\.hwpx$/i, "");
    downloadBytes(bytes, `${stem}_선택${selectedQuestions.size}문항_시험지.hwpx`);
    elements.buildStatus.textContent = `${selectedQuestions.size}문항 · ${generatedPages}페이지 시험지를 다운로드했습니다.`;
  } catch (error) {
    elements.buildStatus.textContent = `시험지 생성 실패: ${error.message}`;
  } finally {
    updateSelection();
  }
});

document.addEventListener("keydown", (event) => {
  if (!analysisResult || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveQuestion(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveQuestion(1);
  }
});

rhwpReady
  .then(() => setStatus("렌더러 준비 완료. HWPX 파일을 선택하세요."))
  .catch((error) => setStatus(`렌더러 준비 실패: ${error.message}`, "error"));