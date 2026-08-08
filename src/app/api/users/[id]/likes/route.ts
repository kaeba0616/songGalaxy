import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { NIGHT_SKY_SONG_LIMIT } from "@/config/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/[id]/likes — 그 유저의 최근 좋아요 곡 id 목록 (이슈 #9).
 * 행성 착륙 밤하늘용. 기본 공개(D15), 최근 NIGHT_SKY_SONG_LIMIT곡(D16).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "잘못된 사용자 id" }, { status: 400 });
  }
  const rows = await db
    .select({ songId: schema.likes.songId })
    .from(schema.likes)
    .where(eq(schema.likes.userId, userId))
    .orderBy(desc(schema.likes.createdAt))
    .limit(NIGHT_SKY_SONG_LIMIT);
  return NextResponse.json(
    { songIds: rows.map((r) => r.songId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
