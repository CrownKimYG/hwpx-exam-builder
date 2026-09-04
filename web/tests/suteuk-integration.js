import JSZip from "jszip";
import { prepareSuteukShortEssayHwpx } from "../src/suteuk-short-essay-parser.js";
import { buildExamFromSourcesHwpx, buildExamFromTemplateHwpx, validateGeneratedExamHwpx } from "../src/template-builder.js";
import { fitTemplateObjects } from "../src/template-layout.js";

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

const rectangle = (id, label, width = 30000) => `<hp:rect id="${id}" groupLevel="0">
  <hp:orgSz width="10000" height="10000"/><hp:curSz width="${width}" height="4294959948"/>
  <hp:rotationInfo angle="0" centerX="${width / 2}" centerY="3000"/>
  <hp:renderingInfo><hc:scaMatrix e1="${width / 10000}" e2="0" e3="0" e4="0" e5="-0.8" e6="6000"/></hp:renderingInfo>
  <hp:drawText lastWidth="${width}"><hp:subList textWidth="0">${p(id + 1, run(`<hp:t>${label}</hp:t>`))}</hp:subList><hp:textMargin left="100" right="100"/></hp:drawText>
  <hp:sz width="${width}" widthRelTo="ABSOLUTE" height="1200" heightRelTo="ABSOLUTE"/>
  <hp:pos treatAsChar="1" horzOffset="1000" horzRelTo="COLUMN" horzAlign="LEFT"/>
  <hp:outMargin left="0" right="0"/>
</hp:rect>`;
const cell = (column, span, width, content, row = 0) => `<hp:tc hasMargin="0"><hp:subList textWidth="0">${content}</hp:subList>
  <hp:cellAddr colAddr="${column}" rowAddr="${row}"/><hp:cellSpan colSpan="${span}" rowSpan="1"/>
  <hp:cellSz width="${width}" height="4000"/><hp:cellMargin left="9000" right="9000"/></hp:tc>`;
const table = (id, width, cols, rows, inner = 1200, outer = 500) => `<hp:tbl id="${id}" colCnt="${cols}" rowCnt="${rows.length}" cellSpacing="0">
  <hp:sz width="${width}" widthRelTo="ABSOLUTE" height="8000" heightRelTo="ABSOLUTE"/>
  <hp:pos treatAsChar="1" horzOffset="0"/><hp:outMargin left="${outer / 2}" right="${outer / 2}"/>
  <hp:inMargin left="${inner / 2}" right="${inner / 2}"/>${rows.map((row) => `<hp:tr>${row}</hp:tr>`).join("")}</hp:tbl>`;

