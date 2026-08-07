import { eq } from "drizzle-orm";
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
