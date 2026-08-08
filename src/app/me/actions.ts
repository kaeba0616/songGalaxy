"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSessionUser } from "@/auth";
import { PLANET_THEMES } from "@/config/planet-themes";

/** 행성 테마 변경 (이슈 #10 꾸미기 맛보기) — 방문자에게도 이 테마로 보인다 */
export async function setPlanetThemeAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const theme = String(formData.get("theme") ?? "");
  if (!PLANET_THEMES.some((t) => t.slug === theme)) return;
  await db.update(schema.users).set({ planetTheme: theme }).where(eq(schema.users.id, user.id));
  revalidatePath("/me");
}