async function testTemplateWidths(template) {
  const fixture = await JSZip.loadAsync(template);
  const sourceXml = sections(
    heading(410, "약술법") + p(420, run(note(421, 1) + "<hp:t>너비 검증 문제</hp:t>"))
    + p(500, run(rectangle(501, "본문 조건 상자의 너비 검증")))
    + p(600, run(table(601, 30000, 3, [
      cell(0, 1, 10000, p(610, run(rectangle(611, "셀 안 조건 상자"))))
        + cell(1, 1, 10000, p(620, run("<hp:t>두 번째 열</hp:t>")))
        + cell(2, 1, 10000, p(630, run("<hp:t>세 번째 열</hp:t>"))),
      cell(0, 2, 20000, p(640, run("<hp:t>병합 셀</hp:t>")), 1)
        + cell(2, 1, 10000, p(650, run("<hp:t>마지막 셀</hp:t>")), 1),
    ])))
    + p(700, run(rectangle(701, "풀이", 2551) + "<hp:t>작은 표식은 그대로</hp:t>"))
    + p(800, run('<hp:rect id="801"><hp:sz width="9000" widthRelTo="ABSOLUTE"/></hp:rect>')),
  );
  // A source table may store 100% rather than an absolute width. Its cells
  // still carry the original column geometry.
  const sourceRoot = parse(sourceXml);
  const gridSize = [...desc(sourceRoot, "tbl")[0].children].find((node) => node.localName === "sz");
  gridSize.setAttribute("width", "10000");
  gridSize.setAttribute("widthRelTo", "COLUMN");
  fixture.file("Contents/section0.xml", xml(sourceRoot));
  const prepared = await prepareSuteukShortEssayHwpx(new File([await bytes(fixture)], "27약술 수능특강 수학1 _ 01 너비.hwpx"));
  const question = { ...prepared.analysis.questions[0], fileCode: "01", code: "01-1" };
  assert(prepared.analysis.questions.length === 1, "너비 검증 문항 추출 실패");
  const layouts = [
    { columns: 1, expected: 49000 }, { columns: 2, expected: 23500 }, { columns: 1, nested: true, expected: 16000 },
  ];
  for (const layout of layouts) {
    const custom = await JSZip.loadAsync(template);
    const controls = '<hp:secPr><hp:pagePr width="60000" height="84000" gutterType="LEFT_ONLY"><hp:margin left="5000" right="5000" gutter="1000"/></hp:pagePr></hp:secPr>'
      + `<hp:ctrl><hp:colPr colCount="${layout.columns}" sameSz="1" sameGap="2000"/></hp:ctrl>`;
    const slot = layout.nested
      // The supplied template has no text in this outer paragraph. Its only
      // text is the #N marker inside the nested one-cell slot table.
      ? p(1, run(controls)) + p(2, run(table(200, 18000, 1, [cell(0, 1, 18000, p(3, run("<hp:t>#1</hp:t>")))], 2000, 0)))
      : p(1, run(controls + "<hp:t>#1</hp:t>"));
    custom.file("Contents/section0.xml", sections(slot));
    for (const output of [
      await buildExamFromSourcesHwpx([{ id: "01", bytes: prepared.bytes }], await bytes(custom), [question]),
      await buildExamFromTemplateHwpx(prepared.bytes, await bytes(custom), [question], [question.ordinal]),
    ]) {
      const root = await readSection(output);
      const byId = (tag, id) => desc(root, tag).find((node) => node.getAttribute("id") === String(id));
      const direct = (node, tag) => [...node.children].find((item) => item.localName === tag);
      const width = (node) => Number(direct(node, "sz").getAttribute("width"));
      const box = byId("rect", 501);
      assert(width(box) === layout.expected, `본문 상자 너비: ${width(box)} / ${layout.expected}`);
      assert(direct(box, "curSz").getAttribute("width") === String(layout.expected), "사각형 현재 너비 불일치");
      assert(direct(box, "drawText").getAttribute("lastWidth") === String(layout.expected), "글상자 너비 불일치");
      assert(direct(box, "curSz").getAttribute("height") === "-7348", "도형 높이 signed 32비트 정규화 누락");
      assert(Math.abs(Number(desc(box, "scaMatrix")[0].getAttribute("e1")) - layout.expected / 10000) < 1e-8, "사각형 가로 변환 누락");
      assert(desc(box, "lineseg")[0].getAttribute("vertsize") === "2400", "수식 줄 높이 유실");
      assert(width(byId("rect", 701)) === 2551 && width(byId("rect", 801)) === 9000, "작은 표식 또는 도형이 늘어남");
      const grid = byId("tbl", 601);
      const cells = [...grid.children].filter((n) => n.localName === "tr").flatMap((row) => [...row.children]);
      const widths = cells.map((n) => Number(direct(n, "cellSz").getAttribute("width")));
      assert(width(grid) === layout.expected - 500 && widths[0] + widths[1] + widths[2] === width(grid), "표/셀 전체 너비 불일치");
      assert(widths[3] === widths[0] + widths[1] && widths[3] + widths[4] === width(grid), "병합 셀 경계 불일치");
      assert(width(byId("rect", 611)) === widths[0] - 1200, "셀 내부 여백 미반영");
      if (layout.nested) {
        const slotTable = byId("tbl", 200);
        assert(slotTable && width(slotTable) === 18000, "중첩 슬롯 표 유실 또는 변경");
        assert(desc(slotTable, "p").some((paragraph) => paragraph.getAttribute("id") === "420"), "문제가 슬롯 표 밖에 삽입됨");
      }
      assert(desc(root, "pagePr").length === 1 && desc(root, "colPr").length === 1, "슬롯 문단의 용지/단 설정 유실");
      const before = xml(root);
      const header = parse(await (await JSZip.loadAsync(output)).file("Contents/header.xml").async("string"));
      fitTemplateObjects([root], header, new Set(desc(root, "p").filter((node) => [420, 500, 600, 700, 800].includes(Number(node.getAttribute("id"))))));
      assert(xml(root) === before, "너비 보정의 중복 적용으로 크기가 달라짐");
    }
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
    await testTemplateWidths(template);
    result.textContent = "PASS · 분류 / 코드 전용 문단 / 도형 보존 / 미주·수식·줄 배치 / 재번호 / 문제지 답 숨김 / 원본 배경 제외 / 템플릿 배경·이미지 보존 / 1·2단 너비 / 병합 셀 / 중첩 슬롯 / 작은 표식 보존 / 너비 보정 재실행";
  } catch (error) {
    result.textContent = `FAIL · ${error.stack}`;
  }
});
