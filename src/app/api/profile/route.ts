import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSessionUser } from "@/auth";
import { BIO_MAX, NICKNAME_MAX } from "@/config/constants";

export const dynamic = "force-dynamic";

/** GET /api/profile — 내 프로필 + 대표곡 선택용 좋아요 곡 목록 (드로어 편집 폼 전용) */
export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const [[me], likedSongs] = await Promise.all([
    db
      .select({
        nickname: schema.users.nickname,
        bio: schema.users.bio,
        pinnedSongId: schema.users.pinnedSongId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id)),
    db
      .select({
        id: schema.songs.id,
        title: schema.songs.title,
        artist: schema.songs.artist,
      })
      .from(schema.likes)
      .innerJoin(schema.songs, eq(schema.likes.songId, schema.songs.id))
      .where(eq(schema.likes.userId, user.id))
      .orderBy(desc(schema.likes.createdAt)),
  ]);
  if (!me) return NextResponse.json({ error: "유저가 없습니다" }, { status: 404 });
  return NextResponse.json({ ...me, likedSongs }, { headers: { "Cache-Control": "no-store" } });
}

/** PATCH /api/profile { nickname?, bio?, pinnedSongId? } — 행성 프로필 편집 */
export async function PATCH(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    nickname?: unknown;
    bio?: unknown;
    pinnedSongId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  const updates: Partial<{ nickname: string; bio: string | null; pinnedSongId: number | null }> =
    {};

  if (body.nickname !== undefined) {
    const nickname = String(body.nickname).trim();
    if (nickname.length < 1 || nickname.length > NICKNAME_MAX) {
      return NextResponse.json(
        { error: `닉네임은 1~${NICKNAME_MAX}자여야 해요` },
        { status: 400 },
      );
    }
    updates.nickname = nickname;
  }

  if (body.bio !== undefined) {
    const bio = String(body.bio).trim();
    if (bio.length > BIO_MAX) {
      return NextResponse.json({ error: `소개글은 ${BIO_MAX}자까지예요` }, { status: 400 });
    }
    updates.bio = bio.length === 0 ? null : bio;
  }

  if (body.pinnedSongId !== undefined) {
    if (body.pinnedSongId === null || body.pinnedSongId === "") {
      updates.pinnedSongId = null;
    } else {
      const songId = Number(body.pinnedSongId);
      if (!Number.isInteger(songId)) {
        return NextResponse.json({ error: "잘못된 대표곡" }, { status: 400 });
      }
      // 대표곡은 내 좋아요 중에서만 고를 수 있다
      const likedRows = await db
        .select({ songId: schema.likes.songId })
        .from(schema.likes)
        .where(eq(schema.likes.userId, user.id));
      if (!likedRows.some((r) => r.songId === songId)) {
        return NextResponse.json(
          { error: "대표곡은 좋아요한 곡 중에서 골라주세요" },
          { status: 400 },
        );
      }
      updates.pinnedSongId = songId;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "바꿀 내용이 없어요" }, { status: 400 });
  }
  const [updated] = await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, user.id))
    .returning({
      nickname: schema.users.nickname,
      bio: schema.users.bio,
      pinnedSongId: schema.users.pinnedSongId,
    });
  return NextResponse.json(updated);
}
