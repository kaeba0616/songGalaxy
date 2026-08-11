"use client";

/**
 * 전역 미니플레이어 — 은하 밖 페이지(곡 목록·상세·마이페이지)와
 * 은하에서 카드 패널을 닫은 뒤에도 재생을 조작할 수 있는 알약형 바.
 * 은하 카드 패널이 열려 있는 동안(uiHosted)은 숨긴다.
 *
 * 바를 끌어 원하는 자리로 옮길 수 있고(버튼 위에서 시작한 드래그는 무시),
 * ▲ 버튼으로 지금 듣고 있는 재생 목록을 펼쳐 볼 수 있다.
 * 옮긴 위치는 localStorage에 남아 다음 방문에도 유지된다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENRICH_BATCH } from "@/config/constants";
import { useLikes } from "@/likes/likes-context";
import AddToPlaylist from "./AddToPlaylist";
import Marquee from "./Marquee";
import { usePlayer } from "./player-context";
import YoutubeStage from "./YoutubeStage";

/** 드래그로 옮긴 미니플레이어 위치 (뷰포트 좌상단 기준 px) */
const POS_KEY = "songgalaxy-miniplayer-pos";
/** 화면 가장자리에서 최소한 남겨둘 여백 — 밖으로 완전히 나가지 않게 */
const EDGE = 8;

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
    playFrom,
    toggle,
    playStep,
    uiHosted,
    engine,
    videoExpanded,
    setVideoExpanded,
    registerYoutube,
  } = usePlayer();
  const { auth, toggleLike } = useLikes();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** null이면 기본 위치(하단 중앙) */
  const [pos, setPos] = useState<Pos | null>(readSavedPos);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /** 목록을 위로 펼칠지 아래로 펼칠지 — 화면에서 바가 놓인 높이로 결정 */
  const [openUp, setOpenUp] = useState(true);
  /** 포인터와 바 좌상단의 간격 — 드래그 중 바가 튀지 않게 */
  const grabOffset = useRef<Pos>({ x: 0, y: 0 });

  const clamp = useCallback((p: Pos): Pos => {
    const el = wrapRef.current;
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

  const songs = queue?.songs ?? NO_SONGS;
  const currentIndex = songs.findIndex((s) => s.id === playingId);

  /**
   * 영상 무대를 언제, 어떤 영상으로 걸어 둘지.
   * `engine === "youtube"`가 된 뒤에 거는 것은 너무 늦다 — 무대가 없으면 영상 재생
   * 요청 자체가 시작되지 못하고(무대는 재생을 눌러야 뜨는데 재생은 무대가 있어야
   * 성공하는 교착), 무대가 뜬 뒤에도 IFrame 스크립트를 내려받는 시간이 더 걸린다.
   * 그래서 "목록 큐가 잡힌 순간"부터 미리 걸어 데워 둔다.
   * 접었다고 내리지도 않는다 — 내리면 손잡이가 사라져 다시 펼칠 수 없다.
   *
   * 영상 ID를 함께 넘기는 이유: 빈 플레이어는 onReady를 보내지 않는다(YoutubeStage 주석).
   * 지금 곡에 ID가 없으면(미리듣기로 떨어진 곡) 목록에서 ID 있는 첫 곡을 씨앗으로 쓴다 —
   * 무대를 세워 두는 것이 목적이고, 실제로 틀 영상은 Provider가 load()로 갈아 끼운다.
   */
  const stageVideoId =
    (playingId !== null ? songs.find((s) => s.id === playingId)?.youtubeVideoId : null) ??
    songs.find((s) => s.youtubeVideoId)?.youtubeVideoId ??
    null;
  const stageMounted =
    (engine === "youtube" || queue?.mode === "playlist") && stageVideoId !== null;

  // 목록 재생은 영상 ID가 있으면 /api/enrich를 건너뛴다 — 그래서 앨범아트가 비어 있다.
  // 지금 듣는 곡 것만 따로 채워 원반이 ✦ 자리표시자로 남지 않게 한다
  useEffect(() => {
    if (playingId !== null && !media[playingId]) void fetchMedia([playingId]);
  }, [playingId, media, fetchMedia]);

  // 목록을 펼치면 현재 곡 주변의 앨범아트를 보강하고, 현재 곡이 보이도록 스크롤
  useEffect(() => {
    if (!expanded || songs.length === 0) return;
    const start = Math.max(0, currentIndex - 2);
    void fetchMedia(songs.slice(start, start + ENRICH_BATCH).map((s) => s.id));
  }, [expanded, currentIndex, songs, fetchMedia]);

  useLayoutEffect(() => {
    if (!expanded) return;
    listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "center" });
  }, [expanded]);

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
      className={`fixed z-40 w-fit select-none ${pos ? "" : "inset-x-0 bottom-4 mx-auto"} ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
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
          <div className="border-b border-white/10 px-4 py-2.5">
            <p className="text-[11px] tracking-widest text-white/40">재생 목록</p>
            <p className="truncate text-sm font-medium">{queue?.title ?? "재생 중"}</p>
            <p className="mt-0.5 text-xs text-white/45">
              {songs.length}곡{currentIndex >= 0 && ` · ${currentIndex + 1}번째 재생 중`}
            </p>
          </div>
          {/* overscroll-contain: 끝까지 스크롤해도 뒤 페이지로 넘어가지 않게.
              touchAction: 바깥 알약이 드래그용으로 none이라 여기서 세로 스크롤을 되살린다 */}
          <ul
            ref={listRef}
            style={{ touchAction: "pan-y" }}
            className="max-h-[45vh] overflow-y-auto overscroll-contain py-1"
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
                      if (isCurrent) toggle();
                      else if (queue) void playFrom(queue, s.id).catch(() => undefined);
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
      )}

      {addOpen && playingId !== null && (
        <AddToPlaylist songId={playingId} onClose={() => setAddOpen(false)} />
      )}

      {/* 목록 재생 중에는 영상이 보여야 한다 (약관). 접으면 재생도 멈춘다.
          접혀 있어도 무대는 DOM에 남긴다 — 내리면 손잡이가 사라져 이어 들을 수 없다.
          감춘 동안에는 Provider가 반드시 멈춘 상태로 유지한다 */}
      {stageMounted && (
        <div
          data-nodrag
          className={
            videoExpanded
              ? "mb-2 w-full overflow-hidden rounded-2xl border border-white/15 bg-black shadow-xl"
              : "hidden"
          }
        >
          <div className="aspect-video w-full">
            <YoutubeStage
              videoId={stageVideoId}
              register={registerYoutube}
              onEnded={() => void playStep(1)}
              onError={() => void playStep(1)}
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
      )}

      {engine === "youtube" && !videoExpanded && (
        <button
          type="button"
          onClick={() => {
            setVideoExpanded(true);
            toggle();
          }}
          className="mb-2 w-full cursor-pointer rounded-full border border-white/15 bg-black/80 py-1.5 text-xs text-white/70 backdrop-blur transition hover:bg-white/10"
        >
          영상 펼치고 이어 듣기
        </button>
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
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-white/20 bg-white/10 text-sm text-white/70 transition hover:bg-white/20"
            aria-label="목록에 담기"
            aria-expanded={addOpen}
            title="목록에 담기"
          >
            +
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
