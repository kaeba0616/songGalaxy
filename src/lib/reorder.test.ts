import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dropIndex, moveItem, sameMembers } from "./reorder";

describe("moveItem", () => {
  it("아래로 옮긴다", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  });

  it("위로 옮긴다", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
  });

  it("제자리에 놓으면 그대로", () => {
    assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
  });

  it("맨 위·맨 아래 경계", () => {
    assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  });

  it("원본 배열을 건드리지 않는다", () => {
    // 낙관적 UI가 실패 시 원본으로 되돌리려면 원본이 살아 있어야 한다
    const original = ["a", "b", "c"];
    moveItem(original, 0, 2);
    assert.deepEqual(original, ["a", "b", "c"]);
  });

  it("범위 밖 인덱스는 그대로 돌려준다", () => {
    assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
    assert.deepEqual(moveItem(["a", "b"], 0, -1), ["a", "b"]);
  });
});

describe("dropIndex", () => {
  it("움직이지 않았으면 제자리", () => {
    assert.equal(dropIndex(2, 0, 60, 10), 2);
  });

  it("한 행 높이만큼 내리면 한 칸 아래", () => {
    assert.equal(dropIndex(2, 60, 60, 10), 3);
  });

  it("행 높이의 절반을 넘어야 한 칸 움직인다", () => {
    assert.equal(dropIndex(2, 29, 60, 10), 2);
    assert.equal(dropIndex(2, 31, 60, 10), 3);
  });

  it("위로도 같은 규칙", () => {
    assert.equal(dropIndex(5, -120, 60, 10), 3);
  });

  it("목록 밖으로는 나가지 않는다", () => {
    assert.equal(dropIndex(0, -600, 60, 4), 0);
    assert.equal(dropIndex(3, 600, 60, 4), 3);
  });

  it("행 높이를 못 잰 경우(0) 제자리를 준다", () => {
    // 0으로 나누면 NaN이 되어 목록이 통째로 뒤집힌다
    assert.equal(dropIndex(2, 100, 0, 10), 2);
  });
});

describe("sameMembers", () => {
  it("순서만 다르면 같은 집합", () => {
    assert.equal(sameMembers([1, 2, 3], [3, 1, 2]), true);
  });

  it("하나라도 다르면 다르다", () => {
    assert.equal(sameMembers([1, 2, 3], [1, 2, 4]), false);
  });

  it("길이가 다르면 다르다", () => {
    assert.equal(sameMembers([1, 2], [1, 2, 3]), false);
  });

  it("한쪽에 중복이 있으면 다르다", () => {
    // 길이가 같고 Set으로만 비교하면 [1,1,2]와 [1,2,2]가 같다고 나온다
    assert.equal(sameMembers([1, 1, 2], [1, 2, 2]), false);
  });

  it("빈 배열끼리는 같다", () => {
    assert.equal(sameMembers([], []), true);
  });
});
