import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSessionUser } from "@/auth";
import { getLikeState, setLike } from "@/server/likes";

export const dynamic = "force-dynamic";

/** GET /api/likes — 로그인 상태 + 좋아요 목록 + 내 별 (클라이언트 상태의 단일 출처) */
export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ authenticated: false });
  // 닉네임은 세션 JWT가 아니라 DB가 원본 — 프로필 편집 직후에도 신선하게
  const [[me], state] = await Promise.all([
    db
      .select({ nickname: schema.users.nickname, bio: schema.users.bio })
      .from(schema.users)
      .where(eq(schema.users.id, user.id)),
    getLikeState(user.id),
  ]);
  return NextResponse.json({
    authenticated: true,
    userId: user.id,
    nickname: me?.nickname ?? user.nickname,
    bio: me?.bio ?? null,
    ...state,
  });
}

/** POST /api/likes { songId, liked } — 좋아요 토글 + 별 즉시 재계산 */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { songId?: unknown; liked?: unknown } | null;
  const songId = Number(body?.songId);
  const liked = Boolean(body?.liked);
  if (!Number.isInteger(songId)) {
    return NextResponse.json({ error: "songId가 필요합니다" }, { status: 400 });
  }
  const [song] = await db
    .select({ id: schema.songs.id })
    .from(schema.songs)
    .where(eq(schema.songs.id, songId));
  if (!song) {
    return NextResponse.json({ error: "곡이 없습니다" }, { status: 404 });
  }
  const result = await setLike(user.id, songId, liked);
  return NextResponse.json(result);
}
