"use client";

/**
 * 구형 3D 은하 렌더러 (이슈 #4)
 * - 3만 곡을 GPU 포인트 2겹(코어+헤일로 글로우)으로 렌더링
 * - 3단계 LOD 라벨: 멀리=성단 12개 / 접근=세부 테마 / 진입=곡 제목
 * - 클릭 드릴다운: 성단 라벨 → 성단 인기곡 카드, 세부 장르 라벨 → 그 장르 곡 카드
 * - 카드: 앨범아트 + 30초 미리듣기(iTunes 캐시), 곡 선택 시 가수 정보(MusicBrainz 캐시)
 * 좌표는 서버가 준 값 그대로 사용한다 (좌표 불변 — 카메라만 움직인다).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BIO_MAX, ENRICH_BATCH, MIN_LIKES_FOR_STAR, NICKNAME_MAX } from "@/config/constants";
import { getPlanetTheme } from "@/config/planet-themes";
import { hashString, mulberry32 } from "@/lib/layout-math";
import { useLikes } from "@/likes/likes-context";
import { usePlayer } from "@/player/player-context";
import type { PlayerQueue, PlayerSnapshot } from "@/player/player-context";
import type { GalaxyPayload, GalaxyStar, GalaxyTheme } from "./types";

const GALAXY_BG = "#05060f";
/** 카메라 초기/리셋 거리 (전체 보기) */
const OVERVIEW_DISTANCE = 2600;
/** 곡 제목 라벨이 보이기 시작하는 카메라-곡 거리 */
const SONG_LABEL_DISTANCE = 130;
/** 동시에 띄우는 곡 라벨 수 */
const SONG_LABEL_POOL = 24;
/** 곡 더블클릭 시 확대 거리 — 제목 라벨이 또렷이 보이는 근접 줌 (라벨 투명도 ≈ 1 - d/130) */
const SONG_ZOOM_DISTANCE = 16;
/** 하단 카드 캐러셀에 띄우는 최대 곡 수 (인기순) */
const CARD_LIMIT = 150;

interface CardSong {
  index: number;
  id: number;
  title: string;
  artist: string;
  popularity: number;
}

interface CardData {
  title: string;
  subtitle: string;
  color: string;
  songs: CardSong[];
}

/** 행성 정보 패널 데이터 (이슈 #10) */
interface PlanetInfo {
  userId: number;
  nickname: string;
  likesCount?: number;
  lastLikedAt?: string | null;
  clusters?: { slug: string; label: string; color: string; n: number }[];
  /** 주인이 쓴 한 줄 소개 (행성 프로필) */
  bio?: string | null;
}

const CORE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (260.0 / -mv.z), 1.0, 28.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const CORE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  uniform float uAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float falloff = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, falloff * uAlpha);
  }
