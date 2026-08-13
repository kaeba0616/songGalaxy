import RouteOverlay from "@/components/RouteOverlay";
import PlanetListPage from "@/app/planet/[id]/list/page";

export const dynamic = "force-dynamic";

/** 행성에서 플리 보기로 이동할 때 가로채 은하 위에 겹쳐 띄운다 — 본문은 원본 그대로 */
export default function PlanetListModal(props: { params: Promise<{ id: string }> }) {
  return (
    <RouteOverlay>
      <PlanetListPage params={props.params} />
    </RouteOverlay>
  );
}
