import assert from "node:assert/strict";
import test from "node:test";
import {
  answerChoiceSymbolFromText,
  choiceSymbolFromShapeComment,
  hasCompleteChoiceSet,
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
