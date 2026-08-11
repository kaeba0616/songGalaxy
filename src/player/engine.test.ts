import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextPosition, pickEngine } from "./engine";

describe("nextPosition", () => {
  it("빈 목록이면 0", () => {
    assert.equal(nextPosition([]), 0);
  });

  it("가장 큰 값 다음을 준다", () => {
    assert.equal(nextPosition([0, 1, 2]), 3);
  });

  it("구멍이 있어도 최대값 기준으로 준다", () => {
    // 곡을 빼면 position에 구멍이 생긴다. 길이가 아니라 최대값을 봐야 충돌하지 않는다
    assert.equal(nextPosition([0, 5]), 6);
  });
});

describe("pickEngine", () => {
  it("목록 재생이고 영상이 있으면 youtube", () => {
    assert.equal(pickEngine({ mode: "playlist", youtubeVideoId: "abc", previewUrl: "p" }), "youtube");
  });

  it("목록 재생이어도 영상이 없으면 preview로 떨어진다", () => {
    assert.equal(pickEngine({ mode: "playlist", youtubeVideoId: null, previewUrl: "p" }), "preview");
  });

  it("탐색 중에는 영상이 있어도 preview를 쓴다", () => {
    // 쿼터와 UX 모두의 이유 — 은하 탐색은 30초 미리듣기로 가볍게 유지한다
    assert.equal(pickEngine({ mode: "browse", youtubeVideoId: "abc", previewUrl: "p" }), "preview");
  });

  it("둘 다 없으면 null (호출부가 다음 곡으로 건너뛴다)", () => {
    assert.equal(pickEngine({ mode: "playlist", youtubeVideoId: null, previewUrl: null }), null);
  });
});
