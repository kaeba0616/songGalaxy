"use client";

/**
 * "목록에 담기" + 버튼 — 곡 목록 행·카드 캐러셀 공용.
 *
 * 알약의 + 버튼과 같은 팝오버(AddToPlaylist)를 쓴다 — 담기·새 목록 만들기 로직을
 * 두 벌로 두면 반드시 어긋난다.
 *
 * 패널은 `position: fixed`로 띄운다. absolute로 붙이면 조상 어딘가의 overflow에
 * 잘린다 — 곡 목록은 `ul`의 overflow-hidden(둥근 모서리) 때문에 마지막 행에서
 * 패널이 잘렸고, 카드 캐러셀은 가로 스크롤(overflow-x-auto)과 카드 자신의
 * overflow-hidden에 이중으로 잘려 아예 쓸 수 없었다. fixed는 조상 클리핑을
 * 전부 벗어난다. 화면 아래 공간이 모자라면 위로 펼친다.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AddToPlaylist from "@/player/AddToPlaylist";

/** 패널이 필요로 하는 대략의 높이 — 목록 몇 줄 + 새 목록 입력줄 + 여백 */
const PANEL_ROOM = 340;

export default function AddToPlaylistButton({
  songId,
  buttonClassName = "grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-white/20 bg-white/10 text-sm text-white/70 transition hover:bg-white/20 hover:text-white",
}: {
  songId: number;
  /** 놓이는 자리의 크기에 맞춘 버튼 스타일 (카드 캐러셀은 h-7 w-7) */
  buttonClassName?: string;
}) {
  const [anchor, setAnchor] = useState<{ up: boolean; top: number; bottom: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    // 아래 공간이 모자라면 위로 — 목록 마지막 행·화면 하단 캐러셀이 이 경우다
    const up = window.innerHeight - r.bottom < PANEL_ROOM;
    // 버튼 오른쪽 끝에 맞추되 화면 밖으로는 안 나가게 가로를 죈다 — 캐러셀의
    // 왼쪽 카드처럼 버튼이 화면 왼편에 있으면 오른쪽 정렬만으로는 패널(w-64,
    // 256px)의 왼쪽이 화면 밖으로 밀려난다
    const PANEL_W = 256;
    const right = Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - PANEL_W - 8));
    setAnchor({
      up,
      top: r.bottom + 8,
      bottom: window.innerHeight - r.top + 8,
      right,
    });
  };

  // 바깥 클릭·Esc·스크롤이면 닫는다 — fixed 패널은 스크롤을 따라가지 않으므로
  // 열린 채 스크롤하면 버튼과 떨어져 떠 있게 된다. 따라가려 애쓰지 말고 닫는다
  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onDown = (e: MouseEvent) => {
      // 패널은 포털이라 wrap 트리 밖에 있다 — 양쪽 다 확인해야 패널 안 클릭이 닫히지 않는다
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !panelRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-label="노래 목록에 담기"
        aria-expanded={anchor !== null}
        title="노래 목록에 담기"
        className={buttonClassName}
      >
        +
      </button>
      {anchor &&
        /* 포털로 body에 직접 그린다 — 카드처럼 backdrop-filter가 있는 조상 밑에서는
           fixed의 기준이 뷰포트가 아니라 그 조상이 돼(containing block) 좌표가 통째로
           어긋난다. body 밑이면 fixed가 항상 뷰포트 기준이다 */
        createPortal(
          <div ref={panelRef}>
            <AddToPlaylist
              songId={songId}
              onClose={() => setAnchor(null)}
              panelClassName="fixed z-50 w-64 rounded-2xl border border-white/15 bg-black/90 p-3 text-sm text-white shadow-xl backdrop-blur"
              panelStyle={
                anchor.up
                  ? { bottom: anchor.bottom, right: anchor.right }
                  : { top: anchor.top, right: anchor.right }
              }
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
