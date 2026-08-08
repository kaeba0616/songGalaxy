"use server";

import { redirect } from "next/navigation";
import { importFromItunes } from "@/server/import-song";

/**
 * "은하에 추가" 버튼 — iTunes 곡을 편입한 뒤 검색 화면으로 돌아온다.
 * 돌아온 화면에서 그 곡의 버튼이 "추가했어요 →"(상세 링크)로 바뀐다.
 */
export async function importSongAction(formData: FormData): Promise<void> {
  const itunesId = Number(formData.get("itunesId"));
  if (!Number.isInteger(itunesId) || itunesId <= 0) return;
  const songId = await importFromItunes(itunesId);
  if (!songId) return;
  // 현재 검색 상태를 유지한 채 복귀 (+ 방금 추가한 곡 표시, 외부 검색 섹션으로 스크롤)
  const sp = new URLSearchParams();
  for (const key of ["q", "field", "cluster", "genre", "sort", "page"] as const) {
    const value = formData.get(key);
    if (typeof value === "string" && value) sp.set(key, value);
  }
  sp.set("added", String(songId));
  redirect(`/songs?${sp.toString()}#external`);
}
