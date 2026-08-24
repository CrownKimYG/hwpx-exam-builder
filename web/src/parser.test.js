import test from "node:test";
import assert from "node:assert/strict";
import {
  choiceNumberFromShapeComment,
  findTrimmedContentEnd,
  hasChoiceParagraphMarker,
  normalizeEquationScript,
  splitChoiceMarkerText,
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

test("reads a multiple-choice number from an HWP picture comment", () => {
  assert.equal(choiceNumberFromShapeComment("원본 그림의 이름: 4.jpg"), 4);
  assert.equal(choiceNumberFromShapeComment("원본 그림의 이름 : 5.PNG"), 5);
  assert.equal(choiceNumberFromShapeComment("원본 그림의 이름: graph.jpg"), null);
});

test("does not classify a problem stem as choices from its paragraph style alone", () => {
  assert.equal(hasChoiceParagraphMarker(0, "함수의 값은?"), false);
  assert.equal(hasChoiceParagraphMarker(1, ""), true);
  assert.equal(hasChoiceParagraphMarker(0, "① 2 ② 4"), true);
});

test("splits converted HWP Unicode choice markers into five ordered choices", () => {
  const firstRow = splitChoiceMarkerText("① 2\t② 4");
  const secondRow = splitChoiceMarkerText("③ 6\t④ 8", firstRow.currentNumber);
  const lastRow = splitChoiceMarkerText("⑤ 10", secondRow.currentNumber);

  assert.deepEqual(
    [...firstRow.markers, ...secondRow.markers, ...lastRow.markers],
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    [...firstRow.fragments, ...secondRow.fragments, ...lastRow.fragments]
      .map(({ number, text }) => [number, text.trim()]),
    [[1, "2"], [2, "4"], [3, "6"], [4, "8"], [5, "10"]],
  );
});

test("trims only empty paragraphs after the last question content", () => {
  assert.equal(findTrimmedContentEnd([true, false, true, false, false]), 3);
  assert.equal(findTrimmedContentEnd([false, true, false, false], 1, 4), 2);
});
