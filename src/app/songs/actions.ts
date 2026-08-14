"use server";

import { redirect, RedirectType } from "next/navigation";
import { importFromItunes } from "@/server/import-song";

/**
 * "은하에 추가" 버튼 — iTunes 곡을 편입한 뒤 검색 화면으로 돌아온다.
 * 돌아온 화면에서 그 곡의 버튼이 "추가했어요 →"(상세 링크)로 바뀐다.
 */
export async function importSongAction(formData: FormData): Promise<void> {
  const itunesId = Number(formData.get("itunesId"));
  if (!Number.isInteger(itunesId) || itunesId <= 0) return;
  let songId: number | null = null;
  try {
    songId = await importFromItunes(itunesId);
  } catch {
    // 외부 API 실패 — 아래에서 importError로 안내
  }
  // 현재 검색 상태를 유지한 채 복귀 (+ 방금 추가한 곡 표시, 외부 검색 섹션으로 스크롤)
  const sp = new URLSearchParams();
  for (const key of ["q", "field", "cluster", "genre", "sort", "page"] as const) {
    const value = formData.get(key);
    if (typeof value === "string" && value) sp.set(key, value);
  }
  if (songId) sp.set("added", String(songId));
  else sp.set("importError", "1");
  // replace — 편입은 같은 검색 화면의 상태 갱신이지 새 목적지가 아니다.
  // push(기본값)면 "은하에 추가"를 누른 횟수만큼 히스토리가 쌓여, 겹쳐 띄운
  // 화면의 ✕(뒤로 한 칸)를 그만큼 눌러야 은하로 나온다 (페이지네이션과 같은 병)
  redirect(`/songs?${sp.toString()}#external`, RedirectType.replace);
}
