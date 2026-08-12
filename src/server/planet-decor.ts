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

/**
 * 꾸미기를 켜거나 끈다. "뒤집기"가 아니라 **원하는 상태를 받는다** —
 * 뒤집기로 만들면 칩을 빠르게 두 번 누를 때 먼저 도착한 요청이 지우고
 * 나중 요청이 "없으니 넣자"로 되살려, 끄려던 것이 켜진 채 남는다.
 * 같은 요청이 몇 번 가도 결과가 같아야 한다.
 */
export async function setPlanetDecor(userId: number, slug: string, on: boolean): Promise<void> {
  if (!isDecorSlug(slug)) return;
  if (on) {
    await db
      .insert(schema.planetDecor)
      .values({ userId, slug })
      .onConflictDoNothing({ target: [schema.planetDecor.userId, schema.planetDecor.slug] });
    return;
  }
  await db
    .delete(schema.planetDecor)
    .where(and(eq(schema.planetDecor.userId, userId), eq(schema.planetDecor.slug, slug)));
}
