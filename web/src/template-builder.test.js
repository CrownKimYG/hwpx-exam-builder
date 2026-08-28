import assert from "node:assert/strict";
import test from "node:test";
import { fittedTableCells, templateTextWidth } from "./template-layout.js";
import {
  answerChoiceSymbolFromText,
  choiceSymbolFromShapeComment,
  hasCompleteChoiceSet,
  isQuestionNumberCandidateText,
  rewriteEssayPromptText,
} from "./template-builder.js";

test("미주 정답에서 객관식 번호를 직접 찾는다", () => {
  assert.equal(answerChoiceSymbolFromText("[정답] ④"), "④");
  assert.equal(answerChoiceSymbolFromText("[정답] 4"), "④");
  assert.equal(answerChoiceSymbolFromText("[정답] 21"), null);
});

test("다섯 선택지가 모두 있을 때만 주관식 변환 대상으로 인정한다", () => {
  assert.equal(hasCompleteChoiceSet("① 9 ② 12 ③ 15 ④ 18 ⑤ 21"), true);
  assert.equal(hasCompleteChoiceSet("① 9 ② 12 ③ 15 ④ 18"), false);
});

test("작은 선택지 그림은 파일명 표식으로만 번호를 찾는다", () => {
  const comment = "그림입니다.\n원본 그림의 이름: 5.jpg\n원본 그림의 크기: 가로 235pixel";
  assert.equal(choiceSymbolFromShapeComment(comment, "844", "844"), "⑤");
  assert.equal(choiceSymbolFromShapeComment(comment, "10560", "10980"), null);
  assert.equal(choiceSymbolFromShapeComment("원본 그림의 이름: diagram.jpg", "844", "844"), null);
});

test("서술형 문장 말미는 지정된 세 규칙으로만 치환한다", () => {
  assert.equal(rewriteEssayPromptText("함숫값은?"), "함숫값을 구하는 과정을 서술하시오.");
  assert.equal(rewriteEssayPromptText("도형의 넓이는？"), "도형의 넓이를 구하는 과정을 서술하시오.");
  assert.equal(rewriteEssayPromptText("상수 a를 구하시오"), "상수 a를 구하는 과정을 서술하시오.");
  assert.equal(rewriteEssayPromptText("옳은 것을 고르시오."), "옳은 것을 고르시오.");
});

test("문항 번호는 워터마크나 난이도 표식이 아닌 본문에 붙인다", () => {
  assert.equal(isQuestionNumberCandidateText("zb"), false);
  assert.equal(isQuestionNumberCandidateText("zocbo.com"), false);
  assert.equal(isQuestionNumberCandidateText("❙ 예제1 유사유형"), false);
  assert.equal(isQuestionNumberCandidateText("다음 식의 값을 구하시오."), true);
});

test("템플릿의 좌우 여백, 제본 여백, 단 간격으로 입력 너비를 구한다", () => {
  const page = { pageWidth: 59528, left: 4252, right: 4252 };
  assert.equal(templateTextWidth(page), 51024);
  assert.equal(templateTextWidth({ ...page, columnCount: 2, columnGap: 2268 }), 24378);
  assert.equal(templateTextWidth({ ...page, gutter: 1000 }), 50024);
  assert.equal(templateTextWidth({ ...page, gutter: 1000, gutterType: "TOP_ONLY" }), 51024);
  assert.equal(templateTextWidth({ pageWidth: 0 }), null);
  assert.equal(templateTextWidth({ ...page, columnCount: 2, columnGap: 60000 }), null);
});

test("너비가 다른 다단은 자동 흐름에서도 넘치지 않는 최소 폭을 사용한다", () => {
  assert.equal(templateTextWidth({ pageWidth: 51024, columnCount: 2, columnWidths: [20000, 29000] }), 20000);
});

test("표의 열 비율과 병합 셀 경계가 반올림 후에도 일치한다", () => {
  const cells = [
    { column: 0, span: 1, width: 10000 },
    { column: 1, span: 1, width: 10000 },
    { column: 2, span: 1, width: 10000 },
    { column: 0, span: 2, width: 20000 },
    { column: 2, span: 1, width: 10000 },
  ];
  const fitted = fittedTableCells(cells, 3, 30000, 50000);
  assert.deepEqual(fitted, [16667, 16666, 16667, 33333, 16667]);
  assert.equal(fitted[0] + fitted[1], fitted[3]);
  assert.equal(fitted[3] + fitted[4], 50000);
});

test("셀 간격을 고정하고 병합으로 가려진 열 경계도 보정한다", () => {
  assert.deepEqual(fittedTableCells([
    { column: 0, span: 2, width: 20100 }, { column: 2, span: 1, width: 10000 },
  ], 3, 30200, 15200, 100), [10100, 5000]);
  assert.equal(fittedTableCells([], 0, 0, 10000), null);
  assert.equal(fittedTableCells([], 2, 10000, 0), null);
  assert.equal(fittedTableCells([], NaN, 10000, 20000), null);
});
