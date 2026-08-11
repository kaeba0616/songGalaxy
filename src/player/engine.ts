/**
 * 재생 엔진 선택 — PlayerProvider가 곡마다 이 판단으로 하나만 켠다 (docs/SSOT.md).
 *
 * 목록 재생일 때만 YouTube를 쓴다. 은하 탐색까지 영상으로 하면 화면이 무거워지고,
 * 무엇보다 영상 ID 조회가 쿼터(하루 100곡)를 태운다.
 */
export type Engine = "preview" | "youtube";

export function pickEngine(opts: {
  mode: "playlist" | "browse";
  youtubeVideoId?: string | null;
  previewUrl?: string | null;
}): Engine | null {
  if (opts.mode === "playlist" && opts.youtubeVideoId) return "youtube";
  if (opts.previewUrl) return "preview";
  return null;
}

/**
 * 목록에 곡을 새로 담을 때 줄 position.
 * 곡을 빼면 구멍이 생기므로 길이가 아니라 최대값 기준으로 매긴다.
 */
export function nextPosition(existing: number[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing) + 1;
}
