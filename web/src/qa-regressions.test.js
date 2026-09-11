import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { parseHwpx } from "./parser.js";
import { loadArchive } from "./archive.js";
import { createWorkspaceStore, WorkspaceConflictError, WORKSPACE_DRAFT_KEY } from "./workspace-storage.js";
import { localDateStamp } from "./date-format.js";
import { fileAnalysisCacheKey } from "./bank-cache-model.js";

const window = new JSDOM("").window;
Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, Node: window.Node });
const paragraph = (text, attributes = "") => `<hp:p ${attributes}><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`;
const question = text => `<hp:p><hp:run><hp:t>${text}</hp:t><hp:ctrl><hp:endNote number="1"><hp:subList>${paragraph("정답")}</hp:subList></hp:endNote></hp:ctrl></hp:run></hp:p>`;
const section = body => `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
const bytes = zip => zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
const parse = async zip => { const data = await bytes(zip); return parseHwpx({ name: "qa.hwpx", arrayBuffer: async () => data }); };

test("마지막 문항은 명시적인 쪽 나눔 뒤의 조건과 선택지도 보존한다", async () => {
  const result = await parse(new JSZip().file("Contents/section0.xml", section(question("시작") + paragraph("필수 조건", 'pageBreak="1"') + paragraph("마지막 선택지"))));
  assert.equal(result.questions[0].copyEnd, 3);
  assert.match(result.questions[0].questionText, /시작\n필수 조건\n마지막 선택지/);
});

test("12개 구역의 문항 코드가 원문 구역 번호 순서를 따른다", async () => {
  const zip = new JSZip();
  for (let i = 11; i >= 0; i--) zip.file(`Contents/section${i}.xml`, section(question(`구역 ${i}`)));
  const result = await parse(zip);
  assert.deepEqual(result.questions.map(q => q.questionText), Array.from({ length: 12 }, (_, i) => `구역 ${i}`));
});

test("파일 크기 제한은 파일을 메모리에 읽기 전에 검사한다", async () => {
  let read = false;
  await assert.rejects(parseHwpx({ name: "big.hwpx", size: 257 * 1024 * 1024, arrayBuffer() { read = true; } }), /파일 크기/);
  assert.equal(read, false);
});

test("압축 엔트리 수와 예상 압축 해제 크기를 제한한다", async () => {
  await assert.rejects(loadArchive(await bytes(new JSZip().file("a", "a").file("b", "b")), { limits: { bytes: 4096, entries: 1 } }), /항목 수/);
  await assert.rejects(loadArchive(await bytes(new JSZip().file("a", "x".repeat(4096))), { limits: { bytes: 1024, entries: 10 } }), /압축 해제 크기/);
});

test("작은 크기로 위조된 ZIP도 실제 해제량으로 중단하며 CRC 손상을 거부한다", async () => {
  const forged = Buffer.from(await bytes(new JSZip().file("a", "x".repeat(4096))));
  const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  forged.writeUInt32LE(1, central + 24);
  await assert.rejects(loadArchive(forged, { limits: { bytes: 1024, entries: 10 } }), /압축 해제 크기/);
  const corrupt = Buffer.from(await bytes(new JSZip().file("a", "hello")));
  const crcHeader = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE(0, crcHeader + 16);
  await assert.rejects(loadArchive(corrupt), /CRC/);
});

test("두 탭의 오래된 초안은 최신 제목을 덮지 않으며 명시적 복원 후 저장한다", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = createWorkspaceStore(storage);
  first.save({ exams: [{ title: "원래 제목" }] });
  const stale = createWorkspaceStore(storage);
  stale.adopt();
  first.save({ exams: [{ title: "새 제목" }] });
  assert.throws(() => stale.save({ exams: [{ title: "원래 제목" }] }), WorkspaceConflictError);
  assert.equal(stale.read().exams[0].title, "새 제목");
  stale.adopt();
  const saved = values.get(WORKSPACE_DRAFT_KEY);
  assert.equal(stale.save({ exams: [{ title: "새 제목" }] }), false);
  assert.equal(values.get(WORKSPACE_DRAFT_KEY), saved);
  stale.save({ exams: [{ title: "복원 후 편집" }] });
  assert.equal(stale.read().exams[0].title, "복원 후 편집");
});

test("초안 저장 용량 실패를 성공으로 처리하거나 다음 재시도를 차단하지 않는다", () => {
  let raw = null, fail = true;
  const store = createWorkspaceStore({ getItem: () => raw, setItem: (_, value) => { if (fail) throw new Error("quota"); raw = value; } });
  assert.throws(() => store.save({ exams: [] }), /quota/);
  fail = false;
  assert.equal(store.save({ exams: [] }), true);
});

test("파일명 날짜는 UTC 변환 없이 현지 날짜 필드를 사용한다", () => {
  assert.equal(localDateStamp(new Date(2026, 8, 12, 5, 50)), "2026-09-12");
});

const mainSource = await fs.readFile(new URL("./main.js", import.meta.url), "utf8");
test("일시적 기본 템플릿 통신 실패 후 같은 페이지에서 다시 요청한다", async () => {
  let calls = 0;
  const source = mainSource.slice(mainSource.indexOf("async function getDefaultTemplateBytes()"), mainSource.indexOf("\nfunction templateValuesFor("));
  const context = vm.createContext({ templateState: {}, DEFAULT_TEMPLATE_URL: "/template.hwpx", Uint8Array, fetch: async () => {
    if (++calls === 1) throw new Error("temporary");
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  } });
  vm.runInContext(source, context);
  await assert.rejects(vm.runInContext("getDefaultTemplateBytes()", context), /temporary/);
  assert.equal((await vm.runInContext("getDefaultTemplateBytes()", context)).length, 1);
  assert.equal(calls, 2);
});

test("SVG 필터는 외부 CSS와 이벤트를 제거하고 로컬 색상·클립 참조는 보존한다", () => {
  const source = mainSource.slice(mainSource.indexOf("function safeSvg("), mainSource.indexOf("\nfunction applyZoom("));
  const context = vm.createContext({ DOMParser: window.DOMParser, document: window.document });
  vm.runInContext(source, context);
  context.input = '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><style>@import url(https://example.invalid/a);</style><style>.ok{fill:#123;clip-path:url("#clip")}</style><rect style="fill:url(https://example.invalid/x)"/><path fill="url(#paint)"/><image href="data:text/html;base64,AAAA"/><script>bad()</script></svg>';
  const output = vm.runInContext('safeSvg(input,"test")', context);
  assert.doesNotMatch(output.outerHTML, /example.invalid|onload|<script|data:text/);
  assert.match(output.outerHTML, /url\(#paint\)/);
  assert.match(output.querySelector("style").textContent, /url\("#clip"\)/);
});

test("IndexedDB 첫 연결 실패 뒤 새 연결로 회복한다", async () => {
  let calls = 0;
  const database = new EventTarget();
  let fileRecords = [];
  database.transaction = storeName => {
    const tx = new EventTarget();
    tx.objectStore = () => ({ index() { return this; }, getAll() {
      const request = new EventTarget();
      request.result = storeName === "bankProfiles" ? [] : fileRecords;
      queueMicrotask(() => { request.dispatchEvent(new Event("success")); tx.dispatchEvent(new Event("complete")); });
      return request;
    } });
    return tx;
  };
  const original = globalThis.indexedDB;
  globalThis.indexedDB = { open() {
    const request = new EventTarget();
    const failed = ++calls === 1;
    request.error = new Error("temporary"); request.result = database;
    queueMicrotask(() => request.dispatchEvent(new Event(failed ? "error" : "success")));
    return request;
  } };
  try {
    const cache = await import(`./bank-cache.js?qa=${Date.now()}`);
    await assert.rejects(cache.listBankProfiles(), /temporary/);
    assert.deepEqual(await cache.listBankProfiles(), []);
    assert.equal(calls, 2);
    const identity = { relativePath: "qa.hwpx", size: 100, lastModified: 1 };
    const old = { bankId: "qa", identity, ruleId: "macro-endnote-v1", cacheKey: "old", savedAt: "2026-09-11", sourceSnapshot: { sourceBytes: new Uint8Array([1]) } };
    fileRecords = [old];
    const stale = await cache.listCachedFileAnalysisRecords("qa");
    assert.equal(stale[0].needsReanalysis, true);
    assert.deepEqual(stale[0].sourceSnapshot.sourceBytes, new Uint8Array([1]));
    fileRecords.push({ ...old, savedAt: "2026-09-12", cacheKey: fileAnalysisCacheKey("qa", identity) });
    const current = await cache.listCachedFileAnalysisRecords("qa");
    assert.equal(current.length, 1);
    assert.equal(current[0].needsReanalysis, false);
  } finally { globalThis.indexedDB = original; }
});
