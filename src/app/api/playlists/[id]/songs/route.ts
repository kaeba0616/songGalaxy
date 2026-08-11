import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { addSongToPlaylist, removeSongFromPlaylist } from "@/server/playlists";

export const dynamic = "force-dynamic";

async function parse(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<{ playlistId: number; songId: number } | null> {
  const playlistId = Number((await props.params).id);
  const body = (await req.json().catch(() => null)) as { songId?: unknown } | null;
  const songId = Number(body?.songId);
  if (!Number.isInteger(playlistId) || !Number.isInteger(songId)) return null;
  return { playlistId, songId };
}

/** POST /api/playlists/[id]/songs { songId } — 곡 담기 */
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const p = await parse(req, props);
  if (!p) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  const result = await addSongToPlaylist(user.id, p.playlistId, p.songId);
  if (result === "forbidden") {
    return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
  }
  if (result === "nosong") {
    return NextResponse.json({ error: "존재하지 않는 곡입니다" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, already: result === "already" });
}

/** DELETE /api/playlists/[id]/songs { songId } — 곡 빼기 */
export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const p = await parse(req, props);
  if (!p) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  if (!(await removeSongFromPlaylist(user.id, p.playlistId, p.songId))) {
    return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
