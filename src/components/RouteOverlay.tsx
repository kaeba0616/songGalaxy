"use client";

/**
 * 은하 위에 겹쳐 띄우는 화면 껍데기.
 *
 * 은하는 3D 장면을 세우는 데 4초 가까이 걸린다(실측). 곡 목록으로 갔다 돌아올 때마다
 * 그걸 다시 하면 보던 위치도 잃고 매번 기다려야 한다. 그래서 은하를 내리지 않고
 * 그 위에 이 껍데기를 덮는다 — 닫으면 겹친 것만 걷어내므로 돌아가기가 즉시다.
 *
 * 인터셉팅 라우트가 클라이언트 이동일 때만 이 껍데기를 태우므로, 주소를 직접 열거나
 * 새로고침하면 원래의 독립 페이지가 그대로 뜬다 (공유 링크가 깨지지 않는다).
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { OverlayProvider } from "./overlay-context";

export default function RouteOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Esc로 닫기 — 겹친 화면의 기본 기대치다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-[#05060f]/92 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="닫고 은하로 돌아가기"
        /* 영상 레일이 서면(sm 이상) 우측 상단이 레일 밑으로 들어간다 — 레일 폭(--video-rail-w)만큼
           왼쪽으로 비킨다. 레일이 없으면(변수 0px) right-4와 동일 */
        className="fixed right-[calc(1rem+var(--video-rail-w,0px))] top-4 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-white/20 bg-black/60 text-white/70 backdrop-blur transition hover:bg-white/15 hover:text-white"
      >
        ✕
      </button>
      {/* 안쪽 화면이 "지금 겹쳐 떠 있다"를 알 수 있어야 은하로 돌아가기가 뒤로 가기가 된다 */}
      <OverlayProvider value={true}>{children}</OverlayProvider>
    </div>
  );
}
