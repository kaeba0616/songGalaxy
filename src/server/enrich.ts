import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export interface Media {
  artworkUrl: string | null;
  previewUrl: string | null;
}

/**
 * 앨범아트/30초 미리듣기 조회 — 원본은 iTunes Search API, songs 테이블에 캐시 (docs/SSOT.md).
 * /api/enrich 라우트와 곡 상세 페이지가 공용으로 사용한다.
 * 이미 조회한 곡(enrichedAt 존재)은 외부 호출 없이 캐시로 응답한다.
 */
export async function enrichSongs(ids: number[]): Promise<Record<number, Media>> {
  if (ids.length === 0) return {};
  const rows = await db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.songs.artist,
      artworkUrl: schema.songs.artworkUrl,
      previewUrl: schema.songs.previewUrl,
      enrichedAt: schema.songs.enrichedAt,
    })
    .from(schema.songs)
    .where(inArray(schema.songs.id, ids));

  const result: Record<number, Media> = {};
  for (const row of rows) {
    if (row.enrichedAt) {
      result[row.id] = { artworkUrl: row.artworkUrl, previewUrl: row.previewUrl };
      continue;
    }
    let artworkUrl: string | null = null;
    let previewUrl: string | null = null;
    try {
      const term = encodeURIComponent(`${row.title} ${row.artist}`);
      const res = await fetch(
        `https://itunes.apple.com/search?term=${term}&entity=song&limit=1&country=KR`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          results?: { artworkUrl100?: string; previewUrl?: string }[];
        };
        const hit = data.results?.[0];
        // 100px 아트워크 URL을 300px로 승격 (iTunes URL 규칙)
        artworkUrl = hit?.artworkUrl100?.replace("100x100", "300x300") ?? null;
        previewUrl = hit?.previewUrl ?? null;
      }
    } catch {
      // 외부 API 실패는 무시 — enrichedAt을 기록하지 않아 다음에 재시도된다
      result[row.id] = { artworkUrl: null, previewUrl: null };
      continue;
    }
    await db
      .update(schema.songs)
      .set({ artworkUrl, previewUrl, enrichedAt: new Date() })
      .where(inArray(schema.songs.id, [row.id]));
    result[row.id] = { artworkUrl, previewUrl };
  }
  return result;
}
