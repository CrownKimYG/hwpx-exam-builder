import test from "node:test";
import assert from "node:assert/strict";
import { parseEbsiKoreanStructure } from "./ebsi-korean-parser.js";

test("EBSi 국어 지문과 소속 문항의 복사 범위를 분리한다", () => {
  const rows = [
    "#강01#쪽009#번001~002#문항코드",
    "",
    "[001~002] [지문]",
    "다음 글을 읽고 물음에 답하시오.",
    "공통 지문",
    "[해설]",
    "지문 해설",
    "#강01#쪽010#번001#문항코드26001-0001",
    "[문제]",
    "첫 번째 문제는?",
    "① 하나 ② 둘 ③ 셋 ④ 넷 ⑤ 다섯",
    "[정답/모범답안]",
    "2",
    "[해설]",
    "첫 번째 해설",
    "#강01#쪽011#번002#문항코드26001-0002",
    "[문제]",
    "두 번째 문제는?",
    "[정답/모범답안]",
    "답",
    "[해설]",
    "두 번째 해설",
  ];
  const parsed = parseEbsiKoreanStructure(rows);
  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.questions.length, 2);
  assert.deepEqual(
    [parsed.questions[0].passageStart, parsed.questions[0].passageEnd],
    [3, 5],
  );
  assert.deepEqual([parsed.questions[0].copyStart, parsed.questions[0].copyEnd], [9, 11]);
  assert.deepEqual([parsed.questions[0].answerStart, parsed.questions[0].answerEnd], [11, 13]);
  assert.deepEqual([parsed.questions[1].copyStart, parsed.questions[1].copyEnd], [17, 18]);
  assert.equal(parsed.questions[0].passageGroupId, parsed.questions[1].passageGroupId);
  assert.equal(parsed.questions[1].sourceCode, "26001-0002");
});

test("문제 끝의 글자 없는 그림 문단도 복사 범위에 남긴다", () => {
  const rows = [
    "#번001~001#문항코드",
    "[001~001] [지문]",
    "지문",
    "#번001#문항코드26001-0001",
    "[문제]",
    "그림을 보고 답하시오.",
    "",
    "[정답/모범답안]",
    "1",
    "[해설]",
    "해설",
  ];
  const contentFlags = rows.map(Boolean);
  contentFlags[6] = true;
  const parsed = parseEbsiKoreanStructure(rows, "Contents/section0.xml", contentFlags);
  assert.deepEqual([parsed.questions[0].copyStart, parsed.questions[0].copyEnd], [5, 7]);
});
