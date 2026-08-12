/**
 * 행성 꾸미기 저장 — 켜고 끄는 것뿐이다.
 * 무엇이 있는지(카탈로그)와 어디에 놓이는지(자리)는 src/config/planet-decor.ts가 원본이다.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isDecorSlug } from "@/config/planet-decor";

/** 그 사람이 켜 둔 slug들 (카탈로그에 없는 것은 걸러 낸다) */
export async function listPlanetDecor(userId: number): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.planetDecor.slug })
    .from(schema.planetDecor)
    .where(eq(schema.planetDecor.userId, userId));
  // 카탈로그에서 뺀 항목이 저장에 남아 있을 수 있다 — 지우지 않고 읽을 때만 거른다
  return rows.map((r) => r.slug).filter(isDecorSlug);
}

/** 켜고 끄기. 켜졌으면 true. 카탈로그에 없는 slug는 아무 일도 하지 않고 false */
export async function togglePlanetDecor(userId: number, slug: string): Promise<boolean> {
  if (!isDecorSlug(slug)) return false;
  const deleted = await db
    .delete(schema.planetDecor)
    .where(and(eq(schema.planetDecor.userId, userId), eq(schema.planetDecor.slug, slug)))
    .returning({ slug: schema.planetDecor.slug });
  if (deleted.length > 0) return false; // 켜져 있던 것을 껐다
  await db.insert(schema.planetDecor).values({ userId, slug }).onConflictDoNothing();
  return true;
}
