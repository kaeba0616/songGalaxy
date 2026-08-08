import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { GalaxyStar } from "@/galaxy/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/stars — 은하 주민(유저 별) 목록.
 * 곡 페이로드(/api/galaxy)는 1시간 CDN 캐시가 걸려 있어 별을 함께 실으면
 * 방금 태어난 별이 안 보이는 문제가 생긴다 → 별은 항상 신선하게 따로 내려준다.
 */
export async function GET(): Promise<NextResponse> {
  const stars: GalaxyStar[] = await db
    .select({
      userId: schema.userStars.userId,
      x: schema.userStars.posX,
      y: schema.userStars.posY,
      z: schema.userStars.posZ,
      nickname: schema.users.nickname,
    })
    .from(schema.userStars)
    .innerJoin(schema.users, eq(schema.users.id, schema.userStars.userId));
  return NextResponse.json(stars, {
    headers: { "Cache-Control": "no-store" },
  });
}
