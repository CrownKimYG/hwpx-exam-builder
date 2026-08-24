import test from "node:test";
import assert from "node:assert/strict";
import {
  findTrimmedContentEnd,
  normalizeEquationScript,
  normalizeWatermarkText,
} from "./parser.js";

test("removes the copyright watermark suffix embedded in an equation script", () => {
  const script = `1 over 2

from
=========================================================================================================
족보닷컴(zocbo.com)

본 문제는 족보닷컴에서 직접 제작한 자료입니다.
=========================================================================================================`;

  assert.equal(normalizeEquationScript(script), "1 over 2");
});

test("keeps a legitimate equation from expression", () => {
  const script = "sum from {k=1} to 5 {2k+a}";
  assert.equal(normalizeEquationScript(script), script);
});

test("removes a flattened watermark that would otherwise render as a thin line", () => {
  const script = "x^2+1 from ========================================족보닷컴(zocbo.com)본문제는족보닷컴에서직접제작,자료화,해설작업을수행하여제공해드리는자료입니다.";
  assert.equal(normalizeEquationScript(script), "x^2+1");
});

test("removes watermark variants without damaging the equation prefix", () => {
  assert.equal(
    normalizeEquationScript("sqrt {2} from\n족보닷컴 본 문제는 저작권법의 보호를 받습니다."),
    "sqrt {2}",
  );
  assert.equal(
    normalizeEquationScript("x+y\n==============================\nzocbo.com copyright"),
    "x+y",
  );
});

test("removes a zocbo watermark suffix from preview text", () => {
  assert.equal(
    normalizeWatermarkText("문제 본문 ========================== 족보닷컴(zocbo.com)본문제는저작권법의보호를받습니다."),
    "문제 본문",
  );
  assert.equal(normalizeWatermarkText("족보닷컴(zocbo.com) 워터마크"), "");
  assert.equal(normalizeWatermarkText("정상 본문"), "정상 본문");
});

test("trims only empty paragraphs after the last question content", () => {
  assert.equal(findTrimmedContentEnd([true, false, true, false, false]), 3);
  assert.equal(findTrimmedContentEnd([false, true, false, false], 1, 4), 2);
});
