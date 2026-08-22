import "./styles.css";
import { equationScript, parseHwpx } from "./parser.js";
import { renderEquation } from "./math.js";

const elements = {
  file: document.querySelector("#hwpx-file"),
  status: document.querySelector("#status"),
  workspace: document.querySelector("#workspace"),
  select: document.querySelector("#question-select"),
  total: document.querySelector("#metric-total"),
  multiple: document.querySelector("#metric-multiple"),
  short: document.querySelector("#metric-short"),
  warning: document.querySelector("#metric-warning"),
  kind: document.querySelector("#question-kind"),
  label: document.querySelector("#question-label"),
  answer: document.querySelector("#answer-pill"),
  content: document.querySelector("#question-content"),
  choices: document.querySelector("#choice-list"),
  explanation: document.querySelector("#explanation-content"),
  warnings: document.querySelector("#warning-list"),
  renderedPanel: document.querySelector("#panel-rendered"),
  codePanel: document.querySelector("#panel-code"),
  codeTitle: document.querySelector("#code-title"),
  code: document.querySelector("#xml-code"),
  copy: document.querySelector("#copy-xml"),
};

let result = null;
let activeTab = "rendered";

function renderRich(nodes, target) {
  target.replaceChildren();
  nodes.forEach((root) => {
    const paragraph = document.createElement("p");
    function visit(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const name = node.localName;
      if (name === "endNote") return;
      if (name === "t") {
        const text = node.textContent || "";
        if (text.trim().toLowerCase() !== "zb") paragraph.append(document.createTextNode(text));
        return;
      }
      if (name === "equation") {
        const math = document.createElement("span");
        if (renderEquation(equationScript(node), math)) paragraph.append(math);
        return;
      }
      if (name === "lineBreak") paragraph.append(document.createElement("br"));
      Array.from(node.children).forEach(visit);
    }
    visit(root);
    if (paragraph.textContent.trim() || paragraph.querySelector(".math-expression")) target.append(paragraph);
  });
}

function currentQuestion() {
  return result?.questions[Number(elements.select.value) || 0];
}

function renderQuestion() {
  const question = currentQuestion();
  if (!question) return;
  elements.kind.textContent = question.answerType === "multiple_choice" ? "5지선다형" : "단답식";
  elements.label.textContent = `${String(question.ordinal).padStart(2, "0")}. ${question.sourceLabel}`;
  elements.answer.textContent = `정답 ${question.answer ?? "확인 필요"}`;
  renderRich(question.questionElements, elements.content);
  elements.choices.replaceChildren();
  question.choices.forEach((fragments) => {
    const item = document.createElement("li");
    renderRich(fragments, item);
    elements.choices.append(item);
  });
  renderRich(question.explanationElements, elements.explanation);
  elements.warnings.replaceChildren();
  question.warnings.forEach((warning) => {
    const item = document.createElement("p");
    item.textContent = warning;
    elements.warnings.append(item);
  });
  renderActiveTab();
}

function renderActiveTab() {
  const question = currentQuestion();
  const isRendered = activeTab === "rendered";
  elements.renderedPanel.classList.toggle("hidden", !isRendered);
  elements.codePanel.classList.toggle("hidden", isRendered);
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === activeTab));
  if (isRendered || !question) return;
  const map = {
    body: ["문제 영역 XML", question.bodyXml],
    answer: ["정답 미주 XML", question.answerXml],
    explanation: ["해설 미주 XML", question.explanationXml],
    full: ["전체 QuestionBlock XML", question.fullXml],
  };
  const [title, xml] = map[activeTab];
  elements.codeTitle.textContent = title;
  elements.code.textContent = xml;
}

elements.file.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  elements.status.className = "status loading";
  elements.status.textContent = "HWPX의 문항 영역과 미주를 분석하는 중입니다...";
  elements.workspace.classList.add("hidden");
  try {
    result = await parseHwpx(file);
    const multiple = result.questions.filter((q) => q.answerType === "multiple_choice").length;
    const short = result.questions.filter((q) => q.answerType === "short_answer").length;
    const warning = result.questions.reduce((sum, q) => sum + q.warnings.length, 0);
    elements.total.textContent = result.questions.length;
    elements.multiple.textContent = multiple;
    elements.short.textContent = short;
    elements.warning.textContent = warning;
    elements.select.replaceChildren();
    result.questions.forEach((question, index) => {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = `${String(question.ordinal).padStart(2, "0")}. ${question.sourceLabel} · ${question.answerType === "multiple_choice" ? "객관식" : "단답식"} · 정답 ${question.answer ?? "확인 필요"}`;
      elements.select.append(option);
    });
    elements.status.className = "status success";
    elements.status.textContent = `${file.name} · ${result.questions.length}문항 인식 완료`;
    elements.workspace.classList.remove("hidden");
    renderQuestion();
  } catch (error) {
    elements.status.className = "status error";
    elements.status.textContent = `분석 실패: ${error.message}`;
  }
});

elements.select.addEventListener("change", renderQuestion);
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    renderActiveTab();
  });
});
elements.copy.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.code.textContent);
  elements.copy.textContent = "복사됨";
  setTimeout(() => { elements.copy.textContent = "XML 복사"; }, 1200);
});
