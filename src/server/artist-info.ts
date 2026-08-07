import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type ArtistInfo = typeof schema.artists.$inferSelect;

/**
 * 가수 정보 조회 — 원본은 MusicBrainz API(CC0), artists 테이블에 캐시 (docs/SSOT.md).
 * /api/artist 라우트와 곡 상세 페이지가 공용으로 사용한다.
 */
export async function getArtistInfo(name: string): Promise<ArtistInfo> {
  const cached = await db.select().from(schema.artists).where(eq(schema.artists.name, name));
  if (cached.length > 0) return cached[0];

  const empty: typeof schema.artists.$inferInsert = {
    name,
    type: null,
    country: null,
    beginYear: null,
    tags: null,
  };
  try {
    const res = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(name)}&fmt=json&limit=1`,
      {
        headers: { "User-Agent": "songGalaxy/0.1 (https://github.com/kaeba0616/songGalaxy)" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      // 레이트리밋/일시 오류 — 캐시하지 않고 반환해서 다음 요청 때 재시도
      return { ...empty, checkedAt: new Date() } as ArtistInfo;
    }
    const data = (await res.json()) as {
      artists?: {
        name: string;
        type?: string;
        country?: string;
        "life-span"?: { begin?: string };
        tags?: { name: string }[];
        score?: number;
      }[];
    };
    const hit = data.artists?.[0];
    const info: typeof schema.artists.$inferInsert =
      hit && (hit.score ?? 0) >= 85
        ? {
            name,
            type: hit.type ?? null,
            country: hit.country ?? null,
            beginYear: hit["life-span"]?.begin?.slice(0, 4) ?? null,
            tags: hit.tags?.slice(0, 5).map((t) => t.name) ?? null,
          }
        : empty;
    await db.insert(schema.artists).values(info).onConflictDoNothing();
    return { ...info, checkedAt: new Date() } as ArtistInfo;
  } catch {
    return { ...empty, checkedAt: new Date() } as ArtistInfo;
  }
}
