import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/config/env";

/**
 * 곡의 YouTube 영상 ID 조회 — 원본은 YouTube Data API, songs 테이블에 캐시 (docs/SSOT.md).
 *
 * 참고: iframe의 listType=search 임베드는 2020년에 제거되어 쓸 수 없다.
 * Data API 검색은 무료 쿼터가 하루 1만 유닛(검색 1회 = 100유닛 = 하루 100곡)이라
 * 곡당 1회만 검색하고 영구 캐시한다. 키가 없으면 null (호출부에서 검색 링크 폴백).
 */
export async function getYoutubeVideoId(songId: number): Promise<string | null> {
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
