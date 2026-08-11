import RouteOverlay from "@/components/RouteOverlay";
import CreditsPage from "@/app/credits/page";

/**
 * 은하에서 데이터 출처로 이동할 때 가로채 은하 위에 겹쳐 띄운다.
 * 페이지 본문은 원래 것을 그대로 쓴다 — 두 벌로 나누면 반드시 어긋난다.
 */
export default function CreditsModal() {
  return (
    <RouteOverlay>
      <CreditsPage />
    </RouteOverlay>
  );
}
