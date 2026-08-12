"use client";

/**
 * 목록 전곡 재생용 YouTube 영상 도크.
 *
 * **레이아웃 최상위에 딱 한 번 마운트된다.** 한때 이 무대는 알약(MiniPlayer)의 자식이었는데,
 * 알약은 은하가 카드 캐러셀을 띄우면(`uiHosted`) 통째로 사라진다 — 그래서 성단을 열어둔 채
 * 목록 재생을 누르면 무대가 영원히 서지 않아 10초 뒤 조용히 재생이 죽었고, 목록 재생 중에
 * 성단을 열면 영상이 멈춘 채 되살릴 길이 없어졌다. 무대의 수명은 "어떤 화면이 떠 있는가"가
 * 아니라 재생 상태(`stageVideoId`)에만 묶여야 한다.
 *
 * 그래서 이 컴포넌트는 자리를 **절대 옮기지 않는다**: iframe은 DOM에서 부모가 바뀌는 순간
 * 브라우저가 문서를 새로 로드해 재생이 처음부터 다시 시작된다. 접힘도 언마운트가 아니라
 * `hidden`으로만 표현한다(내리면 손잡이가 사라져 이어 들을 수 없다).
 *
 * 자리를 우측 상단으로 잡은 이유: 화면 한가운데에 두면 은하의 별·성단 클릭을 iframe이
 * 가로챈다(실측: 780px 폭에서 성단 라벨 10개가 전부 가려졌고, 클릭이 youtube.com을 새 탭으로
 * 열었다). 하단은 은하 카드 캐러셀(`inset-x-0 bottom-0`)이 쓰므로 비워 둔다.
 */
import { useEffect, useRef } from "react";
import { VIDEO_MIN_PX } from "@/config/constants";
import { usePlayer } from "./player-context";
import QueueList from "./QueueList";
import YoutubeStage from "./YoutubeStage";

export default function VideoStage() {
  const {
    stageVideoId,
    engine,
    videoExpanded,
    setVideoExpanded,
    registerYoutube,
    reportYoutubeError,
    toggle,
    playStep,
  } = usePlayer();
  const wrapRef = useRef<HTMLDivElement>(null);

  /**
   * 레일/카드가 차지하는 크기를 CSS 변수로 알린다 — `globals.css`의 `main` 규칙이
   * 이걸 읽어 콘텐츠 페이지 본문이 영상 아래에 깔리지 않게 자리를 비운다.
   *
   * 픽셀을 하드코딩하지 않고 실제로 재는 이유: 영상 세로는 화면 폭과 `VIDEO_MIN_PX`에
   * 따라 달라지고 접기 버튼도 붙는다. 하드코딩하면 그때마다 여백이 어긋난다.
   * 넓은 화면에서는 폭만, 좁은 화면에서는 높이만 쓴다(레일은 옆으로, 카드는 위로 비킨다).
   */
  useEffect(() => {
    const el = wrapRef.current;
    const root = document.documentElement;
    const clear = () => {
      root.style.setProperty("--video-rail-w", "0px");
      root.style.setProperty("--video-rail-h", "0px");
    };
    if (!el || typeof ResizeObserver === "undefined") {
      clear();
      return clear;
    }
    const apply = () => {
      const rail = window.matchMedia("(min-width: 640px)").matches;
      const r = el.getBoundingClientRect();
      root.style.setProperty("--video-rail-w", rail ? `${Math.round(r.width)}px` : "0px");
      // 카드는 top-20(5rem) 아래에 떠 있으므로 그 시작 위치까지 포함해 비운다
      root.style.setProperty("--video-rail-h", rail ? "0px" : `${Math.round(r.bottom)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      // 무대가 내려가면 여백도 걷는다 — 안 그러면 영상이 끝난 뒤에도 빈 자리가 남는다
      clear();
    };
  }, [stageVideoId, videoExpanded]);

  if (stageVideoId === null) return null;

  return (
    <div
      ref={wrapRef}
      /* sm 이상: 오른쪽 전체 높이 레일. 미만: 지금처럼 우측 상단에 떠 있는 카드
         (폰에는 세로 레일을 둘 폭이 없다). 모양 전환은 CSS만으로 한다 —
         iframe은 DOM에서 부모가 바뀌면 문서를 새로 로드해 재생이 처음부터 다시 시작된다 */
      className="fixed right-4 top-20 z-40 w-[min(92vw,420px)] sm:inset-y-0 sm:right-0 sm:top-0 sm:flex sm:w-[360px] sm:flex-col sm:border-l sm:border-white/10 sm:bg-black/85 sm:backdrop-blur"
    >
      <div
        className={
          videoExpanded
            ? "overflow-hidden rounded-2xl border border-white/15 bg-black shadow-xl sm:rounded-none sm:border-0 sm:shadow-none"
            : "hidden"
        }
      >
        <div className="aspect-video w-full" style={{ minHeight: VIDEO_MIN_PX }}>
          <YoutubeStage
            videoId={stageVideoId}
            register={registerYoutube}
            onEnded={() => void playStep(1)}
            onError={reportYoutubeError}
          />
        </div>
        <button
          type="button"
          onClick={() => setVideoExpanded(false)}
          className="w-full cursor-pointer py-1.5 text-xs text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          영상 접기 (재생이 멈춥니다)
        </button>
      </div>

      {engine === "youtube" && !videoExpanded && (
        <button
          type="button"
          onClick={toggle}
          className="w-full cursor-pointer rounded-full border border-white/15 bg-black/80 py-1.5 text-xs text-white/70 backdrop-blur transition hover:bg-white/10 sm:rounded-none sm:border-0"
        >
          영상 펼치고 이어 듣기
        </button>
      )}

      {/* 재생 목록은 레일에서만 보인다 — 좁은 화면에는 알약의 ≡가 이미 있고,
          떠 있는 카드에 목록까지 넣으면 화면을 다 덮는다.
          min-h-0: flex 자식은 기본 min-height가 auto라, 이게 없으면 목록이 레일 밖으로 넘친다 */}
      <QueueList className="hidden min-h-0 flex-1 flex-col text-white sm:flex" />
    </div>
  );
}
