"use client";

/**
 * "은하로 돌아가기" — 놓인 자리에 따라 다르게 동작해야 하는 링크.
 *
 * 겹쳐 띄운 화면 안: 뒤로 가기. 여기서 /로 이동해 버리면 방문 기록이 하나 더 쌓이고
 * 은하가 새로 그려져(약 4초) 겹쳐 띄운 의미가 통째로 사라진다.
 * 독립 페이지(새로고침·공유 링크): 은하가 뒤에 없으므로 /로 이동하는 게 맞다.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsInOverlay } from "./overlay-context";

export default function BackToGalaxyLink({
  className,
  children = "← 은하로 돌아가기",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const inOverlay = useIsInOverlay();

  if (inOverlay) {
    return (
      <button type="button" onClick={() => router.back()} className={`cursor-pointer ${className ?? ""}`}>
        {children}
      </button>
    );
  }

  return (
    <Link href="/" className={className}>
      {children}
    </Link>
  );
}
