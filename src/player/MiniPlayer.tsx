"use client";

/**
 * 전역 미니플레이어 — 은하 밖 페이지(곡 목록·상세·마이페이지)와
 * 은하에서 카드 패널을 닫은 뒤에도 재생을 조작할 수 있는 알약형 바.
 * 은하 카드 패널이 열려 있는 동안(uiHosted)은 숨긴다.
 *
 * 바를 끌어 원하는 자리로 옮길 수 있고(버튼 위에서 시작한 드래그는 무시),
 * ▲ 버튼으로 지금 듣고 있는 재생 목록을 펼쳐 볼 수 있다.
 * 옮긴 위치는 localStorage에 남아 다음 방문에도 유지된다.
 *
 * **영상 무대는 여기 있지 않다** (`VideoStage`). 이 알약은 은하가 카드 캐러셀을 띄우면
 * 통째로 사라지는데, 무대가 자식이면 그때 같이 죽어 전곡 재생이 되살아나지 못한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLikes } from "@/likes/likes-context";
import AddToPlaylist from "./AddToPlaylist";
import Marquee from "./Marquee";
import { usePlayer } from "./player-context";
import QueueList from "./QueueList";

/** 드래그로 옮긴 미니플레이어 위치 (뷰포트 좌상단 기준 px) */
const POS_KEY = "songgalaxy-miniplayer-pos";
/** 화면 가장자리에서 최소한 남겨둘 여백 — 밖으로 완전히 나가지 않게 */
const EDGE = 8;

/**
 * 영상 레일이 지금 차지한 폭. `VideoStage`가 `document.documentElement`에 publish하는
 * `--video-rail-w`를 그대로 읽는다 — 새 원본을 만들지 않고 이미 있는 걸 재사용한다.
 * 좁은 화면(레일이 카드로 바뀌는 곳)에서는 0px이라 자연히 영향이 없다.
 */
function railWidth(): number {
  return (
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--video-rail-w")) || 0
  );
}

interface Pos {
  x: number;
  y: number;
}

