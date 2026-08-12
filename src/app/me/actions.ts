"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSessionUser } from "@/auth";
import { PLANET_THEMES } from "@/config/planet-themes";
import { setPlanetDecor } from "@/server/planet-decor";

/** 행성 테마 변경 (이슈 #10 꾸미기 맛보기) — 방문자에게도 이 테마로 보인다 */
export async function setPlanetThemeAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const theme = String(formData.get("theme") ?? "");
  if (!PLANET_THEMES.some((t) => t.slug === theme)) return;
  await db.update(schema.users).set({ planetTheme: theme }).where(eq(schema.users.id, user.id));
  revalidatePath("/me");
}

/**
 * 꾸미기 오브젝트 켜고 끄기.
 * 대상 유저는 세션에서만 가져온다 — 폼에서 user id를 받으면 남의 행성을 꾸밀 수 있다.
 * 폼이 "뒤집어라"가 아니라 **원하는 상태**를 보낸다 — 뒤집기로 만들면 칩을 빠르게
 * 두 번 누를 때 먼저 온 요청이 지우고 나중 요청이 되살려 끄려던 것이 켜진 채 남는다.
 */
export async function setPlanetDecorAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  await setPlanetDecor(user.id, String(formData.get("slug") ?? ""), formData.get("on") === "1");
  revalidatePath("/me");
}
