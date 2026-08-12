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
 * 영상 무대를 세울 씨앗 영상 ID. 무대가 필요 없으면 null.
 *
 * "언제 무대가 서 있어야 하는가"는 그리는 쪽이 아니라 재생 상태의 문제다 —
 * 한때 이 판단이 미니플레이어 안에 있었고, 그래서 은하 카드 목록이 열려 알약이
 * 숨는 순간 무대까지 사라져 전곡 재생이 통째로 죽었다.
 *
 * 두 가지를 함께 지킨다:
 * - `engine === "youtube"`가 된 뒤에 세우면 늦다. 엔진은 손잡이가 있어야 youtube가 되는데
 *   손잡이는 무대가 서야 생긴다 — 그래서 **목록 큐가 잡힌 순간**부터 세운다.
 * - 빈 플레이어는 `onReady`를 영영 보내지 않으므로(YoutubeStage 주석) 반드시 실제 ID로 세운다.
 *   지금 곡에 ID가 없으면(미리듣기로 떨어진 곡) 목록에서 ID 있는 아무 곡이나 씨앗으로 쓴다 —
 *   목적은 무대를 세우는 것이고, 실제로 틀 영상은 Provider가 load()로 갈아 끼운다.
 */
export function stageSeed(
  q: { mode?: "playlist" | "browse"; songs: { id: number; youtubeVideoId?: string | null }[] } | null,
  engine: Engine | null,
  playingId: number | null,
): string | null {
  if (!q) return null;
  if (engine !== "youtube" && q.mode !== "playlist") return null;
  const current = playingId === null ? undefined : q.songs.find((s) => s.id === playingId);
  return current?.youtubeVideoId ?? q.songs.find((s) => s.youtubeVideoId)?.youtubeVideoId ?? null;
}

/**
 * 목록에 곡을 새로 담을 때 줄 position.
 * 곡을 빼면 구멍이 생기므로 길이가 아니라 최대값 기준으로 매긴다.
 */
export function nextPosition(existing: number[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing) + 1;
}
