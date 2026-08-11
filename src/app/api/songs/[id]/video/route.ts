import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { songInUsersPlaylist } from "@/server/playlists";
import { clearYoutubeVideoId } from "@/server/youtube";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/songs/[id]/video { videoId } — 재생이 거부된 영상 ID를 캐시에서 지운다.
 *
 * 알약의 영상 무대가 임베드 거부(101·150)나 없는 영상(100)을 만났을 때 부른다.
 * 검사 시각은 남으므로 다시 검색되지 않는다(쿼터 보호) — 그 곡은 미리듣기로 재생된다.
 *
 * 로그인만으로는 부족하다: 지운 ID는 다시 찾지 않으므로(재검색 경로 없음), 로그인한
 * 아무 계정이나 부를 수 있으면 공개 `/songs/[id]` 페이지 HTML에 노출된 캐시 ID를 긁어
 * 사이트 전체를 영구히 미리듣기로 떨어뜨리는 데 쓸 수 있다. 그래서 신고자가 자기 목록에
 * 이 곡을 담고 있을 때만 받아준다 — "영상이 안 튼다"고 신고할 수 있는 사람은 실제로 그
 * 곡을 담아 재생을 시도한 사람뿐이라는 뜻이다. 목록에 없으면 403 — 공유 목록을 보기만
 * 하는 비소유자는 어차피 클라이언트가 그 자리에서 미리듣기로 넘어가므로 해가 없다.
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

  if (!(await songInUsersPlaylist(user.id, songId))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  return NextResponse.json({ cleared: await clearYoutubeVideoId(songId, videoId) });
}
