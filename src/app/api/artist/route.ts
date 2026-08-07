import { NextResponse } from "next/server";
import { getArtistInfo } from "@/server/artist-info";

export const dynamic = "force-dynamic";

/**
 * GET /api/artist?name=BLACKPINK
 * 가수 정보를 MusicBrainz API(CC0)에서 찾아 DB에 캐시하고 반환한다.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const name = new URL(req.url).searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ error: "name이 필요합니다" }, { status: 400 });
  }
  return NextResponse.json(await getArtistInfo(name));
}
