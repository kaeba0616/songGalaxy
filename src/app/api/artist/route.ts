import { NextResponse } from "next/server";
import { getArtistInfo } from "@/server/artist-info";

export const dynamic = "force-dynamic";

/**
 * GET /api/artist?name=BLACKPINK&genre=k-pop
 * 가수 정보를 MusicBrainz API(CC0)에서 찾아 DB에 캐시하고 반환한다.
 * genre는 동명이인 판별 힌트 (곡의 장르).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name")?.trim();
  const genre = url.searchParams.get("genre")?.trim() || undefined;
  if (!name) {
    return NextResponse.json({ error: "name이 필요합니다" }, { status: 400 });
  }
  return NextResponse.json(await getArtistInfo(name, genre));
}
