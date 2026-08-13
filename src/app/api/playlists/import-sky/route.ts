import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { importUserSky } from "@/server/playlists";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/import-sky { fromUserId } — 그 사람의 밤하늘(좋아요 곡)을
 * 내 새 목록으로 가져온다. 행성 계정 메뉴의 "이 행성 플리 가져오기"가 쓴다.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { fromUserId?: unknown } | null;
  const fromUserId = Number(body?.fromUserId);
  if (!Number.isInteger(fromUserId) || fromUserId <= 0) {
    return NextResponse.json({ error: "fromUserId가 필요합니다" }, { status: 400 });
  }
  const result = await importUserSky(user.id, fromUserId);
  if (result === "empty") {
    return NextResponse.json({ error: "가져올 곡이 없습니다" }, { status: 404 });
  }
  return NextResponse.json(result);
}
