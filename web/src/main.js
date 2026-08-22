import initRhwp, { HwpDocument } from "@rhwp/core";
import rhwpWasmUrl from "@rhwp/core/rhwp_bg.wasm?url";
import "./styles.css";
import { parseHwpx, prepareHwpxForPreview } from "./parser.js";

const elements = {
  file: document.querySelector("#hwpx-file"),
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

function setStatus(message, state = "") {
  elements.status.className = `status ${state}`.trim();
  elements.status.textContent = message;
}

function safeSvg(svgSource, pageNumber) {
  const parsed = new DOMParser().parseFromString(svgSource, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error(`${pageNumber}페이지 SVG를 읽지 못했습니다.`);

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
  root.setAttribute("aria-label", `HWPX 원본 ${pageNumber}페이지`);
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
    elements.pageCanvas.replaceChildren(safeSvg(svg, pageIndex + 1));
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

elements.file.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  setStatus("HWPX 문항을 분석하고 원본 페이지를 구성하는 중입니다...", "loading");
  elements.workspace.classList.add("hidden");
  elements.pageCanvas.replaceChildren();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const [analysis, previewBytes] = await Promise.all([
      parseHwpx(file),
      prepareHwpxForPreview(bytes),
      rhwpReady,
    ]);
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
    elements.workspace.classList.remove("hidden");
    renderPage(0);
    setStatus(`${file.name} · ${analysis.questions.length}문항 · ${pageCount}페이지 준비 완료`, "success");
  } catch (error) {
    documentViewer?.free?.();
    documentViewer = null;
    pageCount = 0;
    setStatus(`분석 실패: ${error.message}`, "error");
  }
});

elements.previous.addEventListener("click", () => renderPage(currentPage - 1));
elements.next.addEventListener("click", () => renderPage(currentPage + 1));

rhwpReady
  .then(() => setStatus("렌더러 준비 완료. HWPX 파일을 선택하세요."))
  .catch((error) => setStatus(`렌더러 준비 실패: ${error.message}`, "error"));
