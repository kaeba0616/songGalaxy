"use client";

/**
 * 전역 미니플레이어 — 은하 밖 페이지(곡 목록·상세·마이페이지)와
 * 은하에서 카드 패널을 닫은 뒤에도 재생을 조작할 수 있는 하단 바.
 * 은하 카드 패널이 열려 있는 동안(uiHosted)은 숨긴다.
 *
 * 바를 끌어 원하는 자리로 옮길 수 있다 (버튼 위에서 시작한 드래그는 무시).
 * 옮긴 위치는 localStorage에 남아 다음 방문에도 유지된다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayer } from "./player-context";

/** 드래그로 옮긴 미니플레이어 위치 (뷰포트 좌상단 기준 px) */
const POS_KEY = "songgalaxy-miniplayer-pos";
/** 화면 가장자리에서 최소한 남겨둘 여백 — 밖으로 완전히 나가지 않게 */
const EDGE = 8;

interface Pos {
  x: number;
  y: number;
}

/**
 * 저장된 위치를 읽는다. 서버 렌더에는 localStorage가 없으므로 기본 위치로 시작한다
 * (재생 중이 아니면 아무것도 그리지 않으므로 하이드레이션 불일치는 생기지 않는다).
 */
function readSavedPos(): Pos | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(POS_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Pos;
    return Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  } catch {
    localStorage.removeItem(POS_KEY);
    return null;
  }
}

export default function MiniPlayer() {
  const { playingId, isPaused, queue, media, toggle, playStep, stop, uiHosted } = usePlayer();
  const barRef = useRef<HTMLDivElement>(null);
  /** null이면 기본 위치(하단 중앙) */
  const [pos, setPos] = useState<Pos | null>(readSavedPos);
  const [dragging, setDragging] = useState(false);
  /** 포인터와 바 좌상단의 간격 — 드래그 중 바가 튀지 않게 */
  const grabOffset = useRef<Pos>({ x: 0, y: 0 });

  const clamp = useCallback((p: Pos): Pos => {
    const el = barRef.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    return {
      x: Math.min(Math.max(p.x, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE)),
      y: Math.min(Math.max(p.y, EDGE), Math.max(EDGE, window.innerHeight - h - EDGE)),
    };
  }, []);

  // 창 크기가 줄어 바가 화면 밖으로 밀려나면 다시 안으로
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos, clamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 재생 컨트롤 위에서 시작한 입력은 드래그가 아니라 버튼 클릭이다
    if ((e.target as HTMLElement).closest("button")) return;
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    grabOffset.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setPos({ x: r.left, y: r.top }); // 기본 위치(중앙 정렬)에서 좌표 기준으로 전환
    setDragging(true);
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setPos(clamp({ x: e.clientX - grabOffset.current.x, y: e.clientY - grabOffset.current.y }));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    barRef.current?.releasePointerCapture(e.pointerId);
    setPos((p) => {
      if (p) localStorage.setItem(POS_KEY, JSON.stringify(p));
      return p;
    });
  };

  if (playingId === null || uiHosted) return null;
  const song = queue?.songs.find((s) => s.id === playingId);
  if (!song) return null;
  const m = media[playingId];

  return (
    <div
      ref={barRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={
        pos
          ? { left: pos.x, top: pos.y, touchAction: "none" }
          : { touchAction: "none" }
      }
      className={`fixed z-40 flex w-fit max-w-[92vw] items-center gap-3 rounded-full border border-white/15 bg-black/80 py-1.5 pl-1.5 pr-3 text-white shadow-xl backdrop-blur select-none ${
        pos ? "" : "inset-x-0 bottom-4 mx-auto"
      } ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      {m?.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
        <img
          src={m.artworkUrl}
          alt=""
          draggable={false}
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm text-amber-100">
          ✦
        </div>
      )}
      <div className="min-w-0 max-w-48">
        <p className="truncate text-sm font-medium">{song.title}</p>
        <p className="truncate text-xs text-white/50">{song.artist}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void playStep(-1)}
          className="cursor-pointer text-sm text-white/70 transition hover:text-white"
          aria-label="이전 곡"
          title="이전 곡"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={toggle}
          className="cursor-pointer text-sm text-white/70 transition hover:text-white"
          aria-label={isPaused ? "재생" : "일시정지"}
          title={isPaused ? "재생" : "일시정지"}
        >
          {isPaused ? "▶" : "❚❚"}
        </button>
        <button
          type="button"
          onClick={() => void playStep(1)}
          className="cursor-pointer text-sm text-white/70 transition hover:text-white"
          aria-label="다음 곡"
          title="다음 곡"
        >
          ⏭
        </button>
        <button
          type="button"
          onClick={stop}
          className="cursor-pointer rounded-full px-1 text-white/50 transition hover:text-white"
          aria-label="재생 종료"
          title="재생 종료"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
