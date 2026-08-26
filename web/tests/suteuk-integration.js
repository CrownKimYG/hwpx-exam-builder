import JSZip from "jszip";
import { prepareSuteukShortEssayHwpx } from "../src/suteuk-short-essay-parser.js";
import { buildExamFromSourcesHwpx, buildExamFromTemplateHwpx, validateGeneratedExamHwpx } from "../src/template-builder.js";

const HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const HS = "http://www.hancom.co.kr/hwpml/2011/section";
const HC = "http://www.hancom.co.kr/hwpml/2011/core";
const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");
const xml = (node) => new XMLSerializer().serializeToString(node);
const desc = (node, name) => [...node.getElementsByTagNameNS("*", name)];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (content) => `<hp:run charPrIDRef="0">${content}</hp:run>`;
const line = '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="2400" textheight="2400" baseline="1700" spacing="900" horzpos="0" horzsize="24376" flags="393216"/></hp:linesegarray>';
const p = (id, content) => `<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0">${content}${line}</hp:p>`;
const heading = (id, type) => p(id, run(`<hp:rect><hp:drawText><hp:subList>${p(id + 1, run(`<hp:t>${type}</hp:t>`))}</hp:subList></hp:drawText></hp:rect>`));
const note = (id, number) => `<hp:ctrl><hp:endNote number="${number}" suffixChar="32"><hp:subList>${p(id, run(`<hp:ctrl><hp:autoNum num="${number}" numType="ENDNOTE"/></hp:ctrl><hp:t>풀이</hp:t><hp:equation><hp:script>x+1</hp:script></hp:equation>`))}</hp:subList></hp:endNote></hp:ctrl>`;
const sections = (content) => `<hs:sec xmlns:hs="${HS}" xmlns:hp="${HP}" xmlns:hc="${HC}">${content}</hs:sec>`;
const bytes = (zip) => zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
const readSection = async (data) => parse(await (await JSZip.loadAsync(data)).file("Contents/section0.xml").async("string"));

async function addMasterPage(zip, label) {
  const content = parse(await zip.file("Contents/content.hpf").async("string"));
  const manifest = desc(content, "manifest")[0];
  const addItem = (id, href) => {
    const item = content.createElementNS(manifest.namespaceURI, "opf:item");
    item.setAttribute("id", id); item.setAttribute("href", href);
    item.setAttribute("media-type", href.endsWith(".png") ? "image/png" : "application/xml");
    manifest.append(item);
  };
  addItem("masterpage0", "Contents/masterpage0.xml");
  addItem("master_image", "BinData/master-image.png");
  zip.file("Contents/content.hpf", xml(content));
  zip.file("Contents/masterpage0.xml", sections(p(900, run(`<hp:t>${label}</hp:t><hc:img binaryItemIDRef="master_image"/>`))));
  zip.file("BinData/master-image.png", Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), (c) => c.charCodeAt(0)));
  const section = parse(await zip.file("Contents/section0.xml").async("string"));
  const properties = desc(section, "secPr")[0];
  if (properties) {
    properties.setAttribute("masterPageCnt", "1");
    const reference = section.createElementNS(HP, "hp:masterPage");
    reference.setAttribute("idRef", "masterpage0");
    properties.append(reference);
    zip.file("Contents/section0.xml", xml(section));
  }
}