`;

/** 라벨 글자 갱신 — 글자는 호버 확대를 위해 안쪽 span에 들어 있다 (makeLabel 참조) */
function setLabelText(el: HTMLDivElement, text: string): void {
  const inner = el.firstElementChild as HTMLElement | null;
  if (inner) inner.textContent = text;
}

function makePointsLayer(
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  alpha: number,
): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: CORE_VERTEX,
    fragmentShader: CORE_FRAGMENT,
    uniforms: { uAlpha: { value: alpha } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

export default function GalaxyCanvas({
  initialSongId,
  focusMyStar,
  landUserId,
}: {
  initialSongId?: number;
  focusMyStar?: boolean;
  /** /planet/[id] 딥링크 — 로드 후 이 유저의 행성으로 자동 착륙 */
  landUserId?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const cardScrollRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const exitSkyRef = useRef<(() => void) | null>(null);
  /** 특정 유저의 행성으로 착륙 (밤하늘에 있어도 안전하게 이동) */
  const landByUserRef = useRef<((userId: number) => void) | null>(null);
  /** 별 더블클릭 → 해당 곡 미리듣기 재생 요청 (three 이벤트 → React) */
  const playRequestRef = useRef<
    | ((
        songId: number,
        info?: { title: string; artist: string; index: number; popularity: number },
      ) => void)
    | null
  >(null);
  const flySongRef = useRef<((index: number) => void) | null>(null);
  /** three 이벤트 콜백에서 최신 상태를 읽기 위한 미러 (stale closure 방지) */
  const cardsRef = useRef<CardData | null>(null);
  /** 씬의 유저 별 갱신 API (three 이펙트가 채움) */
  const starApiRef = useRef<((star: GalaxyStar) => void) | null>(null);
  const flyToPosRef = useRef<((x: number, y: number, z: number, dist: number) => void) | null>(null);
  // 로그인·좋아요·내 별 상태의 단일 원본 (SSOT: src/likes/likes-context.tsx).
  // 미니플레이어의 ♥와 같은 상태를 봐야 하므로 컨텍스트에서 받아 쓴다.
  const { auth: authState, toggleLike: toggleLikeBase, setNickname } = useLikes();
  const [toast, setToast] = useState<string | null>(null);
  /** 밤하늘 모드 정보 (착륙 중/완료 시 세팅) — 헤더 전환·정보 패널용 */
  const [skyInfo, setSkyInfo] = useState<PlanetInfo | null>(null);
  /** 착륙 진입 플래시 오버레이 */
  const [flash, setFlash] = useState(false);
  /** 자동 라디오가 브라우저 정책에 막혔을 때 폴백 버튼 표시 */
  const [radioBlocked, setRadioBlocked] = useState(false);
  const autoRadioTried = useRef(false);
  // 재생·볼륨·미디어 캐시의 단일 원본 (SSOT: src/player/player-context.tsx).
  // 캔버스가 언마운트돼도 재생이 이어지도록 오디오는 이 프로바이더가 소유한다.
  const {
    playingId,
    isPaused,
    queue,
    volume,
    media,
    fetchMedia,
    getMedia,
    playFrom,
    toggle: togglePlay,
    playStep: playerStep,
    stop: stopPlayer,
    changeVolume,
    toggleMute,
    snapshot,
    restore,
    setUiHosted,
  } = usePlayer();
  const [cards, setCards] = useState<CardData | null>(null);
  /** 카드 목록 접힘 상태 (헤더만 남기고 아래로 슬라이드) */
  const [cardsCollapsed, setCardsCollapsed] = useState(false);
  const cardsCollapsedRef = useRef(false);
  useEffect(() => {
    cardsCollapsedRef.current = cardsCollapsed;
  }, [cardsCollapsed]);
  // 새 목록이 열리면 펼친 상태로 시작
  useEffect(() => {
    if (cards) setCardsCollapsed(false);
  }, [cards]);
  /** 포커스된 카드 (별 클릭·재생 이동으로 가운데 정렬된 곡) — 테두리 강조용 */
  const [focusedCardId, setFocusedCardId] = useState<number | null>(null);
  /** 우측 드로어 (메뉴 + 행성 프로필 편집) 열림 상태 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** 드로어 프로필 편집 폼 — 열 때 /api/profile에서 로드 */
  const [profile, setProfile] = useState<{
    nickname: string;
    bio: string;
    pinnedSongId: number | null;
    likedSongs: { id: number; title: string; artist: string }[];
  } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  useEffect(() => {
    if (!drawerOpen || !authState.authenticated || profile) return;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          nickname: string;
          bio: string | null;
          pinnedSongId: number | null;
          likedSongs: { id: number; title: string; artist: string }[];
        } | null) => {
          if (d) {
            setProfile({
              nickname: d.nickname,
              bio: d.bio ?? "",
              pinnedSongId: d.pinnedSongId,
              likedSongs: d.likedSongs,
            });
          }
        },
      )
      .catch(() => undefined);
  }, [drawerOpen, authState.authenticated, profile]);
  const saveProfile = useCallback(async () => {
    if (!profile) return;
    setProfileSaving(true);
    try {
      const r = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: profile.nickname,
          bio: profile.bio,
          pinnedSongId: profile.pinnedSongId,
        }),
      });
      const d = (await r.json()) as { nickname?: string; error?: string };
      if (!r.ok) {
        setToast(`⚠ ${d.error ?? "저장에 실패했어요"}`);
      } else {
        if (d.nickname) setNickname(d.nickname);
        setToast("✦ 행성 프로필을 저장했어요");
      }
    } catch {
      setToast("⚠ 저장에 실패했어요");
    } finally {
      setProfileSaving(false);
      setTimeout(() => setToast(null), 2500);
    }
  }, [profile, setNickname]);
  /** 좋아요 별 강조(더 크고 밝게) 표시 여부 — localStorage 유지 */
  const [likedGlowOn, setLikedGlowOn] = useState(true);
  /** 씬의 좋아요 별 강조 갱신 API (three 이펙트가 채움) — 빈 배열이면 강조 제거 */
  const likedGlowApiRef = useRef<((likedIds: number[]) => void) | null>(null);
  useEffect(() => {
    if (localStorage.getItem("songgalaxy-liked-glow") === "off") setLikedGlowOn(false);
  }, []);
  const toggleLikedGlow = useCallback(() => {
    setLikedGlowOn((on) => {
      localStorage.setItem("songgalaxy-liked-glow", on ? "off" : "on");
      return !on;
    });
  }, []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  /** 카드 스크롤 시 화면에 들어온 카드들을 보강 */
  const onCardScroll = useCallback(() => {
    const el = cardScrollRef.current;
    if (!el || !cards) return;
    const cardWidth = 172; // w-40(160px) + gap 12px
    const first = Math.max(0, Math.floor(el.scrollLeft / cardWidth) - 1);
    const visible = cards.songs.slice(first, first + ENRICH_BATCH).map((s) => s.id);
    void fetchMedia(visible);
  }, [cards, fetchMedia]);

  /**
   * 재생 중인 카드가 보이도록 캐러셀만 스크롤.
   * scrollIntoView는 조상 요소(overflow-hidden인 페이지 루트)까지 밀어버려
   * 화면 전체가 잘리는 버그가 있어, 컨테이너 scrollTo로 직접 계산한다.
   */
  const scrollToCard = useCallback((index: number) => {
    const container = cardScrollRef.current;
    const el = container?.children[index] as HTMLElement | undefined;
    if (!container || !el) return;
    const song = cardsRef.current?.songs[index];
    if (song) setFocusedCardId(song.id);
    const elLeft = el.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft;
    container.scrollTo({
      left: elLeft - container.clientWidth / 2 + el.clientWidth / 2,
      behavior: "smooth",
    });
  }, []);

  /** 카드 목록 → 전역 플레이어 큐. 은하로 돌아왔을 때 되살릴 수 있게 통째로 넘긴다 */
  const toQueue = useCallback(
    (cardData: CardData): PlayerQueue => ({
      title: cardData.title,
      subtitle: cardData.subtitle,
      color: cardData.color,
      songs: cardData.songs,
    }),
    [],
  );

  /** 전역 큐 → 카드 목록 (은하 복귀 시 재생 중인 목록을 캐러셀로 되살린다) */
  const toCards = useCallback(
    (q: PlayerQueue): CardData => ({
      title: q.title,
      subtitle: q.subtitle ?? `${q.songs.length}곡`,
      color: q.color ?? "#ffdf9e",
      songs: q.songs.map((s) => ({
        index: s.index ?? -1,
        id: s.id,
        title: s.title,
        artist: s.artist,
        popularity: s.popularity ?? 0,
      })),
    }),
    [],
  );

  /** 착륙 후 자동 라디오 (이슈 #10) — 첫 미리듣기 곡부터 연속 재생 시작 */
  const tryRadio = useCallback(
    async (cardData: CardData | null = cardsRef.current) => {
      if (!cardData || cardData.songs.length === 0) return;
      const firstBatch = cardData.songs.slice(0, ENRICH_BATCH);
      await fetchMedia(firstBatch.map((s) => s.id));
      const target = firstBatch.find((s) => getMedia(s.id)?.previewUrl);
      if (!target) return;
      try {
        await playFrom(toQueue(cardData), target.id);
        setRadioBlocked(false);
      } catch {
        // 브라우저 자동재생 정책에 차단 — 수동 시작 버튼 폴백
        setRadioBlocked(true);
      }
    },
    [fetchMedia, getMedia, playFrom, toQueue],
  );

  useEffect(() => {
    if (skyInfo && cards) {
      if (!autoRadioTried.current) {
        autoRadioTried.current = true;
        void tryRadio(cards);
      }
    } else if (!skyInfo) {
      autoRadioTried.current = false;
      setRadioBlocked(false);
    }
  }, [skyInfo, cards, tryRadio]);

  // 별 더블클릭 재생 (미리듣기 URL을 그 자리에서 확보한 뒤 재생)
  playRequestRef.current = (songId, info) => {
    void (async () => {
      const cardData = cardsRef.current;
      // 열린 목록에 없는 곡(은하에서 직접 찍은 별)은 그 곡 하나짜리 큐로 재생
      const queue: PlayerQueue = cardData?.songs.some((s) => s.id === songId)
        ? toQueue(cardData)
        : {
            title: info?.title ?? "재생 중",
            songs: [
              {
                id: songId,
                title: info?.title ?? "재생 중",
                artist: info?.artist ?? "",
                index: info?.index,
                popularity: info?.popularity,
              },
            ],
          };
      try {
        await playFrom(queue, songId);
      } catch {
        setToast("이 곡은 미리듣기가 제공되지 않아요");
        setTimeout(() => setToast(null), 2500);
      }
    })();
  };

  /** 미리듣기 토글 (한 번에 한 곡만, 끝나면 다음 곡 자동 진행) — 같은 곡은 일시정지/재개 */
  const togglePreview = useCallback(
    (songId: number) => {
      if (playingId === songId) {
        togglePlay();
        return;
      }
      const cardData = cardsRef.current;
      if (cardData) void playFrom(toQueue(cardData), songId).catch(() => undefined);
    },
    [playingId, togglePlay, playFrom, toQueue],
  );

  /** 헤더 재생 컨트롤 — 이전/다음 곡 (미리듣기 없는 곡은 건너뜀) */
  const playStep = useCallback(
    async (dir: -1 | 1) => {
      const cardData = cardsRef.current;
      if (!cardData || cardData.songs.length === 0) return;
      // 목록을 열어둔 채 다른 곡을 듣고 있었다면 이 목록으로 큐를 되돌린다
      await playerStep(dir, toQueue(cardData));
    },
    [playerStep, toQueue],
  );

  /** 헤더 재생/일시정지 — 재생 중이면 토글, 없으면 목록 첫 미리듣기 곡부터 시작 */
  const toggleMainPlay = useCallback(() => {
    if (playingId !== null) {
      togglePlay();
      return;
    }
    void playStep(1);
  }, [playingId, togglePlay, playStep]);

  // 카드 목록 미러 (카드를 닫아도 재생은 이어진다 — 미니플레이어가 이어받음)
  useEffect(() => {
    cardsRef.current = cards;
    setFocusedCardId(null); // 목록이 바뀌면 이전 포커스 해제 (필요 시 scrollToCard가 다시 세팅)
  }, [cards]);

  /**
   * 카드 목록 열기/닫기.
   * 미니플레이어 숨김 신호를 같은 커밋에 함께 보내야 알약과 캐러셀이 겹치지 않는다.
   * (이펙트로 한 박자 뒤에 보내면 느린 기기에서 둘이 몇 초씩 같이 보인다)
   */
  const showCards = useCallback(
    (next: CardData | null) => {
      setCards(next);
      setUiHosted(next !== null);
    },
    [setUiHosted],
  );

  // 위 showCards를 놓친 경로가 있어도 상태가 어긋나지 않도록 하는 보정 +
  // 은하 화면을 떠날 때 알약을 다시 띄우기 위한 정리
  useEffect(() => {
    setUiHosted(cards !== null);
    return () => setUiHosted(false);
  }, [cards, setUiHosted]);

  // 재생 곡이 바뀌거나 목록이 새로 열리면 그 카드를 가운데로
  // (플레이어가 자동 진행한 경우, 은하 복귀로 목록이 되살아난 경우 포함)
  useEffect(() => {
    if (playingId === null || !cards) return;
    const i = cards.songs.findIndex((s) => s.id === playingId);
    if (i < 0) return;
    // 목록이 막 그려진 직후라면 DOM이 준비될 때까지 한 틱 기다린다
    const t = setTimeout(() => scrollToCard(i), 60);
    return () => clearTimeout(t);
  }, [playingId, cards, scrollToCard]);

  /** 이펙트에서 최신 재생 상태를 읽기 위한 미러 (아래 복원 이펙트보다 먼저 선언해야 한다) */
  const playingMirror = useRef<{ queue: PlayerQueue | null; playingId: number | null }>({
    queue: null,
    playingId: null,
  });
  useEffect(() => {
    playingMirror.current = { queue, playingId };
  }, [queue, playingId]);

  /**
   * 은하 화면에 들어온 순간, 재생 중인 목록을 카드 캐러셀로 되살린다.
   * (다른 페이지에서 돌아왔을 때 알약 대신 캐러셀로 보여주기 위함)
   * 진입당 한 번만 — 그러지 않으면 사용자가 ✕로 닫는 즉시 다시 열려버린다.
   */
  const cardsRestored = useRef(false);
  useEffect(() => {
    if (status !== "ready" || cardsRestored.current) return;
    cardsRestored.current = true;
    const { queue: q, playingId: pid } = playingMirror.current;
    if (!q || pid === null) return;
    showCards(toCards(q));
  }, [status, toCards, showCards]);

  /**
   * 행성 착륙 전 은하에서 듣던 곡 — 은하로 나올 때 이 곡을 그 위치부터 이어 듣는다.
   * 행성→행성 이동에서는 유지해야 하므로 착륙 시퀀스가 직접 관리한다.
   */
  const galaxySnapshot = useRef<PlayerSnapshot | null>(null);
  /** three 이펙트(마운트 1회)에서 최신 플레이어 API를 읽기 위한 미러 */
  const playerApiRef = useRef({ snapshot, restore, stop: stopPlayer });
  useEffect(() => {
    playerApiRef.current = { snapshot, restore, stop: stopPlayer };
  }, [snapshot, restore, stopPlayer]);
  const toCardsRef = useRef(toCards);
  useEffect(() => {
    toCardsRef.current = toCards;
  }, [toCards]);

  // /me의 "은하에서 내 별 보기" (?star=me) — 별 좌표가 도착하면 한 번만 비행한다
  const myStarFlown = useRef(false);
  useEffect(() => {
    if (!focusMyStar || myStarFlown.current) return;
    const s = authState.star;
    if (!s) return;
    myStarFlown.current = true;
    // 씬이 자리를 잡은 뒤 날아가도록 약간 지연
    const t = setTimeout(() => flyToPosRef.current?.(s.x, s.y, s.z, 120), 1500);
    return () => clearTimeout(t);
  }, [focusMyStar, authState.star]);

  // 좋아요 별 강조 동기화 — 좋아요 목록·토글이 바뀌거나 씬이 준비되면 다시 그린다
  useEffect(() => {
    likedGlowApiRef.current?.(likedGlowOn ? [...authState.likedIds] : []);
  }, [authState.likedIds, likedGlowOn, status]);

  /** 내 별로 이동 — 행성 모드에서는 은하 좌표 비행이 카메라를 깨뜨리므로 착륙 전환으로 동작 */
  const goMyStar = useCallback(() => {
    if (skyInfo) {
      if (authState.userId != null && skyInfo.userId === authState.userId) {
        setToast("✦ 지금 내 별 위에 있어요");
        setTimeout(() => setToast(null), 2500);
      } else if (authState.userId != null) {
        landByUserRef.current?.(authState.userId);
      }
      return;
    }
    const s = authState.star;
    if (s) flyToPosRef.current?.(s.x, s.y, s.z, 120);
  }, [skyInfo, authState.userId, authState.star]);

  /** 행성 링크 복사 */
  const copyPlanetLink = useCallback(() => {
    if (!skyInfo) return;
    void navigator.clipboard
      .writeText(`${window.location.origin}/planet/${skyInfo.userId}`)
      .then(() => {
        setToast("🔗 행성 링크를 복사했어요");
        setTimeout(() => setToast(null), 3000);
      });
  }, [skyInfo]);

  /**
   * 좋아요 토글 — 상태 갱신은 공용 컨텍스트가 하고,
   * 여기서는 은하에서만 필요한 후처리(별 좌표 반영·탄생 연출)를 얹는다 (D6·D7).
   */
  const toggleLike = useCallback(
    async (songId: number) => {
      const data = await toggleLikeBase(songId);
      if (!data?.star || authState.userId == null) return;
      starApiRef.current?.({
        userId: authState.userId,
        nickname: authState.nickname ?? "나",
        ...data.star,
      });
      if (data.starBorn) {
        setToast("🌟 내 별이 태어났어요!");
        const s = data.star;
        setTimeout(() => flyToPosRef.current?.(s.x, s.y, s.z, 120), 400);
        setTimeout(() => setToast(null), 4500);
      }
    },
    [toggleLikeBase, authState.userId, authState.nickname],
  );

  // 카드가 열리면 첫 배치 보강
  useEffect(() => {
    if (cards) void fetchMedia(cards.songs.slice(0, ENRICH_BATCH).map((s) => s.id));
  }, [cards, fetchMedia]);

  useEffect(() => {
    const container = containerRef.current;
    const labelLayer = labelLayerRef.current;
    if (!container || !labelLayer) return;

    let disposed = false;
    let frameId = 0;

    /**
     * 네트워크를 가장 먼저 띄운다.
     * 아래 WebGL 씬 구성(셰이더 컴파일·배경별 생성 등)이 1초 가까이 걸리는데,
     * 그동안 요청이 놀고 있으면 그만큼 첫 화면이 늦어진다. 겹쳐서 진행시킨다.
     */
    const payloadPromise = fetch("/api/galaxy").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<GalaxyPayload>;
    });

    // 터치 기기는 필레이트가 약해 해상도·MSAA·글로우층을 줄인다 (모바일 렉 대책)
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: !isCoarse });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarse ? 1.5 : 2));
    renderer.setClearColor(GALAXY_BG);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 1, 20000);
    camera.position.set(0, OVERVIEW_DISTANCE * 0.35, OVERVIEW_DISTANCE);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 20;
    controls.maxDistance = 6000;
    controls.zoomToCursor = true; // 휠 줌이 커서가 가리키는 성단 쪽으로 파고들게

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    // 원경 배경 별 (장식용, 데이터와 무관) — 각자 위상이 다른 반짝임 (#8 미학)
    let bgStarsMat: THREE.ShaderMaterial | null = null;
    {
      const n = 1600;
      const pos = new Float32Array(n * 3);
      const phase = new Float32Array(n);
      const rng = () => Math.random() * 2 - 1;
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(rng(), rng(), rng()).normalize().multiplyScalar(7000 + Math.random() * 5000);
        pos.set([v.x, v.y, v.z], i * 3);
        phase[i] = Math.random() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
      bgStarsMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aPhase;
          varying float vPhase;
          void main() {
            vPhase = aPhase;
            gl_PointSize = 2.2;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying float vPhase;
          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            if (length(uv) > 0.5) discard;
            float twinkle = 0.25 + 0.4 * (0.5 + 0.5 * sin(uTime * 1.6 + vPhase));
            gl_FragColor = vec4(0.62, 0.68, 0.82, twinkle);
          }
        `,
        transparent: true,
        depthWrite: false,
      });
      scene.add(new THREE.Points(geo, bgStarsMat));
    }

    // 라벨 DOM 유틸 (onClick이 있으면 클릭 가능한 내비게이션 라벨)
    interface Label {
      el: HTMLDivElement;
      pos: THREE.Vector3;
      theme?: GalaxyTheme;
    }
    const makeLabel = (
      text: string,
      cls: string,
      color?: string,
      onClick?: () => void,
    ): HTMLDivElement => {
      const el = document.createElement("div");
      // 글자는 안쪽 span에 둔다 — 바깥 div의 transform은 화면 투영이 매 프레임
      // 덮어쓰므로, 호버 확대 같은 연출은 안쪽에서만 걸 수 있다
      const inner = document.createElement("span");
      inner.className = "galaxy-label-text";
      inner.textContent = text;
      el.appendChild(inner);
      el.className = `galaxy-label ${cls}`;
      if (color) el.style.color = color;
      if (onClick) {
        el.classList.add("clickable");
        el.addEventListener("click", onClick);
      }
      labelLayer.appendChild(el);
      return el;
    };

    const clusterLabels: (Label & { theme: GalaxyTheme })[] = [];
    const subLabels: (Label & { theme: GalaxyTheme; parent: GalaxyTheme })[] = [];
    const songLabels: { el: HTMLDivElement; index: number }[] = [];
    let payload: GalaxyPayload | null = null;
    let positions: Float32Array | null = null;
    let points: THREE.Points | null = null;
    let haloMat: THREE.ShaderMaterial | null = null;
    let minimapClusters: GalaxyTheme[] = [];

    /** 미니맵(XZ 평면 투영): 성단 배치 + 현재 카메라 위치·방향 (#8 길잃음 방지) */
    const drawMinimap = () => {
      const canvas = minimapRef.current;
      if (!canvas || minimapClusters.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const size = canvas.width;
      const half = size / 2;
      const scale = (half - 10) / 950; // 은하 반경 + 여유
      ctx.clearRect(0, 0, size, size);
      // 은하 외곽
      ctx.beginPath();
      ctx.arc(half, half, 950 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.stroke();
      // 성단
      for (const c of minimapClusters) {
        ctx.beginPath();
        ctx.arc(half + c.x * scale, half + c.z * scale, Math.max(3, c.radius * scale * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = `${c.color}55`;
        ctx.fill();
      }
      // 카메라 위치(점) + 바라보는 방향(선)
      const cx = half + Math.max(-half + 4, Math.min(half - 4, camera.position.x * scale));
      const cz = half + Math.max(-half + 4, Math.min(half - 4, camera.position.z * scale));
      const dir = controls.target.clone().sub(camera.position).normalize();
      ctx.beginPath();
      ctx.moveTo(cx, cz);
      ctx.lineTo(cx + dir.x * 12, cz + dir.z * 12);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cz, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    };

    // 유저 별 (은하 주민, D2) — 크고 밝은 별 + 닉네임 라벨, 이동은 lerp로 부드럽게 (D6)
    const STAR_CAP = 64;
    const starPositions = new Float32Array(STAR_CAP * 3);
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeo.setDrawRange(0, 0);
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(2600.0 / -mv.z, 12.0, 72.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.14, 0.0, d);
          float glow = smoothstep(0.5, 0.04, d) * 0.5;
          float tw = 0.88 + 0.12 * sin(uTime * 2.2);
          vec3 col = mix(vec3(1.0, 0.84, 0.5), vec3(1.0), core);
          gl_FragColor = vec4(col, (core + glow) * tw);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const starPoints = new THREE.Points(starGeo, starMat);
    scene.add(starPoints);

    interface StarEntry {
      data: GalaxyStar;
      cur: THREE.Vector3;
      target: THREE.Vector3;
      label: HTMLDivElement;
    }
    const userStars: StarEntry[] = [];
    // 밤하늘 모드 상태 (이슈 #9) — 값 할당은 아래 착륙 기계부에서
    let skyActive = false;
    let skyStarPos: THREE.Vector3 | null = null;
    let dimScale = 1; // 성운 글로우 dim 배율 (밤하늘 모드에서 축소)
    const upsertStar = (star: GalaxyStar) => {
      const target = new THREE.Vector3(star.x, star.y, star.z);
      const existing = userStars.find((s) => s.data.userId === star.userId);
      if (existing) {
        existing.data = star;
        existing.target.copy(target); // 새 좌표로 부드럽게 이동 (animate에서 lerp)
        return;
      }
      if (userStars.length >= STAR_CAP) return;
      const entry: StarEntry = {
        data: star,
        cur: target.clone(),
        target,
        label: null as unknown as HTMLDivElement,
      };
      // 닉네임 라벨 클릭 = 그 별에 착륙
      entry.label = makeLabel(star.nickname, "star", undefined, () => landOnStar(entry));
      userStars.push(entry);
      starGeo.setDrawRange(0, userStars.length);
    };
    starApiRef.current = upsertStar;

    // fly-to 애니메이션 상태
    let fly: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number } | null = null;
    /** 최근 클릭/이동한 곡 — 밀집 지역에서도 제목 라벨이 풀에서 밀려나지 않게 항상 포함 */
    let focusedSongIndex = -1;
    const flyTo = (target: THREE.Vector3, distance: number) => {
      const dir = camera.position.clone().sub(target).normalize();
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1).normalize();
      fly = {
        fromPos: camera.position.clone(),
        toPos: target.clone().add(dir.multiplyScalar(distance)),
        fromTarget: controls.target.clone(),
        toTarget: target.clone(),
        start: performance.now(),
      };
    };
    resetRef.current = () => {
      if (skyActive || pendingSky) {
        exitSky();
        return;
      }
      // 재생 중이면 목록을 유지한 채 카메라만 되돌린다.
      // (닫아버리면 은하에서 알약이 튀어나와 "은하에서는 캐러셀" 규칙이 깨진다)
      if (playingMirror.current.playingId === null) showCards(null);
      flyTo(new THREE.Vector3(0, 0, 0), OVERVIEW_DISTANCE);
    };
    flyToPosRef.current = (x, y, z, dist) => flyTo(new THREE.Vector3(x, y, z), dist);

    // ── 좋아요 별 강조: 내가 좋아요한 곡을 더 크고 밝게 (은하 모드 전용) ──
    // 기존 포인트 위에 흰빛 섞은 색 + 2.2배 크기의 포인트를 겹쳐(additive) 또렷하게 빛낸다
    let likedGlow: THREE.Points | null = null;
    let songIndexById: Map<number, number> | null = null;
    likedGlowApiRef.current = (likedIds) => {
      if (likedGlow) {
        scene.remove(likedGlow);
        likedGlow.geometry.dispose();
        (likedGlow.material as THREE.Material).dispose();
        likedGlow = null;
      }
      if (!positions || !payload || !songIndexById || likedIds.length === 0) return;
      const themeById = new Map(payload.themes.map((t) => [t.id, t]));
      const pos: number[] = [];
      const col: number[] = [];
      const siz: number[] = [];
      const tmp = new THREE.Color();
      const white = new THREE.Color("#ffffff");
      for (const id of likedIds) {
        const i = songIndexById.get(id);
        if (i == null) continue;
        pos.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        tmp.set(themeById.get(payload.songs.themeId[i])?.color ?? "#ffffff").lerp(white, 0.5);
        col.push(tmp.r, tmp.g, tmp.b);
        siz.push((1.6 + (payload.songs.popularity[i] / 100) * 3.2) * 2.2);
      }
      if (pos.length === 0) return;
      likedGlow = makePointsLayer(new Float32Array(pos), new Float32Array(col), new Float32Array(siz), 1);
      scene.add(likedGlow);
    };
    flySongRef.current = (index: number) => {
      if (!positions || !payload) return;
      const p = new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
      if (skyActive && skyStarPos) {
        // 밤하늘 모드: 별 위에 선 채로 그 곡의 돔 위치로 시선만 회전 + 선택 링 표시.
        // 카드 목록이 내려가 있으면 올리고, 해당 곡 카드를 가운데로 포커스
        const cardData = cardsRef.current;
        if (cardData) {
          const k = cardData.songs.findIndex((s) => s.index === index);
          if (k >= 0) {
            const wasCollapsed = cardsCollapsedRef.current;
            if (wasCollapsed) setCardsCollapsed(false);
            setTimeout(() => scrollToCard(k), wasCollapsed ? 380 : 0);
          }
        }
        const domeP = skyDomePos?.get(index) ?? p;
        if (skyRing) {
          (skyRing.geometry.attributes.position as THREE.BufferAttribute).setXYZ(
            0,
            domeP.x,
            domeP.y,
            domeP.z,
          );
          skyRing.geometry.attributes.position.needsUpdate = true;
          skyRing.geometry.computeBoundingSphere();
          skyRing.visible = true;
        }
        const dir = domeP.clone().sub(camera.position).normalize();
        fly = {
          fromPos: camera.position.clone(),
          toPos: camera.position.clone(),
          fromTarget: controls.target.clone(),
          toTarget: camera.position.clone().addScaledVector(dir, 2),
          start: performance.now(),
        };
        return; // 행성에서는 요약 패널 없이 카드 포커스가 정보를 보여준다
      }
      // 은하 모드: 곡으로 비행 + 행성과 동일하게 카드 가운데 포커스
      flyTo(p, 45);
      focusedSongIndex = index;
      const currentCards = cardsRef.current;
      const inList = currentCards ? currentCards.songs.findIndex((s) => s.index === index) : -1;
      if (currentCards && inList >= 0) {
        // 열려 있는 목록에 곡이 있으면 (접혀 있으면 펼치고) 가운데로
        const wasCollapsed = cardsCollapsedRef.current;
        if (wasCollapsed) setCardsCollapsed(false);
        setTimeout(() => scrollToCard(inList), wasCollapsed ? 380 : 0);
      } else {
        // 목록이 없거나 다른 목록이면 그 곡의 세부 장르 목록을 열어 포커스
        const sub = payload.themes.find((t) => t.id === payload!.songs.themeId[index]);
        const parent =
          sub?.parentId != null ? payload.themes.find((t) => t.id === sub.parentId) : undefined;
        if (sub && parent) {
          let songs = collectSongs((id) => id === sub.id);
          let k = songs.findIndex((s) => s.index === index);
          if (k < 0) {
            // 인기순 150곡 밖의 곡 — 클릭한 곡을 맨 앞에 끼워 항상 보이게
            songs = [
              {
                index,
                id: payload.songs.id[index],
                title: payload.songs.title[index],
                artist: payload.songs.artist[index],
                popularity: payload.songs.popularity[index],
              },
              ...songs,
            ];
            k = 0;
          }
          showCards({
            title: sub.label,
            subtitle: `${parent.label} · ${songs.length}곡`,
            color: sub.color,
            songs,
          });
          setCardsCollapsed(false);
          setTimeout(() => scrollToCard(k), 150);
        }
      }
    };

    // ── 행성 착륙: 그 사람의 밤하늘 (이슈 #9) ─────────────────────────
    // 연출 방향: "동물의 숲에서 하늘 보기" — 은하를 통째로 숨기고
    // 전용 밤하늘 씬(그라데이션 하늘 돔 + 곡면 지평선 + 잔별 + 유성)으로 전환.
    // 좋아요 곡들은 실제 은하 좌표가 아니라 하늘 돔 위에 보기 좋게 배치한다.
    let skyGroup: THREE.Group | null = null;
    let skyTwinkleMat: THREE.ShaderMaterial | null = null; // 잔별 반짝임 시간 갱신용
    let skyDomePos: Map<number, THREE.Vector3> | null = null; // songIndex → 돔 좌표
    let skyHighlightPoints: THREE.Points | null = null; // 밤하늘 곡 별 (클릭 판정용)
    let skyHighlightIdx: number[] = []; // 포인트 k번째 → songIndex
    let skyRing: THREE.Points | null = null; // 선택된 별 글로우 링 (이슈 #10-4)
    let skyRingMat: THREE.ShaderMaterial | null = null;
    let skyGroundMat: THREE.ShaderMaterial | null = null; // 발밑 별빛 펄스용
    let hoveredK = -1; // 호버 중인 밤하늘 별 인덱스
    let skyLabels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
    let landingTimers: number[] = [];
    let pendingSky: { entry: StarEntry; songIds: number[] | null } | null = null;
    let flightDone = false;
    // 유성 (동물의 숲 감성 포인트)
    let meteor: { obj: THREE.Points; from: THREE.Vector3; to: THREE.Vector3; start: number } | null = null;
    let meteorNextAt = 0;

    /** 밤하늘 진입 — 전용 스카이돔 씬 구성 */
    const enterSky = (entry: StarEntry, songIds: number[]) => {
      if (!payload || !positions) return;
      skyActive = true;
      skyStarPos = entry.cur.clone();
      fly = null;
      // 은하 씬 통째로 숨김 (복귀 시 visible 복원)
      scene.children.forEach((o) => (o.visible = false));

      const C = skyStarPos;
      const up = new THREE.Vector3(0, 1, 0);
      skyGroup = new THREE.Group();
      // 행성 주인의 테마 (SSOT: planet-themes.ts) — 방문자에게도 주인의 색으로
      const planet = getPlanetTheme(entry.data.planetTheme);

      // 1) 하늘 돔 — 테마 색 그라데이션 + 지평선 글로우 밴드 (이슈 #10-3)
      const domeMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uHorizon: { value: new THREE.Color(planet.horizon) },
          uZenith: { value: new THREE.Color(planet.zenith) },
          uGlow: { value: new THREE.Color(planet.glow) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uHorizon;
          uniform vec3 uZenith;
          uniform vec3 uGlow;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, 0.0, 1.0);
            vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
            // 지평선 글로우 밴드 — 땅과 하늘이 만나는 곳의 은은한 빛
            col += uGlow * exp(-abs(vDir.y) * 10.0) * 0.45;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(750, 32, 24), domeMat);
      dome.position.copy(C);
      skyGroup.add(dome);

      // 2) 지면 — 작은 행성 위에 선 듯한 곡면 지평선 (테마 색).
      // "내가 서 있는 곳이 곧 내 별"이라는 걸 보여주기 위해, 서 있는 지점을
      // 중심으로 별빛이 배어나오는 글로우를 지면에 그린다 (착륙하면 별이
      // 사라져 보인다는 피드백 대응 — 별은 없어진 게 아니라 발밑에 있다)
      const groundMat = new THREE.ShaderMaterial({
        uniforms: {
          uGround: { value: new THREE.Color(planet.ground) },
          uStarGlow: { value: new THREE.Color("#ffd98a") },
          uCenter: { value: C.clone() },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uGround;
          uniform vec3 uStarGlow;
          uniform vec3 uCenter;
          uniform float uTime;
          varying vec3 vWorld;
          void main() {
            float d = distance(vWorld, uCenter);
            float pulse = 0.85 + 0.15 * sin(uTime * 1.4);
            // 발밑(별의 심장)에서 배어나오는 별빛 — 멀어질수록 잦아든다
            vec3 col = uGround + uStarGlow * exp(-d / 60.0) * 0.85 * pulse;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      });
      skyGroundMat = groundMat;
      const ground = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), groundMat);
      ground.position.copy(C).addScaledVector(up, -298.5); // 꼭대기가 발밑 ~1.5 아래
      skyGroup.add(ground);

      // 2-1) 지평선 언덕 실루엣 — 유저별 시드로 굴곡이 다른 원형 능선 (이슈 #10-3)
      {
        const segments = 160;
        const ringR = 620;
        const rng = mulberry32(hashString(`hill:${entry.data.userId}`));
        const p1 = rng() * Math.PI * 2;
        const p2 = rng() * Math.PI * 2;
        const p3 = rng() * Math.PI * 2;
        const verts = new Float32Array((segments + 1) * 2 * 3);
        for (let i = 0; i <= segments; i++) {
          const a = (i / segments) * Math.PI * 2;
          const h =
            10 +
            14 * Math.abs(Math.sin(a * 2 + p1)) +
            9 * Math.abs(Math.sin(a * 5 + p2)) +
            5 * Math.sin(a * 9 + p3);
          const x = C.x + ringR * Math.cos(a);
          const z = C.z + ringR * Math.sin(a);
          verts.set([x, C.y - 40, z], i * 6);
          verts.set([x, C.y + h, z], i * 6 + 3);
        }
        const index: number[] = [];
        for (let i = 0; i < segments; i++) {
          const b = i * 2;
          index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
        geo.setIndex(index);
        const silColor = new THREE.Color(planet.ground).multiplyScalar(0.55);
        const sil = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color: silColor, side: THREE.DoubleSide }),
        );
        skyGroup.add(sil);
      }

      // 3) 장식 잔별 900개 — 각자 위상이 다른 반짝임 (배경 별 셰이더와 동일 패턴)
      {
        const n = 900;
        const pos = new Float32Array(n * 3);
        const phase = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const azim = Math.random() * Math.PI * 2;
          const elev = Math.asin(Math.random()); // 위쪽 반구 균일
          const r = 680;
          pos[i * 3] = C.x + r * Math.cos(elev) * Math.cos(azim);
          pos[i * 3 + 1] = C.y + r * Math.sin(elev) * 0.98 + 6;
          pos[i * 3 + 2] = C.z + r * Math.cos(elev) * Math.sin(azim);
          phase[i] = Math.random() * Math.PI * 2;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
        const mat = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 } },
          vertexShader: /* glsl */ `
            attribute float aPhase;
            varying float vPhase;
            void main() {
              vPhase = aPhase;
              gl_PointSize = 2.4;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uTime;
            varying float vPhase;
            void main() {
              vec2 uv = gl_PointCoord - 0.5;
              if (length(uv) > 0.5) discard;
              float tw = 0.3 + 0.5 * (0.5 + 0.5 * sin(uTime * 1.8 + vPhase));
              gl_FragColor = vec4(0.75, 0.8, 0.95, tw);
            }
          `,
          transparent: true,
          depthWrite: false,
        });
        skyTwinkleMat = mat;
        skyGroup.add(new THREE.Points(geo, mat));
      }

      // 4) 좋아요 곡 별들 — 하늘 돔 위 골든앵글 나선 배치 (최근 곡일수록 눈높이 가까이)
      const idxs = songIds.map((id) => payload!.songs.id.indexOf(id)).filter((i) => i >= 0);
      const n = idxs.length;
      skyDomePos = new Map();
      const hPos = new Float32Array(n * 3);
      const hCol = new Float32Array(n * 3);
      const hSize = new Float32Array(n);
      // 별 색 = 그 곡의 장르(성단) 색 — 밤하늘에서도 취향의 장르 분포가 색으로 보인다
      const themeById = new Map(payload!.themes.map((th) => [th.id, th]));
      const songColor = (si: number) => themeById.get(payload!.songs.themeId[si])?.color ?? "#ffdf9e";
      const tmpColor = new THREE.Color();
      idxs.forEach((si, k) => {
        const frac = n === 1 ? 0.4 : k / (n - 1);
        // 상반구 전체 사용: 최근(k=0)은 정면 눈높이, 오래될수록 천정(정수리) 쪽으로
        const elev = ((14 + 70 * frac) * Math.PI) / 180;
        const azim = k * 2.399963; // 골든앵글 — 방위 360° 고르게
        const r = 430;
        const p = new THREE.Vector3(
          C.x + r * Math.cos(elev) * Math.cos(azim),
          C.y + r * Math.sin(elev),
          C.z + r * Math.cos(elev) * Math.sin(azim),
        );
        skyDomePos!.set(si, p);
        hPos.set([p.x, p.y, p.z], k * 3);
        tmpColor.set(songColor(si));
        hCol.set([tmpColor.r, tmpColor.g, tmpColor.b], k * 3);
        hSize[k] = 10 + (payload!.songs.popularity[si] / 100) * 5;
      });
      skyHighlightPoints = makePointsLayer(hPos, hCol, hSize, 1);
      skyHighlightIdx = idxs.slice();
      skyGroup.add(skyHighlightPoints);

      // 선택된 별 글로우 링 (숨김 상태로 준비, 곡 선택 시 표시)
      {
        const ringGeo = new THREE.BufferGeometry();
        ringGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
        skyRingMat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: { uTime: { value: 0 } },
          vertexShader: /* glsl */ `
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = clamp(9000.0 / -mv.z, 40.0, 110.0);
              gl_Position = projectionMatrix * mv;
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uTime;
            void main() {
              vec2 uv = gl_PointCoord - 0.5;
              float d = length(uv);
              float ring = smoothstep(0.30, 0.34, d) * smoothstep(0.44, 0.40, d);
              float pulse = 0.7 + 0.3 * sin(uTime * 3.0);
              gl_FragColor = vec4(1.0, 0.95, 0.8, ring * pulse);
            }
          `,
        });
        skyRing = new THREE.Points(ringGeo, skyRingMat);
        skyRing.visible = false;
        skyGroup.add(skyRing);
      }
      skyLabels = idxs.map((si) => ({
        el: makeLabel(payload!.songs.title[si], "song sky", songColor(si)),
        pos: skyDomePos!.get(si)!.clone(),
      }));

      // 5) 유성 준비
      {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
        const mat = new THREE.PointsMaterial({
          color: 0xfff4d6,
          size: 5,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const obj = new THREE.Points(geo, mat);
        skyGroup.add(obj);
        meteor = { obj, from: new THREE.Vector3(), to: new THREE.Vector3(), start: -1 };
        meteorNextAt = performance.now() + 3000;
      }

      scene.add(skyGroup);

      // 카메라: 행성 표면 위에 "서서" 1인칭 고개 돌리기.
      // 타깃을 눈앞 2유닛에 두면 드래그가 공전이 아니라 시선 회전이 된다.
      // 줌은 잠그고(제자리), 드래그 방향은 하늘을 잡아끄는 감각으로 반전.
      const eye = C.clone().addScaledVector(up, 3.5);
      camera.position.copy(eye);
      const firstDome = idxs.length > 0 ? skyDomePos.get(idxs[0])! : C.clone().add(new THREE.Vector3(430, 120, 0));
      const viewDir = firstDome.clone().sub(eye).normalize();
      controls.target.copy(eye).addScaledVector(viewDir, 2);
      controls.minDistance = 2;
      controls.maxDistance = 2;
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.rotateSpeed = -0.45;
      // 극각은 "타깃 기준 카메라"의 각도라 위를 보려면 카메라가 타깃 아래로 가야 한다(각도↑).
      // min: 시선이 지평선 아래 -25°까지만 (발밑 방지) / max: 정수리(천정)까지
      controls.minPolarAngle = Math.PI * 0.36;
      controls.maxPolarAngle = Math.PI - 0.02;

      // 하단 카드: ○○의 밤하늘 (최근 좋아요 순서 유지)
      showCards({
        title: `✦ ${entry.data.nickname}의 밤하늘`,
        subtitle: `좋아요 ${n}곡`,
        color: "#ffdf9e",
        songs: idxs.map((si) => ({
          index: si,
          id: payload!.songs.id[si],
          title: payload!.songs.title[si],
          artist: payload!.songs.artist[si],
          popularity: payload!.songs.popularity[si],
        })),
      });
      setSkyInfo((prev) =>
        prev?.userId === entry.data.userId
          ? prev
          : { userId: entry.data.userId, nickname: entry.data.nickname },
      );
    };

    /** 착륙 시퀀스: 접근 비행 → 진입 플래시 → 밤하늘 (준비되면 진입, 클릭 시 스킵) */
    const applySkyIfReady = () => {
      if (pendingSky && flightDone && pendingSky.songIds != null) {
        const { entry, songIds } = pendingSky;
        pendingSky = null;
        flightDone = false;
        enterSky(entry, songIds);
        window.setTimeout(() => setFlash(false), 250);
      }
    };
    const landOnStar = (entry: StarEntry) => {
      if (skyActive || pendingSky) return;
      // 은하에서 듣던 곡을 기억 — 착륙하면 행성 라디오로 바뀌고, 나올 때 여기서 이어 듣는다
      galaxySnapshot.current = playerApiRef.current.snapshot();
      pendingSky = { entry, songIds: null };
      showCards(null);
      setSkyInfo({ userId: entry.data.userId, nickname: entry.data.nickname });
      // 좋아요 목록·행성 정보는 비행하는 동안 미리 로드
      fetch(`/api/users/${entry.data.userId}/likes`)
        .then((r) => (r.ok ? r.json() : { songIds: [] }))
        .then(
          (d: {
            songIds: number[];
            likesCount?: number;
            lastLikedAt?: string | null;
            clusters?: PlanetInfo["clusters"];
            bio?: string | null;
            pinnedSongId?: number | null;
          }) => {
            if (pendingSky?.entry === entry) {
              let songIds = d.songIds ?? [];
              // 대표곡이 있으면 맨 앞으로 — 착륙 라디오가 이 곡부터 시작한다
              if (d.pinnedSongId != null && songIds.includes(d.pinnedSongId)) {
                songIds = [d.pinnedSongId, ...songIds.filter((id) => id !== d.pinnedSongId)];
              }
              pendingSky.songIds = songIds;
              setSkyInfo((prev) =>
                prev?.userId === entry.data.userId
                  ? {
                      ...prev,
                      likesCount: d.likesCount,
                      lastLikedAt: d.lastLikedAt,
                      clusters: d.clusters,
                      bio: d.bio,
                    }
                  : prev,
              );
              applySkyIfReady();
            }
          },
        )
        .catch(() => {
          if (pendingSky?.entry === entry) {
            pendingSky.songIds = [];
            applySkyIfReady();
          }
        });
      flyTo(entry.cur.clone(), 70); // 접근 비행
      landingTimers.push(window.setTimeout(() => setFlash(true), 1100)); // 도착 직전 플래시
      landingTimers.push(
        window.setTimeout(() => {
          flightDone = true;
          applySkyIfReady();
        }, 1400),
      );
    };
    /** 연출 중 클릭 → 즉시 완성 상태로 스킵 (D19) */
    const skipLanding = () => {
      landingTimers.forEach(clearTimeout);
      landingTimers = [];
      setFlash(false);
      flightDone = true;
      applySkyIfReady(); // songIds가 아직이면 fetch 완료 시 진입
    };

    /** 밤하늘에서 은하로 복귀 */
    const exitSky = () => {
      landingTimers.forEach(clearTimeout);
      landingTimers = [];
      pendingSky = null;
      flightDone = false;
      setFlash(false);
      if (!skyActive) {
        setSkyInfo(null);
        return;
      }
      skyActive = false;
      skyStarPos = null;
      skyDomePos = null;
      skyTwinkleMat = null;
      skyHighlightPoints = null;
      skyHighlightIdx = [];
      skyRing = null;
      skyRingMat = null;
      skyGroundMat = null;
      hoveredK = -1;
      renderer.domElement.style.cursor = "";
      meteor = null;
      if (skyGroup) {
        scene.remove(skyGroup);
        skyGroup.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        skyGroup = null;
      }
      scene.children.forEach((o) => (o.visible = true)); // 은하 복원
      skyLabels.forEach((l) => l.el.remove());
      skyLabels = [];
      controls.minDistance = 20;
      controls.maxDistance = 6000;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.rotateSpeed = 1;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      setSkyInfo(null);
      // 행성 라디오를 끄고, 착륙 전 은하에서 듣던 곡을 그 위치부터 이어 재생.
      // 듣던 목록은 카드 캐러셀로 되살려 그대로 이어 들을 수 있게 한다
      const snap = galaxySnapshot.current;
      galaxySnapshot.current = null;
      if (snap) {
        void playerApiRef.current.restore(snap);
        showCards(snap.queue ? toCardsRef.current(snap.queue) : null);
      } else {
        playerApiRef.current.stop();
        showCards(null);
      }
      flyTo(new THREE.Vector3(0, 0, 0), OVERVIEW_DISTANCE);
    };
    exitSkyRef.current = exitSky;
    landByUserRef.current = (uid: number) => {
      const target = userStars.find((s) => s.data.userId === uid);
      if (!target) return;
      if (skyActive) {
        // 행성→행성 이동: 은하 스냅샷은 그대로 두고 정리만 한다
        const keep = galaxySnapshot.current;
        exitSky();
        galaxySnapshot.current = keep;
      }
      landOnStar(target);
    };

    /** 특정 테마(성단 또는 세부 장르)에 속한 곡 인덱스를 인기순 카드 데이터로 만든다 */
    const collectSongs = (match: (subThemeId: number) => boolean): CardSong[] => {
      if (!payload) return [];
      const items: CardSong[] = [];
      for (let i = 0; i < payload.songs.id.length; i++) {
        if (match(payload.songs.themeId[i])) {
          items.push({
            index: i,
            id: payload.songs.id[i],
            title: payload.songs.title[i],
            artist: payload.songs.artist[i],
            popularity: payload.songs.popularity[i],
          });
        }
      }
      items.sort((a, b) => b.popularity - a.popularity);
      return items.slice(0, CARD_LIMIT);
    };

    /** 성단 클릭 → 성단 전체 인기곡 카드. 세부 장르 라벨이 보이는 거리(1.5R)까지 진입 */
    const openCluster = (cluster: GalaxyTheme) => {
      if (!payload) return;
      flyTo(new THREE.Vector3(cluster.x, cluster.y, cluster.z), cluster.radius * 1.5);
      const childIds = new Set(
        payload.themes.filter((t) => t.parentId === cluster.id).map((t) => t.id),
      );
      const songs = collectSongs((id) => childIds.has(id));
      showCards({
        title: cluster.label,
        subtitle: `성단 전체 인기곡 · ${songs.length}곡`,
        color: cluster.color,
        songs,
      });
      cardScrollRef.current?.scrollTo({ left: 0 });
    };

    /** 세부 장르 클릭 → 그 장르 곡 카드 */
    const openTheme = (theme: GalaxyTheme, parent: GalaxyTheme) => {
      if (!payload) return;
      flyTo(new THREE.Vector3(theme.x, theme.y, theme.z), theme.radius * 2.4);
      const songs = collectSongs((id) => id === theme.id);
      showCards({
        title: theme.label,
        subtitle: `${parent.label} · ${songs.length}곡`,
        color: theme.color,
        songs,
      });
      cardScrollRef.current?.scrollTo({ left: 0 });
    };

    // 클릭(드래그 아님) → 곡 선택
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 6;
    let downAt: [number, number] | null = null;
    const onPointerDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
    const onPointerUp = (e: PointerEvent) => {
      if (!downAt || !points || !payload) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 5) return;
      // 착륙 연출 중 클릭 → 스킵 (D19)
      if (pendingSky) {
        skipLanding();
        return;
      }
      // 터치 기기: 라벨의 pointer-events가 꺼져 있으므로 탭 좌표로 라벨 클릭을 직접 판정
      // (세부 장르 라벨이 성단 라벨 위에 겹치므로 lv2 먼저)
      if (isCoarse && !skyActive) {
        for (const l of [...subLabels, ...clusterLabels]) {
          if (parseFloat(l.el.style.opacity || "0") < 0.35) continue;
          const r = l.el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            l.el.click();
            return;
          }
        }
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      // 밤하늘 모드: 하늘의 곡 별만 클릭 대상 — 숨겨진 은하 포인트는 레이캐스트 금지
      // (three 레이캐스터는 visible=false여도 검사하므로, 안 막으면 엉뚱한 곡이 잡힌다)
      if (skyActive) {
        if (skyHighlightPoints) {
          raycaster.params.Points.threshold = 14;
          const hit = raycaster.intersectObject(skyHighlightPoints)[0];
          raycaster.params.Points.threshold = 6;
          const songIndex = hit?.index != null ? skyHighlightIdx[hit.index] : undefined;
          if (songIndex != null) flySongRef.current?.(songIndex);
        }
        return;
      }
      // 유저 별 우선 판정 (은하 모드에서만 착륙)
      if (!skyActive && userStars.length > 0) {
        raycaster.params.Points.threshold = 14;
        const starHit = raycaster.intersectObject(starPoints)[0];
        raycaster.params.Points.threshold = 6;
        if (starHit?.index != null && starHit.index < userStars.length) {
          landOnStar(userStars[starHit.index]);
          return;
        }
      }
      const hit = raycaster.intersectObject(points)[0];
      if (hit?.index == null) return;
      flySongRef.current?.(hit.index);
    };
    // 밤하늘 별 호버 강조 (이슈 #10-4) — 60ms 스로틀
    let lastHoverAt = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (!skyActive || !skyHighlightPoints) return;
      const nowMs = performance.now();
      if (nowMs - lastHoverAt < 60) return;
      lastHoverAt = nowMs;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      raycaster.params.Points.threshold = 14;
      const hit = raycaster.intersectObject(skyHighlightPoints)[0];
      raycaster.params.Points.threshold = 6;
      const k = hit?.index ?? -1;
      if (k !== hoveredK) {
        if (hoveredK >= 0) skyLabels[hoveredK]?.el.classList.remove("hover");
        hoveredK = k;
        if (k >= 0) skyLabels[k]?.el.classList.add("hover");
        renderer.domElement.style.cursor = k >= 0 ? "pointer" : "";
      }
    };
    // 별 더블클릭 → 해당 곡 재생 (행성의 곡 별, 은하의 곡 점 모두)
    const onDblClick = (e: MouseEvent) => {
      if (!payload || !points) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (skyActive) {
        if (!skyHighlightPoints) return;
        raycaster.params.Points.threshold = 14;
        const hit = raycaster.intersectObject(skyHighlightPoints)[0];
        raycaster.params.Points.threshold = 6;
        const si = hit?.index != null ? skyHighlightIdx[hit.index] : undefined;
        if (si != null) {
          playRequestRef.current?.(payload.songs.id[si], {
            title: payload.songs.title[si],
            artist: payload.songs.artist[si],
            index: si,
            popularity: payload.songs.popularity[si],
          });
        }
        return;
      }
      if (pendingSky) return; // 착륙 연출 중이면 무시
      // 유저 별 더블클릭은 재생 대상이 아님 (첫 클릭에서 이미 착륙 시작)
      if (userStars.length > 0) {
        raycaster.params.Points.threshold = 14;
        const starHit = raycaster.intersectObject(starPoints)[0];
        raycaster.params.Points.threshold = 6;
        if (starHit?.index != null && starHit.index < userStars.length) return;
      }
      const hit = raycaster.intersectObject(points)[0];
      // 카드 열기·포커스는 더블클릭의 첫 클릭(flySong)이 이미 처리 — 여기선 재생 + 근접 줌
      if (hit?.index != null) {
        playRequestRef.current?.(payload.songs.id[hit.index], {
          title: payload.songs.title[hit.index],
          artist: payload.songs.artist[hit.index],
          index: hit.index,
          popularity: payload.songs.popularity[hit.index],
        });
        if (positions) {
          // 곡 제목 라벨이 또렷이 보이는 거리까지 확대
          const p = new THREE.Vector3(
            positions[hit.index * 3],
            positions[hit.index * 3 + 1],
            positions[hit.index * 3 + 2],
          );
          flyTo(p, SONG_ZOOM_DISTANCE);
        }
      }
    };
    /**
     * 라벨 위에서 굴린 휠은 캔버스로 전달한다.
     * 클릭 가능한 라벨은 pointer-events가 켜져 있어 휠 이벤트를 삼키는데,
     * OrbitControls는 캔버스에만 붙어 있어 그 자리에서 줌이 멈춰 보였다.
     */
    const onLabelWheel = (e: WheelEvent) => {
      e.preventDefault();
      renderer.domElement.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          cancelable: true,
        }),
      );
    };
    labelLayer.addEventListener("wheel", onLabelWheel, { passive: false });

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("dblclick", onDblClick);

    // 데이터 도착 → 씬 구성 (요청은 이 이펙트 맨 앞에서 이미 보냈다)
    payloadPromise
      .then((data) => {
        if (disposed) return;
        payload = data;
        const n = data.songs.id.length;
        positions = new Float32Array(data.songs.pos);
        songIndexById = new Map(data.songs.id.map((id, i) => [id, i]));
        const colors = new Float32Array(n * 3);
        const sizes = new Float32Array(n);
        const haloSizes = new Float32Array(n);
        const themeById = new Map(data.themes.map((t) => [t.id, t]));
        const tmp = new THREE.Color();
        for (let i = 0; i < n; i++) {
          tmp.set(themeById.get(data.songs.themeId[i])?.color ?? "#ffffff");
          colors.set([tmp.r, tmp.g, tmp.b], i * 3);
          const pop = data.songs.popularity[i] / 100;
          sizes[i] = 1.6 + pop * 3.2;
          haloSizes[i] = sizes[i] * 4.5;
        }
        points = makePointsLayer(positions, colors, sizes, 0.95);
        if (isCoarse) {
          scene.add(points); // 모바일: 글로우층은 오버드로우가 커서 생략
        } else {
          const halo = makePointsLayer(positions, colors, haloSizes, 0.06); // 성운 느낌의 글로우층
          haloMat = halo.material as THREE.ShaderMaterial;
          scene.add(halo, points);
        }
        minimapClusters = data.themes.filter((t) => t.level === 1);
        // 은하 주민들 — 캐시 없는 별도 엔드포인트에서 항상 최신으로
        fetch("/api/stars")
          .then((r) => (r.ok ? r.json() : []))
          .then((stars: GalaxyStar[]) => {
            if (disposed) return;
            stars.forEach(upsertStar);
            // /planet/[id] 딥링크 — 그 유저의 행성으로 자동 착륙 (이슈 #10-2)
            if (landUserId != null) {
              const target = userStars.find((s) => s.data.userId === landUserId);
              if (target) landOnStar(target);
            }
          })
          .catch(() => undefined);


        for (const t of data.themes) {
          if (t.level === 1) {
            clusterLabels.push({
              el: makeLabel(t.label, "lv1", t.color, () => openCluster(t)),
              pos: new THREE.Vector3(t.x, t.y, t.z),
              theme: t,
            });
          } else {
            const parent = data.themes.find((p) => p.id === t.parentId);
            if (parent) {
              subLabels.push({
                el: makeLabel(t.label, "lv2", t.color, () => openTheme(t, parent)),
                pos: new THREE.Vector3(t.x, t.y, t.z),
                theme: t,
                parent,
              });
            }
          }
        }
        for (let i = 0; i < SONG_LABEL_POOL; i++) {
          songLabels.push({ el: makeLabel("", "song"), index: -1 });
        }
        setStatus("ready");
        // /songs/[id]의 "은하에서 보기" 딥링크 (?song=ID) → 해당 곡으로 비행
        if (initialSongId != null) {
          const idx = data.songs.id.indexOf(initialSongId);
          if (idx >= 0) flySongRef.current?.(idx);
        }
      })
      .catch((err) => {
        console.error("galaxy payload load failed", err);
        if (!disposed) setStatus("error");
      });

    // 곡 라벨 최근접 스캔용 재사용 버퍼 — 매번 수만 개 객체를 할당하면 GC 스파이크로 드래그가 끊긴다
    const songLabelScanEvery = isCoarse ? 24 : 12;
    const nearD = new Float64Array(SONG_LABEL_POOL);
    const nearI = new Int32Array(SONG_LABEL_POOL);

    // 라벨 화면 투영
    const proj = new THREE.Vector3();
    const placeLabel = (el: HTMLDivElement, pos: THREE.Vector3, opacity: number) => {
      proj.copy(pos).project(camera);
      const behind = proj.z > 1;
      if (behind || opacity <= 0.02) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        return;
      }
      el.style.opacity = String(Math.min(1, opacity));
      // 터치 기기에서는 라벨이 드래그(회전) 시작을 가로채지 않게 항상 통과시키고,
      // 탭 판정은 onPointerUp에서 좌표로 직접 한다
      el.style.pointerEvents = !isCoarse && el.classList.contains("clickable") ? "auto" : "none";
      el.style.transform = `translate(-50%, -50%) translate(${((proj.x + 1) / 2) * 100}cqw, ${((1 - proj.y) / 2) * 100}cqh)`;
    };

    let frame = 0;
    const animate = (now: number) => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);

      if (fly) {
        const t = Math.min(1, (now - fly.start) / 1300);
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // easeInOutCubic
        camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
        controls.target.lerpVectors(fly.fromTarget, fly.toTarget, e);
        if (t >= 1) fly = null;
      }
      controls.update();

      // LOD 라벨 (매 2프레임) — 밤하늘 모드에서는 성단/장르 라벨 숨김
      if (frame % 2 === 0) {
        for (const l of clusterLabels) {
          const d = camera.position.distanceTo(l.pos);
          const r = l.theme.radius;
          // 멀면 보이고, 성단 클릭 도착 지점(1.5R)부터는 사라져 세부 장르에 자리를 내준다
          placeLabel(l.el, l.pos, skyActive ? 0 : (d - r * 1.5) / (r * 1.1));
        }
        for (const l of subLabels) {
          const dParent = camera.position.distanceTo(new THREE.Vector3(l.parent.x, l.parent.y, l.parent.z));
          const d = camera.position.distanceTo(l.pos);
          const near = 1 - (dParent - l.parent.radius * 0.6) / (l.parent.radius * 1.8); // 성단 접근도 (2.4R부터 서서히)
          const notInside = (d - l.theme.radius * 0.5) / (l.theme.radius * 0.8); // 세부 테마 진입 시 페이드
          placeLabel(l.el, l.pos, skyActive ? 0 : Math.min(near, notInside));
        }
        // 밤하늘 하이라이트 곡 라벨
        for (const l of skyLabels) {
          placeLabel(l.el, l.pos, 0.9);
        }
      }
      // 곡 제목 라벨 (주기 스캔, 가장 가까운 곡) — 밤하늘 모드에서는 하이라이트 라벨이 대신함
      if (frame % songLabelScanEvery === 0 && positions && payload && !skyActive) {
        const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        const maxD2 = SONG_LABEL_DISTANCE * SONG_LABEL_DISTANCE;
        let nearCount = 0;
        for (let i = 0; i < payload.songs.id.length; i++) {
          const dx = positions[i * 3] - cx, dy = positions[i * 3 + 1] - cy, dz = positions[i * 3 + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= maxD2) continue;
          if (nearCount === SONG_LABEL_POOL && d2 >= nearD[nearCount - 1]) continue;
          let j = Math.min(nearCount, SONG_LABEL_POOL - 1);
          while (j > 0 && nearD[j - 1] > d2) {
            nearD[j] = nearD[j - 1];
            nearI[j] = nearI[j - 1];
            j--;
          }
          nearD[j] = d2;
          nearI[j] = i;
          if (nearCount < SONG_LABEL_POOL) nearCount++;
        }
        // 포커스 곡은 밀집 지역에서 24위 밖으로 밀려나도 항상 라벨을 가진다
        if (focusedSongIndex >= 0) {
          let hasFocus = false;
          for (let k = 0; k < nearCount; k++) {
            if (nearI[k] === focusedSongIndex) { hasFocus = true; break; }
          }
          if (!hasFocus) {
            const k = Math.min(nearCount, SONG_LABEL_POOL - 1);
            nearI[k] = focusedSongIndex;
            if (nearCount < SONG_LABEL_POOL) nearCount++;
          }
        }
        for (let k = 0; k < songLabels.length; k++) {
          const slot = songLabels[k];
          const has = k < nearCount;
          slot.index = has ? nearI[k] : -1;
          if (has) setLabelText(slot.el, payload.songs.title[nearI[k]]);
        }
      }
      if (positions) {
        for (const slot of songLabels) {
          if (slot.index < 0 || skyActive) {
            slot.el.style.opacity = "0";
            continue;
          }
          const p = new THREE.Vector3(positions[slot.index * 3], positions[slot.index * 3 + 1], positions[slot.index * 3 + 2]);
          const d = camera.position.distanceTo(p);
          placeLabel(slot.el, p, 1 - d / SONG_LABEL_DISTANCE);
        }
      }

      // 좋아요 별 강조는 은하 모드에서만 (밤하늘·착륙 연출 중 숨김)
      if (likedGlow) likedGlow.visible = !skyActive && !pendingSky;

      // 미학 폴리시 (#8): 배경 별 반짝임 + 성운 글로우의 느린 숨쉬기
      const t = now / 1000;
      if (bgStarsMat) bgStarsMat.uniforms.uTime.value = t;
      if (haloMat) haloMat.uniforms.uAlpha.value = (0.055 + 0.02 * Math.sin(t * 0.7)) * dimScale;
      if (frame % 10 === 0 && !skyActive) drawMinimap();

      // 밤하늘 모드: 잔별 반짝임 + 선택 링 펄스 + 유성 (동물의 숲 감성)
      if (skyActive) {
        if (skyTwinkleMat) skyTwinkleMat.uniforms.uTime.value = t;
        if (skyRingMat) skyRingMat.uniforms.uTime.value = t;
        if (skyGroundMat) skyGroundMat.uniforms.uTime.value = t;
        if (meteor && skyStarPos) {
          const m = meteor;
          const mat = m.obj.material as THREE.PointsMaterial;
          if (m.start < 0 && now > meteorNextAt) {
            const azim = Math.random() * Math.PI * 2;
            const elev1 = ((48 + Math.random() * 26) * Math.PI) / 180;
            const elev2 = elev1 - ((16 + Math.random() * 12) * Math.PI) / 180;
            const azim2 = azim + 0.3 + Math.random() * 0.25;
            const r = 620;
            m.from.set(
              skyStarPos.x + r * Math.cos(elev1) * Math.cos(azim),
              skyStarPos.y + r * Math.sin(elev1),
              skyStarPos.z + r * Math.cos(elev1) * Math.sin(azim),
            );
            m.to.set(
              skyStarPos.x + r * Math.cos(elev2) * Math.cos(azim2),
              skyStarPos.y + r * Math.sin(elev2),
              skyStarPos.z + r * Math.cos(elev2) * Math.sin(azim2),
            );
            m.start = now;
          }
          if (m.start >= 0) {
            const mt = (now - m.start) / 700;
            if (mt >= 1) {
              m.start = -1;
              mat.opacity = 0;
              meteorNextAt = now + 4000 + Math.random() * 8000;
            } else {
              const p = m.from.clone().lerp(m.to, mt);
              (m.obj.geometry.attributes.position as THREE.BufferAttribute).setXYZ(0, p.x, p.y, p.z);
              m.obj.geometry.attributes.position.needsUpdate = true;
              mat.opacity = mt < 0.15 ? mt / 0.15 : 1 - (mt - 0.15) / 0.85;
            }
          }
        }
      }

      // 유저 별: 목표 좌표로 부드럽게 이동 + 닉네임 라벨
      if (userStars.length > 0) {
        starMat.uniforms.uTime.value = t;
        for (let i = 0; i < userStars.length; i++) {
          const s = userStars[i];
          s.cur.lerp(s.target, 0.045);
          starPositions[i * 3] = s.cur.x;
          starPositions[i * 3 + 1] = s.cur.y;
          starPositions[i * 3 + 2] = s.cur.z;
        }
        starGeo.attributes.position.needsUpdate = true;
        if (frame % 2 === 1) {
          for (const s of userStars) {
            const d = camera.position.distanceTo(s.cur);
            placeLabel(s.label, s.cur, skyActive ? 0 : 1.15 - d / 1000);
          }
        }
      }

      renderer.render(scene, camera);
      frame++;
    };
    frameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      labelLayer.removeEventListener("wheel", onLabelWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Points) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
      labelLayer.replaceChildren();
      // 오디오는 전역 플레이어 소유 — 여기서 멈추지 않는다 (페이지 이동 후에도 재생 유지)
    };
  }, []);

  const scrollCards = (dir: -1 | 1) => {
    const el = cardScrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  /** 접힌 상태 미니플레이어에 보여줄 곡 — 재생 중 > 포커스 > 목록 첫 곡 */
  const miniSong = cards
    ? (cards.songs.find((s) => s.id === (playingId ?? focusedCardId)) ?? cards.songs[0])
    : null;
  const miniMedia = miniSong ? media[miniSong.id] : undefined;

  // 접힌 미니플레이어의 앨범아트가 아직 없으면 그 곡만 보강
  useEffect(() => {
    if (cardsCollapsed && miniSong && !miniMedia) void fetchMedia([miniSong.id]);
  }, [cardsCollapsed, miniSong, miniMedia, fetchMedia]);

  return (
    <div className="relative h-dvh w-full overflow-hidden" style={{ background: GALAXY_BG }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div
        ref={labelLayerRef}
        className="pointer-events-none absolute inset-0"
        style={{ containerType: "size" }}
      />

      {/* 상단 오버레이 — 은하에서는 타이틀, 행성에서는 정보 패널 (이슈 #10-1) */}
      {skyInfo ? (
        <div className="pointer-events-none absolute left-4 top-4 max-w-[55%] rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white backdrop-blur sm:max-w-xs">
          <p className="text-[11px] tracking-widest text-white/40">PLANET</p>
          <h1 className="mt-0.5 text-lg font-semibold">✦ {skyInfo.nickname}의 행성</h1>
          {skyInfo.bio && <p className="mt-1 text-xs italic text-white/60">“{skyInfo.bio}”</p>}
          {skyInfo.likesCount != null && (
            <p className="mt-1 text-xs text-white/55">
              좋아요 {skyInfo.likesCount}곡
              {skyInfo.lastLikedAt && (
                <span className="text-white/35">
                  {" · 최근 "}
                  {new Date(skyInfo.lastLikedAt).toLocaleDateString("ko-KR", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </p>
          )}
          {skyInfo.clusters && skyInfo.clusters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skyInfo.clusters.map((c) => (
                <span
                  key={c.slug}
                  className="rounded-full border border-white/15 px-2 py-0.5 text-[10px]"
                  style={{ color: c.color }}
                >
                  {c.label} {c.n}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="pointer-events-none absolute left-4 top-4 max-w-[38%] text-white/90 sm:max-w-none">
          <h1 className="text-lg font-semibold tracking-wide">songGalaxy</h1>
          {status === "ready" && (
            <p className="text-xs text-white/50">장르를 클릭해 들어가보세요</p>
          )}
          {status === "ready" && authState.authenticated && authState.likesCount < MIN_LIKES_FOR_STAR && (
            <p className="mt-1 text-xs text-amber-200/90">
              ✦ 별까지 {MIN_LIKES_FOR_STAR - authState.likesCount}곡 — 좋아하는 곡에 ♥를 눌러보세요
            </p>
          )}
        </div>
      )}

      {/* 데스크톱 전용 — 모바일에서는 아래 햄버거 버튼이 대신한다 */}
      <div className="absolute right-4 top-4 z-10 hidden gap-2 sm:flex">
        {authState.authenticated ? (
          /* 닉네임 클릭 → 우측 드로어 (메뉴 + 행성 프로필 편집) */
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-full border border-amber-200/30 bg-amber-100/10 px-4 py-1.5 text-sm text-amber-100/90 backdrop-blur transition hover:bg-amber-100/20"
          >
            ✦ {authState.nickname}
          </button>
        ) : (
          <>
            <a
              href="/api/auth/signin?callbackUrl=/"
              className="rounded-full border border-white/25 bg-white/15 px-4 py-1.5 text-sm text-white backdrop-blur transition hover:bg-white/25"
            >
              Google 로그인
            </a>
            <Link
              href="/songs"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white/90 backdrop-blur transition hover:bg-white/20"
            >
              곡 목록
            </Link>
          </>
        )}
        {skyInfo ? (
          <>
            <button
              type="button"
              onClick={copyPlanetLink}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white/90 backdrop-blur transition hover:bg-white/20"
              aria-label="행성 링크 복사"
              title="행성 링크 복사"
            >
              🔗
            </button>
            <button
              type="button"
              onClick={() => exitSkyRef.current?.()}
              className="rounded-full border border-amber-200/40 bg-amber-100/15 px-4 py-1.5 text-sm text-amber-100 backdrop-blur transition hover:bg-amber-100/25"
            >
              은하로 나가기
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => resetRef.current?.()}
            className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white/90 backdrop-blur transition hover:bg-white/20"
          >
            전체 보기
          </button>
        )}
      </div>

      {/* 모바일 — ☰ 버튼 하나로 드로어 열기 */}
      <div className="absolute right-4 top-4 z-10 sm:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm text-white/90 backdrop-blur transition hover:bg-white/20"
          aria-label="메뉴"
        >
          ☰
        </button>
      </div>

      {/* 우측 드로어 — 메뉴 + 행성 프로필 편집 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-20 bg-black/50" onClick={() => setDrawerOpen(false)} />
      )}
      <aside
        className={`fixed right-0 top-0 z-30 flex h-dvh w-80 max-w-[85vw] transform flex-col overflow-y-auto border-l border-white/15 bg-black/90 p-5 backdrop-blur transition-transform duration-300 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!drawerOpen}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-100/90">
            {authState.authenticated ? `✦ ${authState.nickname}` : "songGalaxy"}
          </p>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="rounded-full px-2 text-white/60 transition hover:text-white"
            aria-label="드로어 닫기"
          >
            ✕
          </button>
        </div>

        {/* 행성 프로필 편집 (로그인 시) */}
        {authState.authenticated && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-[11px] tracking-widest text-white/40">행성 프로필</p>
            {profile ? (
              <div className="flex flex-col gap-3">
                <label className="text-xs text-white/60">
                  닉네임
                  <input
                    value={profile.nickname}
                    maxLength={NICKNAME_MAX}
                    onChange={(e) => setProfile({ ...profile, nickname: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus:border-amber-200/50"
                  />
                </label>
                <label className="text-xs text-white/60">
                  한 줄 소개
                  <input
                    value={profile.bio}
                    maxLength={BIO_MAX}
                    placeholder="행성 방문자에게 보여줄 소개"
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-amber-200/50"
                  />
                </label>
                <label className="text-xs text-white/60">
                  대표곡 <span className="text-white/35">— 행성 라디오가 이 곡부터 시작</span>
                  <select
                    value={profile.pinnedSongId ?? ""}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        pinnedSongId: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white outline-none transition focus:border-amber-200/50"
                  >
                    <option value="">자동 (최근 좋아요 순)</option>
                    {profile.likedSongs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} — {s.artist}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={profileSaving}
                  className="rounded-lg border border-amber-200/40 bg-amber-100/15 px-3 py-2 text-sm text-amber-100 transition hover:bg-amber-100/25 disabled:opacity-50"
                >
                  {profileSaving ? "저장 중…" : "저장"}
                </button>
              </div>
            ) : (
              <p className="text-xs text-white/40">불러오는 중…</p>
            )}
          </div>
        )}

        {/* 메뉴 */}
        <nav className="flex flex-col">
          {authState.authenticated ? (
            <>
              {authState.star && (
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    goMyStar();
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-amber-100/90 transition hover:bg-white/10 hover:text-amber-100"
                >
                  ✦ 내 별로 이동
                </button>
              )}
              <button
                type="button"
                onClick={toggleLikedGlow}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                {likedGlowOn ? "🌟 좋아요 별 강조 끄기" : "🌟 좋아요 별 강조 켜기"}
              </button>
              <Link
                href="/me"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                ♥ 내 취향 페이지
              </Link>
            </>
          ) : (
            <a
              href="/api/auth/signin?callbackUrl=/"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/10"
            >
              Google 로그인
            </a>
          )}
          <Link
            href="/songs"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            ♪ 곡 목록
          </Link>
          <div className="my-1 border-t border-white/10" />
          {skyInfo ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  copyPlanetLink();
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                🔗 행성 링크 복사
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  exitSkyRef.current?.();
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-amber-100/90 transition hover:bg-white/10 hover:text-amber-100"
              >
                은하로 나가기
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                resetRef.current?.();
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              🔭 전체 보기
            </button>
          )}
          {authState.authenticated && (
            <>
              <div className="my-1 border-t border-white/10" />
              <a
                href="/api/auth/signout?callbackUrl=/"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                로그아웃
              </a>
            </>
          )}
        </nav>
      </aside>

      {/* 착륙 진입 플래시 (금빛 커튼) */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-300 ${flash ? "opacity-100" : "opacity-0"}`}
        style={{
          background:
            "radial-gradient(circle at 50% 55%, rgba(255,236,190,0.98) 0%, rgba(255,214,140,0.9) 35%, rgba(30,22,8,0.95) 100%)",
        }}
      />

      {/* 자동 라디오가 브라우저 정책에 막혔을 때 수동 시작 (이슈 #10-5) */}
      {skyInfo && radioBlocked && (
        <button
          type="button"
          onClick={() => void tryRadio()}
          className="absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded-full border border-white/25 bg-black/60 px-5 py-2 text-sm text-white backdrop-blur transition hover:bg-black/80"
        >
          ▶ 라디오 시작
        </button>
      )}

      {/* 별 탄생 등 알림 토스트 */}
      {toast && (
        <div className="galaxy-pulse-once absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded-full border border-amber-200/40 bg-black/75 px-6 py-3 text-amber-100 backdrop-blur">
          {toast}
        </div>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-4 text-white/70">
            <span className="galaxy-pulse text-3xl">✦</span>
            <span className="text-sm tracking-widest">은하를 불러오는 중…</span>
          </div>
        </div>
      )}

      {/* 미니맵 — 성단 배치와 내 위치 (모바일에서는 숨김) */}
      <canvas
        ref={minimapRef}
        width={140}
        height={140}
        className={`pointer-events-none absolute bottom-4 left-4 hidden rounded-full border border-white/10 bg-black/40 backdrop-blur ${skyInfo ? "" : "sm:block"}`}
      />

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center text-red-300">
          은하 데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
        </div>
      )}

      {/* 하단 곡 카드 캐러셀 (성단/세부 장르 클릭 시) */}
      {cards && (
        <div
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent pb-4 pt-8 transition-transform duration-300 ease-out"
          style={{
            /* 접힘: 상단 여백(pt-8) + 곡 정보 줄(h-10) + 재생 컨트롤 줄만 남긴다 */
            transform: cardsCollapsed ? "translateY(calc(100% - 6.75rem))" : "translateY(0)",
          }}
        >
          <div className="mb-2 px-5">
            {/* 접힘: 곡 정보와 재생 컨트롤을 하나의 컨테이너로 묶어 우측 정렬 (양끝 열이 맞는다) */}
            <div
              className={
                cardsCollapsed && miniSong ? "ml-auto w-fit" : "flex items-center justify-between gap-3"
              }
            >
            {cardsCollapsed && miniSong && (
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                {miniMedia?.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
                  <img
                    src={miniMedia.artworkUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10 text-lg"
                    style={{ color: cards.color }}
                  >
                    ✦
                  </div>
                )}
                  <div className="min-w-0 max-w-40">
                    <p className="truncate text-sm font-medium text-white">{miniSong.title}</p>
                    <p className="truncate text-xs text-white/50">{miniSong.artist}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleLike(miniSong.id)}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs transition ${authState.likedIds.has(miniSong.id) ? "border-pink-400/60 bg-pink-500/25 text-pink-200" : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"}`}
                  aria-label={authState.likedIds.has(miniSong.id) ? "좋아요 취소" : "좋아요"}
                  title={authState.authenticated ? "좋아요" : "로그인하고 좋아요"}
                >
                  {authState.likedIds.has(miniSong.id) ? "♥" : "♡"}
                </button>
              </div>
            )}
            {!(cardsCollapsed && miniSong) && (
              <p className="min-w-0 truncate text-sm text-white/90">
                <span className="font-semibold" style={{ color: cards.color }}>
                  {cards.title}
                </span>
                <span className="ml-2 hidden text-white/50 sm:inline">{cards.subtitle}</span>
              </p>
            )}
            <div className="flex shrink-0 items-center gap-3">
              {/* 재생 컨트롤 — 이전 곡 / 재생·일시정지 / 다음 곡 */}
              <div className="flex items-center gap-2">
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
                  onClick={toggleMainPlay}
                  className="text-sm text-white/70 transition hover:text-white"
                  aria-label={playingId !== null && !isPaused ? "일시정지" : "재생"}
                  title={playingId !== null && !isPaused ? "일시정지" : "재생"}
                >
                  {playingId !== null && !isPaused ? "❚❚" : "▶"}
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
              </div>
              {/* 볼륨 조절 (미리듣기·라디오) */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-sm text-white/70 transition hover:text-white"
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
                  className="hidden h-1 w-20 cursor-pointer accent-amber-200 sm:block"
                  aria-label="볼륨"
                />
              </div>
              {/* 카드 목록 내리기/올리기 */}
              <button
                type="button"
                onClick={() => setCardsCollapsed((c) => !c)}
                className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label={cardsCollapsed ? "곡 목록 올리기" : "곡 목록 내리기"}
                title={cardsCollapsed ? "곡 목록 올리기" : "곡 목록 내리기"}
              >
                {cardsCollapsed ? "▲" : "▼"}
              </button>
              <button
                type="button"
                onClick={() => showCards(null)}
                className="rounded-full px-2 text-white/60 transition hover:text-white"
                aria-label="곡 목록 닫기"
              >
                ✕
              </button>
              </div>
            </div>
          </div>
          <div
            className={`relative transition-opacity duration-200 ${cardsCollapsed ? "pointer-events-none opacity-0" : "opacity-100"}`}
          >
            <button
              type="button"
              onClick={() => scrollCards(-1)}
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/60 px-2.5 py-1.5 text-white/80 backdrop-blur transition hover:bg-black/80"
              aria-label="이전 곡들"
            >
              ‹
            </button>
            <div
              ref={cardScrollRef}
              onScroll={onCardScroll}
              className="scrollbar-none flex snap-x gap-3 overflow-x-auto scroll-smooth px-5 scroll-px-5 sm:px-16 sm:scroll-px-16"
            >
              {cards.songs.map((song) => {
                const m = media[song.id];
                const isPlaying = playingId === song.id && !isPaused;
                // 재생 중인 곡만 원래 크기로 두고 나머지를 줄여 눈에 띄게 한다.
                // (재생 카드를 키우면 캐러셀 높이를 넘어 위아래가 잘린다)
                // 폭(w-40)은 그대로 두고 transform만 쓴다 — 가운데 정렬 계산이 흔들리지 않게
                const isCurrent = playingId === song.id;
                return (
                  <div
                    key={song.id}
                    className={`relative w-40 shrink-0 snap-start overflow-hidden rounded-xl border bg-white/5 text-left backdrop-blur transition duration-200 hover:bg-white/10 ${
                      isCurrent
                        ? "z-10 border-amber-200/50 shadow-lg shadow-amber-200/10"
                        : `scale-90 opacity-80 hover:border-white/30 ${focusedCardId === song.id ? "border-white/30" : "border-white/10"}`
                    }`}
                  >
                    {/* 카드 클릭 → 곡 상세 페이지 */}
                    <Link href={`/songs/${song.id}`} className="block" aria-label={`${song.title} 상세 보기`}>
                      <div className="relative h-24 w-full bg-white/5">
                        {m?.artworkUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
                          <img
                            src={m.artworkUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="grid h-full w-full place-items-center text-2xl"
                            style={{ color: cards.color }}
                          >
                            ✦
                          </div>
                        )}
                      </div>
                      <div className="p-2.5 pb-8">
                        <p className="truncate text-sm font-medium text-white">{song.title}</p>
                        <p className="truncate text-xs text-white/50">{song.artist}</p>
                      </div>
                    </Link>
                    <div className="absolute bottom-2 right-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void toggleLike(song.id)}
                        className={`grid h-7 w-7 place-items-center rounded-full border text-xs transition ${authState.likedIds.has(song.id) ? "border-pink-400/60 bg-pink-500/25 text-pink-200" : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"}`}
                        aria-label={authState.likedIds.has(song.id) ? "좋아요 취소" : "좋아요"}
                        title={authState.authenticated ? "좋아요" : "로그인하고 좋아요"}
                      >
                        {authState.likedIds.has(song.id) ? "♥" : "♡"}
                      </button>
                      {song.index >= 0 && (
                        <button
                          type="button"
                          onClick={() => flySongRef.current?.(song.index)}
                          className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-white/10 text-xs text-white/70 transition hover:bg-white/20"
                          aria-label={`${song.title} 별로 이동`}
                          title="은하에서 이 별로 이동"
                        >
                          ✦
                        </button>
                      )}
                      {m?.previewUrl && (
                        <button
                          type="button"
                          onClick={() => togglePreview(song.id)}
                          className={`grid h-7 w-7 place-items-center rounded-full border text-xs transition ${isPlaying ? "border-white/60 bg-white/25 text-white" : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"}`}
                          aria-label={isPlaying ? "미리듣기 정지" : "30초 미리듣기"}
                          title="30초 미리듣기"
                        >
                          {isPlaying ? "❚❚" : "▶"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => scrollCards(1)}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/60 px-2.5 py-1.5 text-white/80 backdrop-blur transition hover:bg-black/80"
              aria-label="다음 곡들"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
