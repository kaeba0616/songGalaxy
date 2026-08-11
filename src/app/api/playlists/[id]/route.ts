import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { deletePlaylist, normalizeName, renamePlaylist, setPlaylistShared } from "@/server/playlists";

export const dynamic = "force-dynamic";

/** PATCH /api/playlists/[id] { name? , shared? } — 이름 변경 / 공유 켜고 끄기 */
export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; shared?: unknown }
    | null;

  if (body?.name !== undefined) {
    const name = normalizeName(body.name);
    if (!name) return NextResponse.json({ error: "목록 이름이 필요합니다" }, { status: 400 });
    if (!(await renamePlaylist(user.id, id, name))) {
      return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
    }
  }

  let shareSlug: string | null = null;
  if (body?.shared !== undefined) {
    shareSlug = await setPlaylistShared(user.id, id, Boolean(body.shared));
  }
  return NextResponse.json({ ok: true, shareSlug });
}

/** DELETE /api/playlists/[id] — 목록 삭제 */
export async function DELETE(
  _req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  if (!(await deletePlaylist(user.id, id))) {
    return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
