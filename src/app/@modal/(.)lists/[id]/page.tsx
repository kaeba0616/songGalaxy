import RouteOverlay from "@/components/RouteOverlay";
import PlaylistDetailPage from "@/app/lists/[id]/page";

export const dynamic = "force-dynamic";

/**
 * 은하에서 목록 상세로 이동할 때 가로채 은하 위에 겹쳐 띄운다.
 * 페이지 본문은 원래 것을 그대로 쓴다 — 두 벌로 나누면 반드시 어긋난다.
 */
export default function PlaylistDetailModal(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <RouteOverlay>
      <PlaylistDetailPage params={props.params} />
    </RouteOverlay>
  );
}
