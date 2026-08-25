import assert from "node:assert/strict";
import test from "node:test";
import {
  createHandoffMetadata,
  validateHandoffMetadata,
} from "./handoff.js";

test("인계 정보에 과목 순서와 전체 문항 수를 저장한다", () => {
  const metadata = createHandoffMetadata({
    title: "시험지 01",
    includedSubjects: [{ subject: "국어", questionCount: 20 }],
  });
  assert.equal(metadata.title, "시험지 01");
  assert.equal(metadata.questionCount, 20);
  assert.deepEqual(metadata.includedSubjects, [{ subject: "국어", questionCount: 20 }]);
  assert.equal(validateHandoffMetadata(metadata), metadata);
});

test("같은 과목을 두 번 넣은 인계 정보는 거부한다", () => {
  assert.throws(() => createHandoffMetadata({
    title: "시험지",
    includedSubjects: [
      { subject: "수학", questionCount: 10 },
      { subject: "수학", questionCount: 5 },
    ],
  }), /같은 과목/);
});

test("일반 HWPX 메타데이터는 인계 파일로 인정하지 않는다", () => {
  assert.throws(() => validateHandoffMetadata({}), /인계용 HWPX/);
});
