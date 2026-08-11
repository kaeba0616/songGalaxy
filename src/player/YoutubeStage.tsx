"use client";

/**
 * YouTube IFrame Player 래퍼.
 *
 * 이 컴포넌트는 "그리기"만 한다. 무엇을 언제 트는지는 PlayerProvider가 정한다 —
 * 그래야 페이지를 옮겨도 재생이 이어지는 기존 구조가 유지된다.
 * 마운트되면 registerYoutube로 제어 API를 넘기고, 언마운트되면 null로 지운다.
 *
 * 약관: 이 플레이어는 화면에 보여야 한다. 숨긴 채 소리만 내면 위반이므로
 * 호출부(MiniPlayer)가 "접기 = 일시정지"를 지킨다.
 */
import { useEffect, useRef } from "react";
import type { YoutubeApi } from "./player-context";

interface YT {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer;
  PlayerState: { ENDED: number };
}
interface YtPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(v: number): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** IFrame API 스크립트는 한 번만 읽는다 (여러 번 마운트돼도 재사용) */
let apiPromise: Promise<YT> | null = null;
function loadApi(): Promise<YT> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YT>((resolve, reject) => {
    // 실패한 약속을 캐시에 남기면 네트워크가 한 번 흔들린 것만으로
    // 이 세션 내내 YouTube가 죽는다 — 실패하면 캐시를 비워 다음 마운트가 다시 시도하게 한다
    const fail = (e: Error) => {
      apiPromise = null;
      reject(e);
    };
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
      else fail(new Error("YT 없음"));
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => fail(new Error("IFrame API 로드 실패"));
    document.head.appendChild(s);
  });
  return apiPromise;
}

export default function YoutubeStage({
  register,
  onEnded,
  onError,
}: {
  register: (api: YoutubeApi | null) => void;
  onEnded: () => void;
  onError: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // 콜백을 ref로 잡아둔다 — 플레이어를 다시 만들지 않고 최신 핸들러를 부르기 위해
  const endedRef = useRef(onEnded);
  const errorRef = useRef(onError);
  useEffect(() => {
    endedRef.current = onEnded;
    errorRef.current = onError;
  }, [onEnded, onError]);

  useEffect(() => {
    let player: YtPlayer | null = null;
    let cancelled = false;

    void loadApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        // IFrame API는 넘겨준 요소를 iframe으로 "치환"한다.
        // React가 들고 있는 노드를 뺏기면 언마운트에서 터지므로 임시 자식을 던져준다
        const slot = document.createElement("div");
        hostRef.current.appendChild(slot);
        player = new YT.Player(slot, {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            // 제어 메서드는 onReady 이후에야 생긴다 — 생성 직후에 손잡이를 넘기면
            // Provider가 곧바로 부르는 setVolume에서 "is not a function"으로 터진다
            onReady: (e: { target: YtPlayer }) => {
              if (cancelled) return;
              const ready = e.target;
              register({
                load: (videoId) => ready.loadVideoById(videoId),
                play: () => ready.playVideo(),
                pause: () => ready.pauseVideo(),
                stop: () => ready.stopVideo(),
                setVolume: (v) => ready.setVolume(Math.round(v * 100)),
              });
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === YT.PlayerState.ENDED) endedRef.current();
            },
            onError: () => errorRef.current(),
          },
        });
      })
      .catch(() => errorRef.current());

    return () => {
      cancelled = true;
      register(null);
      player?.destroy();
    };
  }, [register]);

  // 볼륨은 이 컴포넌트가 관리하지 않는다 — PlayerProvider의 changeVolume이
  // registerYoutube로 받은 손잡이에 직접 setVolume을 건다 (단일 원본).

  return <div ref={hostRef} className="h-full w-full" />;
}
