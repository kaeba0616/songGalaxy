import RouteOverlay from "@/components/RouteOverlay";
import SongsPage from "@/app/songs/page";

export const dynamic = "force-dynamic";

/**
 * 은하에서 곡 목록으로 이동할 때 가로채 은하 위에 겹쳐 띄운다.
 * 페이지 본문은 원래 것을 그대로 쓴다 — 두 벌로 나누면 반드시 어긋난다.
 */
export default function SongsModal(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <RouteOverlay>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- 원본 페이지의 searchParams 타입을 그대로 넘긴다 */}
      <SongsPage searchParams={props.searchParams as any} />
    </RouteOverlay>
  );
}