document.querySelector("#run").addEventListener("click", async () => {
  const result = document.querySelector("#result");
  result.textContent = "실행 중";
  try {
    const template = new Uint8Array(await (await fetch("/templates/basic-math-exam.hwpx")).arrayBuffer());
    const source = await JSZip.loadAsync(template);
    source.file("Contents/section0.xml", sections(
      p(1, run("<hp:t>기본편 · 표지</hp:t>"))
      + heading(10, "약술법")
      + p(20, run(note(21, 7)) + run("<hp:t>첫 문제</hp:t>"))
      + p(22, run("<hp:line><hp:shapeComment>조건 도형</hp:shapeComment></hp:line>"))
      + heading(30, "연습문제")
      + p(40, run(note(41, 12)) + run("<hp:t>[26009-0001]</hp:t>"))
      + p(42, run("<hp:t>뒤 문단의 문제</hp:t>")),
    ));
    await addMasterPage(source, "원본 배경");
    const prepared = await prepareSuteukShortEssayHwpx(new File([await bytes(source)], "27약술 수능특강 수학1 _ 01 검증.hwpx"));
    const questions = prepared.analysis.questions.map((q) => ({ ...q, code: `01-${q.ordinal}`, fileCode: "01" }));
    assert(questions.length === 2 && questions.every((q) => q.difficulty === "유제"), "표지 분류가 전파됨");
    assert(questions[0].copyEnd - questions[0].copyStart === 2, "도형 문단이 누락됨");
    assert(questions[1].copyEnd - questions[1].copyStart === 2, "코드 뒤 본문이 누락됨");
    const inputs = [{ id: "01", bytes: prepared.bytes }];
    const selected = [questions[1], questions[0]];
    const output = await buildExamFromSourcesHwpx(inputs, template, selected, { useDefaultLayout: true });
    const outputZip = await JSZip.loadAsync(output);
    assert(!Object.keys(outputZip.files).some((path) => /masterpage|master-image/.test(path)), "원본 바탕쪽이 따라옴");
    const root = await readSection(output);
    const notes = desc(root, "endNote");
    assert(notes.map((n) => n.getAttribute("number")).join() === "1,2", "선택 순서대로 재번호하지 않음");
    assert(desc(root, "line").length === 1, "생성 중 도형 문단 누락");
    assert(notes.every((n) => desc(n, "script")[0]?.textContent === "x+1"), "미주 수식 변경");
    assert(notes.every((n) => desc(n, "lineseg")[0]?.getAttribute("vertsize") === "2400"), "미주 줄 높이 유실");
    assert([...root.documentElement.children].filter((p) => desc(p, "endNote").length)
      .every((p) => [...p.children].some((n) => n.localName === "linesegarray")), "문제 줄 배치 유실");
    assert(!desc(root, "t").some((t) => /^\d+\. $/.test(t.textContent)), "문항 번호 중복");
    await validateGeneratedExamHwpx(output, { expectedQuestionCount: 2, preserveOriginalContent: true });
    const problem = await buildExamFromSourcesHwpx(inputs, template, selected, { useDefaultLayout: true, hideEndnotes: true });
    await validateGeneratedExamHwpx(problem, { expectedQuestionCount: 2, preserveOriginalContent: true, expectHiddenEndnotes: true, expectHiddenEndnoteMarkers: false });
    const problemRoot = await readSection(problem);
    assert(desc(problemRoot, "endNote").every((n) => !desc(n, "t").length && !desc(n, "script").length), "문제지 정답 노출");
    const hiddenHeader = parse(await (await JSZip.loadAsync(problem)).file("Contents/header.xml").async("string"));
    const hiddenStyles = new Set(desc(hiddenHeader, "charPr").filter((n) => n.getAttribute("height") === "100").map((n) => n.getAttribute("id")));
    assert(desc(problemRoot, "endNote").every((n) => !hiddenStyles.has(n.parentElement.parentElement.getAttribute("charPrIDRef"))), "문제지 문항 번호 숨김");
    const custom = await JSZip.loadAsync(template);
    await addMasterPage(custom, "템플릿 배경");
    for (const built of [
      await buildExamFromSourcesHwpx(inputs, await bytes(custom), selected),
      await buildExamFromTemplateHwpx(prepared.bytes, await bytes(custom), questions, [2, 1]),
    ]) {
      const zip = await JSZip.loadAsync(built);
      const master = parse(await zip.file("Contents/masterpage0.xml").async("string"));
      assert(desc(master, "t")[0].textContent === "템플릿 배경", "템플릿 바탕쪽 미반영");
      const imageId = desc(master, "img")[0].getAttribute("binaryItemIDRef");
      const content = parse(await zip.file("Contents/content.hpf").async("string"));
      const imageItem = desc(content, "item").find((n) => n.getAttribute("id") === imageId);
      assert(imageItem && zip.file(imageItem.getAttribute("href")), "템플릿 바탕쪽 이미지 참조 유실");
    }
    result.textContent = "PASS · 분류 / 코드 전용 문단 / 도형 보존 / 미주·수식·줄 배치 / 재번호 / 문제지 답 숨김 / 원본 배경 제외 / 템플릿 배경·이미지 보존";
  } catch (error) {
    result.textContent = `FAIL · ${error.stack}`;
  }
});
