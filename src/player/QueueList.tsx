"use client";

/**
 * 지금 재생 중인 큐의 곡 목록.
 *
 * 알약(`MiniPlayer`)의 ≡ 패널과 영상 레일(`VideoStage`)이 **같은 이 컴포넌트**를 쓴다.
 * 두 벌로 두면 반드시 어긋난다 — 곡을 고르는 규칙(`playInQueue`가 큐의 mode를 지킨다)이
 * 한쪽에만 반영되는 식으로 갈라진다.
 *
 * 필요한 것은 스스로 `usePlayer()`에서 읽는다. 부르는 쪽이 정하는 것은 붙는 자리뿐이다.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { ENRICH_BATCH } from "@/config/constants";
import Marquee from "./Marquee";
import { usePlayer } from "./player-context";

export default function QueueList({ className = "" }: { className?: string }) {
  const { queue, playingId, isPaused, media, fetchMedia, playInQueue, toggle } = usePlayer();
  const listRef = useRef<HTMLUListElement>(null);
  const songs = queue?.songs ?? [];
  const currentIndex = songs.findIndex((s) => s.id === playingId);

  // 보이는 동안 현재 곡 주변의 앨범아트를 보강한다 — 목록 재생은 영상 ID가 있으면
  // /api/enrich를 건너뛰므로 그냥 두면 ✦ 자리표시자만 늘어선다
  useEffect(() => {
    if (songs.length === 0) return;
    const start = Math.max(0, currentIndex - 2);
    void fetchMedia(songs.slice(start, start + ENRICH_BATCH).map((s) => s.id));
  }, [currentIndex, songs, fetchMedia]);

  // 열리면 지금 곡이 보이도록 스크롤 (긴 목록에서 어디를 듣고 있는지 잃지 않게)
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "center" });
  }, []);

  if (songs.length === 0) return null;

  return (
    <div className={className}>
      <div className="border-b border-white/10 px-4 py-2.5">
        <p className="text-[11px] tracking-widest text-white/40">재생 목록</p>
        <p className="truncate text-sm font-medium">{queue?.title ?? "재생 중"}</p>
        <p className="mt-0.5 text-xs text-white/45">
          {songs.length}곡{currentIndex >= 0 && ` · ${currentIndex + 1}번째 재생 중`}
        </p>
      </div>
      {/* overscroll-contain: 끝까지 스크롤해도 뒤 페이지로 넘어가지 않게.
          touchAction: 알약 안에서는 바깥이 드래그용으로 none이라 여기서 세로 스크롤을 되살린다 */}
      <ul
        ref={listRef}
        style={{ touchAction: "pan-y" }}
        className="flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {songs.map((s, i) => {
          const isCurrent = s.id === playingId;
          const art = media[s.id]?.artworkUrl;
          return (
            <li key={s.id}>
              <button
                type="button"
                data-current={isCurrent}
                onClick={() => {
                  // playInQueue는 이 큐의 mode를 지킨다 — 목록 재생 중에 곡을 고르면
                  // 30초 미리듣기로 강등되지 않고 그대로 영상으로 이어진다
                  if (isCurrent) toggle();
                  else if (queue) void playInQueue(queue, s.id).catch(() => undefined);
                }}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition hover:bg-white/10 ${
                  isCurrent ? "bg-white/10" : ""
                }`}
              >
                <span className="w-5 shrink-0 text-center text-[11px] text-white/35">
                  {isCurrent ? (isPaused ? "❚❚" : "♪") : i + 1}
                </span>
                {art ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
                  <img
                    src={art}
                    alt=""
                    draggable={false}
                    className="h-8 w-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-white/10 text-xs text-amber-100/70">
                    ✦
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <Marquee
                    text={s.title}
                    className={`text-sm ${isCurrent ? "font-medium text-amber-100" : ""}`}
                  />
                  <Marquee text={s.artist} className="text-xs text-white/45" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
