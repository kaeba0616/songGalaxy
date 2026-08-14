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
import { useEffect, useRef, useState } from "react";
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
    volume,
    changeVolume,
    toggleMute,
    isPaused,
  } = usePlayer();
  const wrapRef = useRef<HTMLDivElement>(null);
  /**
   * 레일 전체 접힘 (sm 이상 전용). 화면 오른쪽 밖으로 밀어낼 뿐 언마운트하지
   * 않는다 — iframe이 리마운트되면 재생이 처음부터 다시 시작된다.
   *
   * **접으면 재생도 멈춘다 (YouTube 약관).** 플레이어를 숨긴 채 소리만 내는 것은
   * 오디오만 분리한 경험이라 API 정책 위반이다 — "영상 접기 (재생이 멈춥니다)"가
   * 멈추는 것과 같은 이유. 접기는 setVideoExpanded(false)를 함께 태워 일시정지한다.
   *
   * **펴면 영상도 되살린다** — 단 접기가 멈춘 경우에만(resumeOnExpand). 접기 전에
   * 이미 스스로 일시정지해 뒀다면 펼친다고 갑자기 재생되면 놀란다.
   */
  const [railHidden, setRailHidden] = useState(false);
  const resumeOnExpand = useRef(false);

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
      // 접힌 레일은 화면 밖에 있다 — 본문이 비켜 줄 이유가 없다
      root.style.setProperty(
        "--video-rail-w",
        rail && !railHidden ? `${Math.round(r.width)}px` : "0px",
      );
      // 카드는 top-20(5rem) 아래에 떠 있으므로 그 시작 위치까지 포함해 비운다.
      // 단, 높이가 0이면(폰에서 영상도 "펼치기" 버튼도 재생 목록도 안 그려지는 상태 —
      // stageVideoId는 있지만 engine !== "youtube"이고 videoExpanded가 false인 경우)
      // 화면에 보이는 게 없으므로 top-20 오프셋만 빈 여백으로 남는다. bottom 대신 0을 쓴다
      const h = r.height === 0 ? 0 : r.bottom;
      root.style.setProperty("--video-rail-h", rail ? "0px" : `${Math.round(h)}px`);
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
  }, [stageVideoId, videoExpanded, railHidden]);

  if (stageVideoId === null) return null;

  return (
    <div
      ref={wrapRef}
      /* sm 이상: 오른쪽 전체 높이 레일. 미만: 지금처럼 우측 상단에 떠 있는 카드
         (폰에는 세로 레일을 둘 폭이 없다). 모양 전환은 CSS만으로 한다 —
         iframe은 DOM에서 부모가 바뀌면 문서를 새로 로드해 재생이 처음부터 다시 시작된다 */
      className={`fixed right-4 top-20 z-40 w-[min(92vw,420px)] sm:inset-y-0 sm:right-0 sm:top-0 sm:flex sm:w-[360px] sm:flex-col sm:border-l sm:border-white/10 sm:bg-black/85 sm:backdrop-blur sm:transition-transform sm:duration-300 ${railHidden ? "sm:translate-x-full" : ""}`}
    >
      {/* 레일 왼쪽 가장자리의 접기 탭 — 래퍼 밖으로 삐져나와 있어(-translate-x-full)
          레일이 화면 밖으로 밀려나도 이 탭만 남는다. 소리는 계속 나온다 */}
      <button
        type="button"
        onClick={() => {
          setRailHidden((v) => {
            if (!v) {
              // 접는 순간 재생도 멈춘다 — 숨긴 플레이어로 소리만 내면 약관 위반.
              // 이때 재생 중이었는지를 기억해 두면, 펼 때 그 상태로 돌려놓을 수 있다
              resumeOnExpand.current = engine === "youtube" && !isPaused;
              setVideoExpanded(false);
            } else if (resumeOnExpand.current) {
              // 접기가 멈춘 재생을 되살린다 — toggle이 "펼침과 재생은 짝" 규칙대로
              // 영상을 다시 펼치면서 이어 재생한다 (탭 클릭 = 사용자 제스처라 자동재생 정책도 통과)
              resumeOnExpand.current = false;
              void toggle();
            }
            return !v;
          });
        }}
        aria-label={railHidden ? "재생 창 펼치기" : "재생 창 접기 (재생이 멈춥니다)"}
        title={railHidden ? "재생 창 펼치기" : "재생 창 접기 (재생이 멈춥니다)"}
        className="absolute left-0 top-1/2 hidden h-16 w-6 -translate-x-full -translate-y-1/2 cursor-pointer place-items-center rounded-l-xl border border-r-0 border-white/15 bg-black/85 text-white/60 backdrop-blur transition hover:text-white sm:grid"
      >
        {railHidden ? "‹" : "›"}
      </button>
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
        {/* 볼륨 — 목록 재생 중 알약은 숨으므로(레일이 컨트롤 전담) 볼륨도 여기 있어야 한다.
            없으면 데스크톱에서 플리 볼륨을 조절할 길이 사라진다 */}
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={toggleMute}
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label={volume > 0 ? "음소거" : "음소거 해제"}
            title={volume > 0 ? "음소거" : "음소거 해제"}
          >
            {volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            className="h-1 w-full cursor-pointer accent-amber-200"
            aria-label="볼륨"
          />
        </div>
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
