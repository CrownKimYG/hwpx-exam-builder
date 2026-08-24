import test from "node:test";
import assert from "node:assert/strict";
import {
  findTrimmedContentEnd,
  normalizeEquationScript,
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

test("trims only empty paragraphs after the last question content", () => {
  assert.equal(findTrimmedContentEnd([true, false, true, false, false]), 3);
  assert.equal(findTrimmedContentEnd([false, true, false, false], 1, 4), 2);
});
