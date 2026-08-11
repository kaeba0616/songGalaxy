import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { YOUTUBE_LOOKUPS_PER_USER_PER_DAY } from "@/config/constants";
import { env } from "@/config/env";

/**
 * 오늘 몫의 검색 1회를 선점한다 — 통과하면 true, 한도를 다 썼으면 false.
 *
 * 세 가지를 한꺼번에 막는다.
 * ① 되돌릴 수 없다: 목록 곡을 세는 게 아니라 전용 행을 올리므로 곡을 빼도 줄지 않는다.
 * ② 실패도 센다: 호출부가 fetch 직전에 부르고, 403·타임아웃이어도 되돌리지 않는다
 *    (실패한 호출도 쿼터를 먹는다).
 * ③ 동시 요청이 함께 통과하지 못한다: 예전엔 "읽고 → 조회"라 N개가 같은 값을 읽고 전부
 *    통과했다. 증가와 검사를 UPSERT 한 문장에 묶어 두면 같은 행을 노리는 요청들이 DB에서
 *    줄을 서고, 한도를 넘긴 쪽은 갱신 대상에서 빠져 아무 행도 돌려받지 못한다.
 */
async function reserveLookup(userId: number): Promise<boolean> {
  if (YOUTUBE_LOOKUPS_PER_USER_PER_DAY <= 0) return false; // 한도 0이면 INSERT 분기가 1을 통과시킨다
  const rows = await db
    .insert(schema.youtubeLookups)
    .values({ userId, day: sql`(now() at time zone 'utc')::date`, count: 1 })
    .onConflictDoUpdate({
      target: [schema.youtubeLookups.userId, schema.youtubeLookups.day],
      set: { count: sql`${schema.youtubeLookups.count} + 1` },
      setWhere: sql`${schema.youtubeLookups.count} < ${YOUTUBE_LOOKUPS_PER_USER_PER_DAY}`,
    })
    .returning({ count: schema.youtubeLookups.count });
  return rows.length > 0;
}

/**
 * 곡의 YouTube 영상 ID 조회 — 원본은 YouTube Data API, songs 테이블에 캐시 (docs/SSOT.md).
 *
 * 참고: iframe의 listType=search 임베드는 2020년에 제거되어 쓸 수 없다.
 * Data API 검색은 무료 쿼터가 하루 1만 유닛(검색 1회 = 100유닛 = 하루 100곡)이라
 * 곡당 1회만 검색하고 영구 캐시한다. 키가 없으면 null (호출부에서 검색 링크 폴백).
 *
 * `userId`는 이 조회의 값을 치를 사람이다 — 한 사람이 서비스 전체 쿼터를 말리지 못하도록
 * 여기서(=실제로 외부 호출이 나가는 유일한 지점) 하루 한도를 선점한다. 호출부에서 미리
 * 세던 예전 방식은 캐시 적중까지 한도를 깎거나, 검사와 소비 사이가 벌어져 새어 나갔다.
 */
export async function getYoutubeVideoId(songId: number, userId: number): Promise<string | null> {
  const [song] = await db
    .select({
      title: schema.songs.title,
      artist: schema.songs.artist,
      youtubeVideoId: schema.songs.youtubeVideoId,
      youtubeCheckedAt: schema.songs.youtubeCheckedAt,
    })
    .from(schema.songs)
    .where(eq(schema.songs.id, songId));
  if (!song) return null;
  if (song.youtubeCheckedAt) return song.youtubeVideoId;

  const key = env.youtubeApiKey;
  if (!key) return null; // 키가 없으면 checked를 기록하지 않는다 — 키 설정 후 다시 시도되게

  // 여기부터가 쿼터를 태우는 구간이다. 캐시 적중(위)과 키 없음은 한 유닛도 쓰지 않으므로
  // 한도를 깎지 않는다 — 이미 찾아둔 곡을 담는 것만으로 한도가 마르면 안 된다
  if (!(await reserveLookup(userId))) return null;

  let videoId: string | null = null;
  try {
    const params = new URLSearchParams({
      part: "snippet",
      q: `${song.title} ${song.artist}`,
      type: "video",
      maxResults: "1",
      videoEmbeddable: "true",
      key,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      // 쿼터 초과(403) 등 — 캐시하지 않고 다음에 재시도
      return null;
    }
    const data = (await res.json()) as { items?: { id?: { videoId?: string } }[] };
    videoId = data.items?.[0]?.id?.videoId ?? null;
  } catch {
    return null;
  }

  await db
    .update(schema.songs)
    .set({ youtubeVideoId: videoId, youtubeCheckedAt: new Date() })
    .where(eq(schema.songs.id, songId));
  return videoId;
}

/**
 * 재생이 거부된 영상 ID를 캐시에서 지운다 (임베드 차단·삭제된 영상).
 *
 * `youtube_checked_at`은 반드시 남긴다 — "확인했고 쓸 수 있는 영상이 없다"는 뜻이라
 * 다시 검색하면 같은 영상을 또 찾아오면서 쿼터만 태운다(검색에 videoEmbeddable=true가
 * 이미 걸려 있어 드문 경우다). 설계: 2026-08-11-playlists-youtube-design.md "오류 처리".
 *
 * 지금 캐시에 든 ID와 같을 때만 지운다 — 늦게 도착한 옛 실패 보고가 그 사이에
 * 새로 찾아 넣은 ID를 대신 날리면 안 된다.
 */
export async function clearYoutubeVideoId(songId: number, videoId: string): Promise<boolean> {
  const rows = await db
    .update(schema.songs)
    .set({
      youtubeVideoId: null,
      // 검사 시각이 비어 있던 예외적인 행도 여기서 못 박아 재검색을 막는다
      youtubeCheckedAt: sql`coalesce(${schema.songs.youtubeCheckedAt}, now())`,
    })
    .where(and(eq(schema.songs.id, songId), eq(schema.songs.youtubeVideoId, videoId)))
    .returning({ id: schema.songs.id });
  return rows.length > 0;
}
