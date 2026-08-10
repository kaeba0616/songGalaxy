"use client";

/**
 * 전역 미니플레이어 — 은하 밖 페이지(곡 목록·상세·마이페이지)와
 * 은하에서 카드 패널을 닫은 뒤에도 재생을 조작할 수 있는 하단 바.
 * 은하 카드 패널이 열려 있는 동안(uiHosted)은 숨긴다.
 */
import { usePlayer } from "./player-context";

export default function MiniPlayer() {
  const { playingId, isPaused, queue, media, toggle, playStep, stop, uiHosted } = usePlayer();
  if (playingId === null || uiHosted) return null;
  const song = queue?.songs.find((s) => s.id === playingId);
  if (!song) return null;
  const m = media[playingId];

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full border border-white/15 bg-black/80 py-1.5 pl-1.5 pr-3 text-white shadow-xl backdrop-blur">
      {m?.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
        <img src={m.artworkUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
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
          className="text-sm text-white/70 transition hover:text-white"
          aria-label="이전 곡"
          title="이전 곡"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={toggle}
          className="text-sm text-white/70 transition hover:text-white"
          aria-label={isPaused ? "재생" : "일시정지"}
          title={isPaused ? "재생" : "일시정지"}
        >
          {isPaused ? "▶" : "❚❚"}
        </button>
        <button
          type="button"
          onClick={() => void playStep(1)}
          className="text-sm text-white/70 transition hover:text-white"
          aria-label="다음 곡"
          title="다음 곡"
        >
          ⏭
        </button>
        <button
          type="button"
          onClick={stop}
          className="rounded-full px-1 text-white/50 transition hover:text-white"
          aria-label="재생 종료"
          title="재생 종료"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
