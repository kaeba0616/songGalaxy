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
import { VIDEO_MIN_PX } from "@/config/constants";
import { usePlayer } from "./player-context";
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

  if (stageVideoId === null) return null;

  return (
    <div className="fixed right-4 top-20 z-40 w-[min(92vw,420px)]">
      {/* 접혀 있어도 DOM에는 남긴다 — 내리면 손잡이가 사라져 이어 들을 수 없다.
          감춘 동안에는 Provider가 반드시 멈춘 상태로 유지한다 (약관) */}
      <div
        className={
          videoExpanded
            ? "overflow-hidden rounded-2xl border border-white/15 bg-black shadow-xl"
            : "hidden"
        }
      >
        {/* min-h: 좁은 화면에서 16:9를 그대로 두면 세로가 정책 하한(200px) 밑으로 떨어진다.
            세로를 지키고 남는 좌우는 YouTube가 검은 여백으로 채운다 */}
        <div className="aspect-video w-full" style={{ minHeight: VIDEO_MIN_PX }}>
          <YoutubeStage
            videoId={stageVideoId}
            register={registerYoutube}
            onEnded={() => void playStep(1)}
            // 건너뛰지 않는다 — 임베드가 막힌 영상 하나로 그 곡을 모든 목록에서
            // 영영 잃는다. Provider가 그 곡만 미리듣기로 떨어뜨린다
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

      {/* 펼치기는 toggle에만 맡긴다 — 여기서 setVideoExpanded(true)를 먼저 부르면,
          무대가 아직 준비 중일 때 빈 패널만 펼쳐진 채 이 버튼이 사라져 되돌릴 길이 없다.
          toggle은 손잡이가 있으면 펼치며 재생하고, 없으면 곡을 다시 요청해 둔다 */}
      {engine === "youtube" && !videoExpanded && (
        <button
          type="button"
          onClick={toggle}
          className="w-full cursor-pointer rounded-full border border-white/15 bg-black/80 py-1.5 text-xs text-white/70 backdrop-blur transition hover:bg-white/10"
        >
          영상 펼치고 이어 듣기
        </button>
      )}
    </div>
  );
}
