import test from "node:test";
import assert from "node:assert/strict";

import { numberedExamTitle } from "./exam-naming.js";

test("일괄 출제 기본 이름 뒤에 두 자리 순번을 붙인다", () => {
  assert.equal(numberedExamTitle("주간 테스트", 1), "주간 테스트 01");
  assert.equal(numberedExamTitle("  주간 테스트  ", 12), "주간 테스트 12");
});

test("기본 이름이 비어 있으면 시험지를 사용한다", () => {
  assert.equal(numberedExamTitle("", 3), "시험지 03");
});
