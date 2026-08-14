import { NextResponse } from "next/server";
import { quickSearchSongs } from "@/server/song-search";

export const dynamic = "force-dynamic";

/** GET /api/search?q= — 은하 하단 검색창의 빠른 검색 (매칭 규칙: server/song-search.ts) */
export async function GET(req: Request): Promise<NextResponse> {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ songs: [] });
  return NextResponse.json(
    { songs: await quickSearchSongs(q) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
