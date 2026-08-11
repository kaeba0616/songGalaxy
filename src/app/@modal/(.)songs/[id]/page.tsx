import RouteOverlay from "@/components/RouteOverlay";
import SongDetailPage from "@/app/songs/[id]/page";

export const dynamic = "force-dynamic";

/**
 * 은하(또는 겹쳐 띄운 곡 목록)에서 곡 상세로 갈 때 가로채 은하 위에 겹쳐 띄운다.
 * 페이지 본문은 원래 것을 그대로 쓴다 — 두 벌로 나누면 반드시 어긋난다.
 */
export default function SongDetailModal(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <RouteOverlay>
      <SongDetailPage params={props.params} />
    </RouteOverlay>
  );
}
