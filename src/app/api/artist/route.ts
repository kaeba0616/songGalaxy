import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/artist?name=BLACKPINK
 * 가수 정보를 MusicBrainz API(CC0)에서 찾아 DB에 캐시하고 반환한다.
 * MusicBrainz 레이트리밋(초당 1회)을 존중하기 위해 이름당 1회만 외부 호출한다.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const name = new URL(req.url).searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ error: "name이 필요합니다" }, { status: 400 });
  }

  const cached = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.name, name));
  if (cached.length > 0) {
    return NextResponse.json(cached[0]);
  }

  let info: typeof schema.artists.$inferInsert = { name, type: null, country: null, beginYear: null, tags: null };
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
      return NextResponse.json(info);
    }
    {
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
      // 검색 점수가 낮으면 동명이인 오매칭 가능성이 높아 버린다
      if (hit && (hit.score ?? 0) >= 85) {
        info = {
          name,
          type: hit.type ?? null,
          country: hit.country ?? null,
          beginYear: hit["life-span"]?.begin?.slice(0, 4) ?? null,
          tags: hit.tags?.slice(0, 5).map((t) => t.name) ?? null,
        };
      }
    }
  } catch {
    // 실패 시 빈 정보를 캐시하지 않고 그대로 반환 → 다음 요청에서 재시도
    return NextResponse.json(info);
  }

  await db.insert(schema.artists).values(info).onConflictDoNothing();
  return NextResponse.json(info);
}
