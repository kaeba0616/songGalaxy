"use client";

/**
 * 목록 행 우측의 "목록에 담기" 버튼.
 *
 * 알약의 + 버튼과 같은 팝오버를 쓴다 — 담기·새 목록 만들기 로직을 두 벌로 두면
 * 반드시 어긋난다. 붙는 자리만 다르다: 알약은 위로 펼치고 알약 폭을 쓰지만,
 * 여기서는 버튼 아래에 고정 폭으로 펼친다.
 */
import { useEffect, useRef, useState } from "react";
import AddToPlaylist from "@/player/AddToPlaylist";

export default function AddToPlaylistButton({ songId }: { songId: number }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르거나 Esc면 닫는다 — 목록에는 행이 여럿이라 열어둔 채 두면 거슬린다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="노래 목록에 담기"
        aria-expanded={open}
        title="노래 목록에 담기"
        className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-white/20 bg-white/10 text-sm text-white/70 transition hover:bg-white/20 hover:text-white"
      >
        +
      </button>
      {open && (
        <AddToPlaylist
          songId={songId}
          onClose={() => setOpen(false)}
          /* 오른쪽 끝에 맞춰 아래로 펼친다. z-20이면 아래 행들 위로 뜬다 */
          panelClassName="absolute right-0 top-full z-20 mt-2 w-64 rounded-2xl border border-white/15 bg-black/90 p-3 text-sm text-white shadow-xl backdrop-blur"
        />
      )}
    </div>
  );
}
