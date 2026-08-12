"use client";

/**
 * "은하로 돌아가기" — 놓인 자리에 따라 다르게 동작해야 하는 링크.
 *
 * **겹쳐 띄운 화면에서는 아무것도 그리지 않는다.** 그때는 `RouteOverlay`의 ✕가
 * 우측 상단에 이미 떠 있고 하는 일도 똑같아서(뒤로 가기) 출구가 둘로 보인다.
 * 독립 페이지(주소로 직접 열기·새로고침·공유 링크)에는 ✕가 없으므로 이 링크가
 * 유일한 출구다 — 그래서 통째로 지우지 않고 오버레이일 때만 숨긴다.
 * 그때는 은하가 뒤에 없으니 `router.back()`이 아니라 /로 이동하는 게 맞다.
 */
import Link from "next/link";
import { useIsInOverlay } from "./overlay-context";

export default function BackToGalaxyLink({
  className,
  children = "← 은하로 돌아가기",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  // 겹쳐 띄운 화면에는 ✕가 이미 있다 — 같은 일을 하는 출구를 둘 그리지 않는다
  if (useIsInOverlay()) return null;

  return (
    <Link href="/" className={className}>
      {children}
    </Link>
  );
}
