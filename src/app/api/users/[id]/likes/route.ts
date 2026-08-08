import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/[id]/likes — 그 유저의 좋아요 곡 id 전체 목록, 최근 순 (이슈 #9).
 * 행성 착륙 밤하늘용. 기본 공개(D15). 처음엔 최근 20곡 제한(D16)이었지만
 * "좋아요를 누른 별들을 다 볼 수 있게" 피드백으로 전체 표시로 변경.
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
    .orderBy(desc(schema.likes.createdAt));
  return NextResponse.json(
    { songIds: rows.map((r) => r.songId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
