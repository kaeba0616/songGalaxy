import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextPosition, pickEngine, stageSeed } from "./engine";

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

describe("stageSeed", () => {
  const playlist = {
    mode: "playlist" as const,
    songs: [
      { id: 1, youtubeVideoId: null },
      { id: 2, youtubeVideoId: "vid2" },
      { id: 3, youtubeVideoId: "vid3" },
    ],
  };

  it("큐가 없으면 무대도 없다", () => {
    assert.equal(stageSeed(null, null, null), null);
  });

  it("탐색 큐에는 무대를 세우지 않는다", () => {
    assert.equal(stageSeed({ mode: "browse", songs: playlist.songs }, null, 2), null);
  });

  it("목록 큐면 엔진이 아직 youtube가 아니어도 세운다", () => {
    // 엔진은 손잡이가 있어야 youtube가 되고 손잡이는 무대가 서야 생긴다 — 여기서 좁히면 교착
    assert.equal(stageSeed(playlist, null, 2), "vid2");
  });

  it("지금 곡의 영상을 씨앗으로 쓴다", () => {
    assert.equal(stageSeed(playlist, "youtube", 3), "vid3");
  });

  it("지금 곡에 영상이 없으면 목록의 다른 영상을 씨앗으로 쓴다", () => {
    // 미리듣기로 떨어진 곡을 듣는 중이라도 무대는 서 있어야 다음 곡이 영상으로 이어진다
    assert.equal(stageSeed(playlist, "youtube", 1), "vid2");
  });

  it("아직 아무 곡도 안 틀었으면 목록의 첫 영상을 씨앗으로 쓴다", () => {
    assert.equal(stageSeed(playlist, null, null), "vid2");
  });

  it("목록 전체에 영상이 하나도 없으면 null", () => {
    assert.equal(
      stageSeed({ mode: "playlist", songs: [{ id: 1 }, { id: 2, youtubeVideoId: null }] }, null, 1),
      null,
    );
  });

  it("영상 실패로 큐가 browse로 내려가도 엔진이 youtube면 무대를 유지한다", () => {
    // 폴백 도중 무대를 내리면 손잡이가 사라져 되살릴 길이 없어진다
    assert.equal(stageSeed({ mode: "browse", songs: playlist.songs }, "youtube", 2), "vid2");
  });
});