/** 큐가 없을 때 쓰는 고정 빈 배열 — 매 렌더 새 배열을 만들면 효과가 헛돈다 */
const NO_SONGS: never[] = [];

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
  const {
    playingId,
    isPaused,
    queue,
    media,
    volume,
    changeVolume,
    toggleMute,
    fetchMedia,
    toggle,
    playStep,
    uiHosted,
    notice,
    stageVideoId,
    videoExpanded,
  } = usePlayer();
  const { auth, toggleLike } = useLikes();
  const wrapRef = useRef<HTMLDivElement>(null);
  /** null이면 기본 위치(하단 중앙) */
  const [pos, setPos] = useState<Pos | null>(readSavedPos);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /** 담기 성공 직후 + 버튼을 잠깐 ✓로 — "«이름»에 담았어요" 문구 대신 */
  const [addFlash, setAddFlash] = useState(false);
  /** 목록을 위로 펼칠지 아래로 펼칠지 — 화면에서 바가 놓인 높이로 결정 */
  const [openUp, setOpenUp] = useState(true);
  /** 포인터와 바 좌상단의 간격 — 드래그 중 바가 튀지 않게 */
  const grabOffset = useRef<Pos>({ x: 0, y: 0 });

  // 알약이 레일 밑으로 끌려 들어가지 않게 오른쪽 한계에서 레일 폭을 뺀다 —
  // 레일은 알약과 같은 z-40이지만 DOM에서 알약보다 뒤에 그려져(src/app/layout.tsx)
  // 위에 덮이므로, 겹치면 알약 오른쪽의 볼륨·≡·담기 버튼이 클릭되지 않는다
  const clamp = useCallback((p: Pos): Pos => {
    const el = wrapRef.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    return {
      x: Math.min(Math.max(p.x, EDGE), Math.max(EDGE, window.innerWidth - railWidth() - w - EDGE)),
      y: Math.min(Math.max(p.y, EDGE), Math.max(EDGE, window.innerHeight - h - EDGE)),
    };
  }, []);

  // 창 크기가 줄거나 레일이 나타나(또는 폭이 바뀌어) 바가 화면 밖/레일 밑으로 밀려나면
  // 다시 안으로. 레일 폭이 바뀌는 것은 "resize" 이벤트가 아니라 무대가 서거나 접히는
  // 사건이라 stageVideoId·videoExpanded를 트리거로 같이 듣는다. pos는 setState의
  // 갱신 함수 안에서만 읽는다 — 의존성에 넣으면 clamp가 만드는 새 객체가 매번 이 effect를
  // 다시 돌려 무한 루프가 된다. 저장된 위치가 없으면(기본값 = 하단 중앙, CSS로 항상
  // 반응형) 갱신 함수가 그대로 null을 돌려주므로 아무 일도 안 한다.
  // requestAnimationFrame으로 미루는 이유: effect 본문에서 곧바로 setState를 부르면
  // 렌더가 겹쳐 돈다는 경고(react-hooks/set-state-in-effect)가 뜬다 — 아래 resize
  // 리스너처럼 콜백 안에서 부르면 그 경고를 피한다
  useEffect(() => {
    const reclamp = () => setPos((p) => (p ? clamp(p) : p));
    const raf = requestAnimationFrame(reclamp);
    window.addEventListener("resize", reclamp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reclamp);
    };
  }, [clamp, stageVideoId, videoExpanded]);

  const songs = queue?.songs ?? NO_SONGS;

  // 목록 재생은 영상 ID가 있으면 /api/enrich를 건너뛴다 — 그래서 앨범아트가 비어 있다.
  // 지금 듣는 곡 것만 따로 채워 원반이 ✦ 자리표시자로 남지 않게 한다
  useEffect(() => {
    if (playingId !== null && !media[playingId]) void fetchMedia([playingId]);
  }, [playingId, media, fetchMedia]);

  // 목록을 열 때 위아래 중 공간이 있는 쪽으로 펼친다 (좌우는 알약과 같은 폭이라 그대로)
  const toggleExpanded = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setOpenUp(r.top > window.innerHeight / 2);
    setAddOpen(false); // 둘 다 알약 위에 뜬다 — 겹치지 않게 하나만 연다
    setExpanded((v) => !v);
  };

  useEffect(() => {
    if (!expanded && !addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setExpanded(false);
      setAddOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, addOpen]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 버튼·볼륨 슬라이더·알약에 붙은 패널(재생 목록·영상·담기) 위에서 시작한 입력은 드래그가 아니다
    if ((e.target as HTMLElement).closest("button, input, [data-playlist], [data-nodrag]")) return;
    const el = wrapRef.current;
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
    wrapRef.current?.releasePointerCapture(e.pointerId);
    setPos((p) => {
      if (p) localStorage.setItem(POS_KEY, JSON.stringify(p));
      return p;
    });
  };

  if (playingId === null || uiHosted) return null;
  const song = songs.find((s) => s.id === playingId);
  if (!song) return null;
  const m = media[playingId];

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={pos ? { left: pos.x, top: pos.y, touchAction: "none" } : { touchAction: "none" }}
      /* 영상 레일(stageVideoId)이 서 있으면 sm 이상에서는 알약을 숨긴다 — 레일이
         큐·컨트롤을 전담하는 자기 창이라 알약까지 있으면 컨트롤이 둘로 보인다.
         폰(sm 미만)은 레일이 아니라 작은 카드뿐이라 알약이 계속 컨트롤을 맡는다 */
      className={`fixed z-40 w-fit select-none ${stageVideoId !== null ? "sm:hidden" : ""} ${
        pos ? "" : "inset-x-0 bottom-4 mx-auto"
      } ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      {/* 재생 목록 — 바를 밀어내지 않도록 absolute로 위/아래에 띄운다.
          w-full = 바깥 래퍼(w-fit) 폭 = 알약 폭이라 둘의 너비가 항상 같다 */}
      {expanded && (
        <div
          data-playlist
          className={`absolute left-0 w-full overflow-hidden rounded-2xl border border-white/15 bg-black/90 text-white shadow-2xl backdrop-blur ${
            openUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <QueueList className="flex max-h-[45vh] flex-col" />
        </div>
      )}

      {addOpen && playingId !== null && (
        <AddToPlaylist
          songId={playingId}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddFlash(true);
            setTimeout(() => setAddFlash(false), 1200);
          }}
        />
      )}

      {/* 재생 방식이 바뀐 이유 한 줄 — 영상이 계속 실패해 미리듣기로 내려온 경우 */}
      {notice && (
        <p className="mb-2 w-full rounded-2xl border border-amber-200/25 bg-black/80 px-3 py-1.5 text-center text-[11px] text-amber-100/80 backdrop-blur">
          {notice}
        </p>
      )}

      {/* 알약 본체 */}
      <div className="flex max-w-[92vw] items-center gap-2.5 rounded-full border border-white/15 bg-black/80 py-2 pl-2 pr-2.5 shadow-xl backdrop-blur">
        {/* 재생 중이면 원반처럼 돌아 "지금 나오고 있다"를 알린다.
            일시정지하면 멈추되 각도는 유지 (다시 누르면 그 자리에서 이어 돈다) */}
        {m?.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
          <img
            src={m.artworkUrl}
            alt=""
            draggable={false}
            style={{ animationPlayState: isPaused ? "paused" : "running" }}
            className="animate-disc h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20"
          />
        ) : (
          <div
            style={{ animationPlayState: isPaused ? "paused" : "running" }}
            className="animate-disc grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm text-amber-100 ring-1 ring-white/20"
          >
            ✦
          </div>
        )}
        {/* 폭 고정 — 곡 제목 길이에 따라 알약 크기가 변하지 않게 한다.
            넘치는 글자는 Marquee가 흐르게 처리 */}
        {/* min-w-0: 없으면 긴 제목의 min-content 폭 때문에 알약이 화면 밖까지 밀린다 */}
        <div className="w-20 min-w-0 shrink sm:w-32">
          <Marquee text={song.title} className="text-sm font-medium" />
          <Marquee text={song.artist} className="text-xs text-white/50" />
        </div>
        {/* 컨트롤 — 손가락으로 눌리도록 버튼마다 32px 정사각 터치 영역을 준다 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void toggleLike(playingId)}
            className={`grid h-8 w-8 cursor-pointer place-items-center rounded-full border text-xs transition ${
              auth.likedIds.has(playingId)
                ? "border-pink-400/60 bg-pink-500/25 text-pink-200"
                : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"
            }`}
            aria-label={auth.likedIds.has(playingId) ? "좋아요 취소" : "좋아요"}
            title={auth.authenticated ? "좋아요" : "로그인하고 좋아요"}
          >
            {auth.likedIds.has(playingId) ? "♥" : "♡"}
          </button>
          <button
            type="button"
            onClick={() => {
              setExpanded(false); // 재생 목록과 겹치지 않게
              setAddOpen((v) => !v);
            }}
            className={`grid h-8 w-8 cursor-pointer place-items-center rounded-full border text-sm transition ${
              addFlash
                ? "added-pop border-amber-200/60 bg-amber-100/15 text-amber-100"
                : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"
            }`}
            aria-label="목록에 담기"
            aria-expanded={addOpen}
            title="목록에 담기"
          >
            {addFlash ? "✓" : "+"}
          </button>
          <button
            type="button"
            onClick={() => void playStep(-1)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="이전 곡"
            title="이전 곡"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={toggle}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label={isPaused ? "재생" : "일시정지"}
            title={isPaused ? "재생" : "일시정지"}
          >
            {isPaused ? "▶" : "❚❚"}
          </button>
          <button
            type="button"
            onClick={() => void playStep(1)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="다음 곡"
            title="다음 곡"
          >
            ⏭
          </button>
          {/* 볼륨 — 좁은 화면에서는 슬라이더를 접고 음소거 토글만 (기기 볼륨키가 있다) */}
          <button
            type="button"
            onClick={toggleMute}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
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
            className="hidden h-1 w-16 cursor-pointer accent-amber-200 sm:block"
            aria-label="볼륨"
          />
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label={expanded ? "재생 목록 닫기" : "재생 목록 보기"}
            title={expanded ? "재생 목록 닫기" : "재생 목록 보기"}
          >
            ≡
          </button>
        </div>
      </div>
    </div>
  );
}
