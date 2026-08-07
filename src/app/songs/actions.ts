"use server";

import { redirect } from "next/navigation";
import { importFromItunes } from "@/server/import-song";

/** "은하에 추가" 버튼 — iTunes 곡을 편입하고 상세 페이지로 이동 */
export async function importSongAction(formData: FormData): Promise<void> {
  const itunesId = Number(formData.get("itunesId"));
  if (!Number.isInteger(itunesId) || itunesId <= 0) return;
  const songId = await importFromItunes(itunesId);
  if (songId) redirect(`/songs/${songId}?imported=1`);
}
