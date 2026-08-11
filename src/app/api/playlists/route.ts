import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { createPlaylist, listMyPlaylists, normalizeName } from "@/server/playlists";

export const dynamic = "force-dynamic";

/** GET /api/playlists — 내 목록 (알약의 담기 팝오버가 쓴다) */
export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ authenticated: false, playlists: [] });
  return NextResponse.json({ authenticated: true, playlists: await listMyPlaylists(user.id) });
}

/** POST /api/playlists { name } — 목록 생성 */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = normalizeName(body?.name);
  if (!name) return NextResponse.json({ error: "목록 이름이 필요합니다" }, { status: 400 });
  return NextResponse.json({ playlist: await createPlaylist(user.id, name) });
}
