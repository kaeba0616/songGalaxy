import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { clearYoutubeVideoId } from "@/server/youtube";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/songs/[id]/video { videoId } — 재생이 거부된 영상 ID를 캐시에서 지운다.
 *
 * 알약의 영상 무대가 임베드 거부(101·150)나 없는 영상(100)을 만났을 때 부른다.
 * 검사 시각은 남으므로 다시 검색되지 않는다(쿼터 보호) — 그 곡은 미리듣기로 재생된다.
 *
 * 로그인을 요구한다: 지운 ID는 다시 찾지 않으므로, 아무나 부를 수 있으면 남의 곡들을
 * 영구히 미리듣기로 떨어뜨리는 데 쓰일 수 있다. 비로그인 열람자(공유 링크)는
 * 서버 캐시를 건드리지 않고 그 자리에서 미리듣기로만 넘어간다.
 * 넘겨받은 videoId가 지금 캐시에 든 값과 같을 때만 지운다(경합 보호는 server/youtube.ts).
 */
export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const songId = Number((await props.params).id);
  const body = (await req.json().catch(() => null)) as { videoId?: unknown } | null;
  const videoId = typeof body?.videoId === "string" ? body.videoId : null;
  if (!Number.isInteger(songId) || !videoId) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  return NextResponse.json({ cleared: await clearYoutubeVideoId(songId, videoId) });
}
