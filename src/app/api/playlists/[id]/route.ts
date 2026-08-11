import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import {
  deletePlaylist,
  findMyPlaylist,
  normalizeName,
  renamePlaylist,
  setPlaylistShared,
} from "@/server/playlists";

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

  // 소유권은 여기서 한 번만 검사하고 두 분기에서 재사용한다 — shared만 온 요청이
  // 소유권 검사를 건너뛰어 남의 목록에 200을 돌려주던 문제를 막기 위함
  const mine = await findMyPlaylist(user.id, id);
  if (!mine) return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });

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

  // 이름만 바뀐 요청이라도 응답에는 실제 현재 공유 상태를 실어 보낸다 —
  // 항상 null을 돌려주면 클라이언트가 이름을 바꿨을 뿐인데 공유가 꺼진 것으로 오해한다
  let shareSlug: string | null = mine.shareSlug;
  if (body?.shared !== undefined) {
    const result = await setPlaylistShared(user.id, id, Boolean(body.shared));
    if (!result.ok) return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
    shareSlug = result.shareSlug;
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
