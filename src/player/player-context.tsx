"use client";

/**
 * 전역 미리듣기 플레이어 — 재생 상태·큐·볼륨·미디어 캐시의 단일 원본 (SSOT)
 *
 * 오디오 객체가 루트 레이아웃 수준에 살므로 페이지를 이동해도 재생이 끊기지 않는다.
 * 곡이 끝나면 큐에서 미리듣기 있는 다음 곡으로 자동 진행(끝↔처음 루프)하며,
 * 이 진행은 은하 캔버스가 내려간 뒤에도 계속된다.
 * 설계: docs/superpowers/specs/2026-08-10-global-player-design.md
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ENRICH_BATCH,
  YT_ERROR_LIMIT,
  YT_ERROR_WINDOW_MS,
  YT_PLAYBACK_ERROR_LIMIT,
  YT_STAGE_READY_TIMEOUT_MS,
} from "@/config/constants";
import { pickEngine, stageSeed, type Engine } from "./engine";

export interface Media {
  artworkUrl: string | null;
  previewUrl: string | null;
}

export interface PlayerSong {
  id: number;
  title: string;
  artist: string;
  /** 은하 페이로드에서의 곡 인덱스 — 카드 목록 복원·별로 이동에 쓴다 */
  index?: number;
  popularity?: number;
  /** 목록 재생에서 YouTube 전곡 재생에 쓴다. 없으면 미리듣기로 떨어진다 */
  youtubeVideoId?: string | null;
}

/**
 * 재생 목록 — 은하 카드 목록·행성 라디오가 이 형태로 큐를 넘긴다.
 * 은하로 돌아왔을 때 이 큐만으로 카드 캐러셀을 되살릴 수 있어야 하므로
 * 목록의 제목·부제·색까지 함께 들고 다닌다.
 */
export interface PlayerQueue {
  title: string;
  subtitle?: string;
  color?: string;
  /**
   * 이 큐가 어느 노래 목록에서 왔는지. 목록 화면에서 순서를 바꾸거나 곡을 뺐을 때
   * "지금 듣고 있는 큐가 그 목록인지" 알아야 해서 둔다 — title만으로는 알 수 없다
   * (이름이 같은 목록이 여럿일 수 있고, 이름은 바뀐다)
   */
  playlistId?: number;
  /** playlist면 YouTube 전곡 재생을 시도한다. 없으면 browse(30초 미리듣기) */
  mode?: "playlist" | "browse";
  songs: PlayerSong[];
}

/**
 * 무대가 알려오는 실패 원인.
 * - `api`: IFrame 스크립트 자체를 못 읽음 (영상 ID 문제가 아니다)
 * - `embed-refused`: 권리자가 임베드를 막았거나 없어진 영상 (그 ID는 앞으로도 못 쓴다)
 * - `playback`: 일시적/기타 재생 오류 (ID는 멀쩡할 수 있다)
 * YouTube 오류 코드를 이 세 갈래로 옮기는 일은 무대가 한다 — Provider는 코드 번호를 모른다.
 */
export type YoutubeErrorReason = "api" | "embed-refused" | "playback";

/** 큐에서 찾아낸 "지금 재생할 수 있는 곡" */
interface Playable {
  song: PlayerSong;
  previewUrl: string | null;
}

/** YoutubeStage가 넘겨주는 제어 손잡이. 제어권은 Provider가 갖는다 */
export interface YoutubeApi {
  load(videoId: string): void;
  play(): void;
  pause(): void;
  stop(): void;
  setVolume(v0to1: number): void;
}

/**
 * 무대가 준비되기 전에 들어온 영상 재생 요청.
 * 무대는 "영상을 틀려는 곡이 생겨야" 마운트되고, 마운트된 뒤에도 IFrame 스크립트를
 * 내려받는 동안은 손잡이가 없다 — 그 창에서 요청을 버리면 첫 곡이 항상 조용히 실패한다.
 * 그래서 버리지 않고 여기 담아 두었다가 onReady 때 그대로 다시 튼다.
 */
interface PendingYoutube {
  /** 요청 일련번호 — 시간 초과가 "자기 요청"을 정리하는지 확인하는 데 쓴다 */
  seq: number;
  song: PlayerSong;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 행성 착륙 전 재생 상태 스냅샷 — 은하 복귀 시 이어듣기용 */
export interface PlayerSnapshot {
  queue: PlayerQueue | null;
  songId: number;
  time: number;
}

interface PlayerContextValue {
  playingId: number | null;
  /** 일시정지 상태 — playingId는 유지한 채 위치만 멈춰 재개 가능 */
  isPaused: boolean;
  queue: PlayerQueue | null;
  volume: number;
  media: Record<number, Media>;
  /** 곡 id 목록의 앨범아트/미리듣기를 서버 캐시에서 가져온다 (중복 요청 방지, await 가능) */
  fetchMedia: (ids: number[]) => Promise<void>;
  /** 미디어 캐시 동기 조회 — fetchMedia 직후에도 최신값을 읽을 수 있다 */
  getMedia: (id: number) => Media | undefined;
  /** 큐를 교체하고 해당 곡부터 재생. 미리듣기가 없거나 자동재생이 막히면 reject */
  playFrom: (queue: PlayerQueue, songId: number) => Promise<void>;
  /** 이미 듣고 있는 큐 안에서 곡을 골라 재생 — 그 큐의 mode(목록/탐색)를 그대로 지킨다 */
  playInQueue: (queue: PlayerQueue, songId: number) => Promise<void>;
  /** 지금 소리를 내고 있는 엔진 — 둘 중 하나만 켜진다 */
  engine: Engine | null;
  /** 영상 패널이 펼쳐져 있는지. 접으면 재생도 멈춘다 (약관: 영상은 보여야 한다) */
  videoExpanded: boolean;
  setVideoExpanded: (v: boolean) => void;
  /**
   * 영상 무대를 세울 씨앗 영상 ID (없으면 무대가 필요 없다).
   * 무대를 그리는 곳(`VideoStage`)은 이 값만 보고 마운트한다 — 조건을 그리는 쪽에서
   * 다시 계산하면 화면 구성이 바뀔 때마다 무대가 사라지는 사고가 난다 (docs/SSOT.md)
   */
  stageVideoId: string | null;
  /** 목록 재생 시작 — YouTube 전곡 재생을 시도한다 */
  playPlaylist: (queue: PlayerQueue, songId: number) => Promise<void>;
  /** 그 목록이 지금 큐일 때만 곡 순서를 새 순서로 맞춘다. 재생 중인 곡은 건드리지 않는다 */
  reorderQueue: (playlistId: number, songIds: number[]) => void;
  /** 그 목록이 지금 큐일 때 곡을 뺀다. 빼는 곡이 재생 중이면 다음 곡으로 넘어간다 */
  removeFromQueue: (playlistId: number, songId: number) => void;
  registerYoutube: (api: YoutubeApi | null) => void;
  /** 무대가 영상을 못 틀었다 — 그 곡만 미리듣기로 떨어뜨린다 (폭주하면 목록 전체를 미리듣기로) */
  reportYoutubeError: (reason: YoutubeErrorReason) => void;
  /** 재생 방식이 바뀐 이유를 사용자에게 한 줄로 알린다 (영상 실패 폴백 등). 없으면 null */
  notice: string | null;
  /** 재생/일시정지 토글 (재생 중인 곡이 있을 때만 동작) */
  toggle: () => void;
  /** 이전/다음 곡 — 재생할 수 없는 곡은 건너뜀, 끝↔처음 루프. newQueue를 주면 그 목록을 큐로 삼는다 */
  playStep: (dir: -1 | 1, newQueue?: PlayerQueue) => Promise<void>;
  /** 정지 + 큐 비움 */
  stop: () => void;
  changeVolume: (v: number) => void;
  /** 음소거 토글 — 해제 시 마지막 가청 볼륨으로 복원 */
  toggleMute: () => void;
  snapshot: () => PlayerSnapshot | null;
  /** 스냅샷 복원 — 듣던 곡을 그 위치부터 이어 재생 */
  restore: (snap: PlayerSnapshot) => Promise<void>;
  /** 은하 화면이 자체 재생 UI(카드 패널)를 띄우는 동안 true — 미니플레이어 숨김 */
  uiHosted: boolean;
  setUiHosted: (hosted: boolean) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer는 PlayerProvider 안에서만 쓸 수 있습니다");
  return ctx;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingIdState] = useState<number | null>(null);
  const playingIdRef = useRef<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const setPaused = useCallback((v: boolean) => {
    isPausedRef.current = v;
    setIsPaused(v);
  }, []);
  const [queue, setQueueState] = useState<PlayerQueue | null>(null);
  const queueRef = useRef<PlayerQueue | null>(null);
  const [uiHosted, setUiHosted] = useState(false);

  const [engine, setEngineState] = useState<Engine | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [videoExpanded, setVideoExpandedState] = useState(false);
  const ytRef = useRef<YoutubeApi | null>(null);
  const pendingYtRef = useRef<PendingYoutube | null>(null);
  const pendingSeqRef = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** 영상 오류 폭주 감지용 — 창(window) 시작 시각과 그 창에서 센 오류 수 */
  const ytErrorsRef = useRef<{ since: number; count: number }>({ since: 0, count: 0 });
  /**
   * 곡별 "playback" 오류 누적(곡 id → 횟수).
   * 위의 폭주 감지는 시간 창을 쓰므로 드문드문 나는 오류는 못 잡는다 — 그때 같은 곡이
   * 무한히 처음부터 다시 시작되는 것을 이 카운터가 막는다. 목록을 새로 틀 때 비운다.
   */
  const ytSongErrorsRef = useRef<Map<number, number>>(new Map());

  const setEngine = useCallback((e: Engine | null) => {
    engineRef.current = e;
    setEngineState(e);
  }, []);

  /** 지금 켜져 있지 않은 엔진을 확실히 끈다 — 두 곳에서 동시에 소리가 나면 안 된다 */
  const silenceOther = useCallback((keep: Engine) => {
    if (keep === "youtube") {
      audioRef.current?.pause();
      return;
    }
    ytRef.current?.stop();
    // 미리듣기로 넘어왔는데 빈 영상 무대가 은하를 덮고 있으면 안 된다
    setVideoExpandedState(false);
  }, []);

  const setPlayingId = useCallback((id: number | null) => {
    playingIdRef.current = id;
    setPlayingIdState(id);
  }, []);

  /**
   * 재생에 실패한 곡이 아직 "재생 중"으로 남아 있을 때만 비운다.
   * 기다리는 사이 다른 곡이 시작됐을 수 있고, 그때 무턱대고 지우면
   * 방금 시작한 곡의 알약(과 그 안의 영상 무대)까지 사라진다.
   */
  const clearIfStill = useCallback(
    (id: number) => {
      if (playingIdRef.current === id) setPlayingId(null);
    },
    [setPlayingId],
  );

  /**
   * 보류 중인 영상 요청을 끝낸다.
   * 반드시 promise를 매듭짓는다 — 조용히 버리면 그 요청을 기다리던 호출부(목록 화면의
   * 로딩 표시 같은 것)가 영원히 기다리고, 클로저도 붙잡힌 채 남는다.
   */
  const rejectPendingYt = useCallback((reason: Error): void => {
    const p = pendingYtRef.current;
    if (!p) return;
    pendingYtRef.current = null;
    clearTimeout(p.timer);
    p.reject(reason);
  }, []);

  // ── 볼륨 (localStorage 유지) ──────────────────────────────
  const [volume, setVolume] = useState(0.8);
  const volumeRef = useRef(0.8);
  const lastAudibleVolume = useRef(0.8);

  useEffect(() => {
    const raw = localStorage.getItem("songgalaxy-volume");
    const saved = raw === null ? NaN : Number(raw);
    if (!Number.isNaN(saved) && saved >= 0 && saved <= 1) {
      setVolume(saved);
      volumeRef.current = saved;
      if (saved > 0) lastAudibleVolume.current = saved;
    }
  }, []);

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    volumeRef.current = v;
    if (v > 0) lastAudibleVolume.current = v;
    if (audioRef.current) audioRef.current.volume = v;
    ytRef.current?.setVolume(v);
    localStorage.setItem("songgalaxy-volume", String(v));
  }, []);

  const toggleMute = useCallback(() => {
    changeVolume(volumeRef.current > 0 ? 0 : lastAudibleVolume.current);
  }, [changeVolume]);

  /**
   * 영상 엔진 점화 — 무대 손잡이가 손에 들어온 뒤에만 부른다.
   * playSong(무대가 이미 준비된 경우)과 onReady 재실행이 같은 절차를 써야
   * "펼침과 재생은 언제나 짝"이라는 규칙이 한 곳에서만 지켜진다.
   * 볼륨 블록 뒤에 둔다 — volumeRef를 읽기 때문(앞에 두면 볼륨 대입이 얼어버린다).
   */
  const startYoutube = useCallback(
    (api: YoutubeApi, song: PlayerSong) => {
      silenceOther("youtube");
      setEngine("youtube");
      setPlayingId(song.id);
      setPaused(false);
      setVideoExpandedState(true); // 영상을 트려면 패널이 보여야 한다 (약관)
      api.setVolume(volumeRef.current);
      api.load(song.youtubeVideoId as string);
      api.play();
    },
    [setEngine, setPaused, setPlayingId, silenceOther],
  );

  // 볼륨 뒤에 둔다 — 등록 즉시 현재 볼륨을 맞춰야 첫 곡부터 소리 크기가 같다
  const registerYoutube = useCallback(
    (api: YoutubeApi | null) => {
      ytRef.current = api;
      if (api) {
        api.setVolume(volumeRef.current);
        // 무대를 기다리던 요청을 여기서 되살린다. 이 재실행이 없으면
        // "무대는 틀려는 곡이 있어야 뜨고, 곡은 무대가 있어야 뜬다"는 교착에 걸려
        // 목록의 첫 곡은 언제나 실패한다
        const p = pendingYtRef.current;
        if (p) {
          pendingYtRef.current = null;
          clearTimeout(p.timer);
          startYoutube(api, p.song);
          p.resolve();
        }
        return;
      }
      // 무대가 사라지면 영상은 이미 멈춘 것이다 — 재생 중이라고 우기면
      // 재생 버튼이 먹통이 되므로(누를 손잡이가 없다) 일시정지로 표시한다.
      // 기다리던 요청은 여기서 취소하지 않는다: 무대는 곧바로 다시 서는 일이 흔하고
      // (StrictMode 이중 마운트·HMR·라우트 전환), 여기서 취소하면 그때마다 첫 곡이 날아간다.
      // 정말로 무대가 오지 않으면 대기 자체의 시간 제한이 정리한다
      if (engineRef.current === "youtube") setPaused(true);
    },
    [setPaused, startYoutube],
  );

  // ── 미디어 캐시 (앨범아트/미리듣기 URL, /api/enrich) ─────────
  const [media, setMedia] = useState<Record<number, Media>>({});
  const mediaRef = useRef<Record<number, Media>>({});
  const enrichRequested = useRef<Set<number>>(new Set());

  const fetchMedia = useCallback(async (ids: number[]): Promise<void> => {
    const fresh = ids.filter((id) => !enrichRequested.current.has(id)).slice(0, ENRICH_BATCH);
    if (fresh.length === 0) return;
    fresh.forEach((id) => enrichRequested.current.add(id));
    try {
      const r = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: fresh }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Record<number, Media>;
      mediaRef.current = { ...mediaRef.current, ...data };
      setMedia((prev) => ({ ...prev, ...data }));
    } catch {
      fresh.forEach((id) => enrichRequested.current.delete(id));
    }
  }, []);

  const getMedia = useCallback((id: number): Media | undefined => mediaRef.current[id], []);

  // ── 재생 코어 ─────────────────────────────────────────────
  /** 곡이 끝나면 다음 곡으로 자동 진행 (순환 참조 방지용 ref) */
  const advanceRef = useRef<(afterId: number) => Promise<void>>(async () => {});

  const playSong = useCallback(
    (song: PlayerSong, previewUrl: string | null, mode: "playlist" | "browse"): Promise<void> => {
      const chosen = pickEngine({
        mode,
        youtubeVideoId: song.youtubeVideoId,
        previewUrl,
      });
      if (!chosen) return Promise.reject(new Error("no-source"));
      if (chosen === "youtube") {
        const yt = ytRef.current;
        if (yt) {
          // 새 요청이 이겼다 — 기다리던 요청은 "밀렸다"고 알리고 끝낸다
          rejectPendingYt(new Error("superseded"));
          startYoutube(yt, song);
          return Promise.resolve();
        }
        // 무대가 아직 준비되지 않았다. 엔진·무대 상태는 건드리지 않고 기다린다 —
        // 반쯤 켜두면 빈 무대만 펼쳐진 채 재생 버튼도 먹지 않는 상태에 갇힌다.
        // 울리던 미리듣기는 반드시 멈춘다: 그냥 두면 두 곳에서 소리가 난다.
        // playingId만 미리 세우는 이유는 알약이 떠야 무대가 마운트되기 때문이다
        // (알약이 무대를 들고 있다). 엔진은 그대로 두므로 "접힌 채 재생"은 만들어지지 않는다
        audioRef.current?.pause();
        setPaused(true);
        setPlayingId(song.id);
        rejectPendingYt(new Error("superseded"));
        return new Promise<void>((resolve, reject) => {
          const seq = ++pendingSeqRef.current;
          const timer = setTimeout(() => {
            // 기다리는 사이 다른 요청이 자리를 차지했을 수 있다. 그때 여기서 뒷정리를 하면
            // (특히 같은 곡을 다시 튼 경우) 새 요청이 세워 둔 알약과 무대를 대신 무너뜨린다
            if (pendingYtRef.current?.seq !== seq) return;
            pendingYtRef.current = null;
            clearIfStill(song.id);
            reject(new Error("yt-not-ready"));
          }, YT_STAGE_READY_TIMEOUT_MS);
          pendingYtRef.current = { seq, song, resolve, reject, timer };
        });
      }

      // 미리듣기로 방향이 바뀌었다 — 기다리던 영상 요청도 매듭지어야 한다
      rejectPendingYt(new Error("superseded"));
      silenceOther(chosen);
      setEngine(chosen);
      setPlayingId(song.id);
      setPaused(false);

      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      audio.volume = volumeRef.current;
      audio.src = previewUrl as string;
      audio.onended = () => void advanceRef.current(song.id);
      /**
       * 소스를 못 읽으면 onended가 영영 오지 않는다 — 핸들러가 없으면 알약만 남고
       * 소리도 다음 곡도 없이 멈춘다("재생 버튼은 있는데 누르면 바로 꺼진다").
       * 그래서 실패도 곡이 끝난 것과 같게 취급해 다음 곡으로 넘긴다.
       * src를 바꾸는 순간 이전 로드는 abort이지 error가 아니므로 오발동하지 않는다.
       */
      audio.onerror = () => void advanceRef.current(song.id);
      return audio.play();
    },
    [clearIfStill, rejectPendingYt, setEngine, setPaused, setPlayingId, silenceOther, startYoutube],
  );

  /**
   * start 인덱스부터 dir 방향으로 큐를 한 바퀴 돌며 "지금 재생할 수 있는 첫 곡"을 찾는다.
   *
   * 자동 진행·이전/다음·목록 시작·영상 실패 폴백이 모두 이 한 곳을 쓴다. 경로마다 따로
   * 판단하면 곡별 폴백 규칙(영상 없으면 미리듣기, 둘 다 없으면 건너뜀)이 어긋나
   * "첫 곡 하나가 재생 불가면 목록 전체가 죽는" 식의 구멍이 생긴다.
   * 미디어를 기다리는 사이 큐가 바뀌면 null — 호출부는 queueRef로 "없음"과 구분할 수 있다.
   */
  const findPlayable = useCallback(
    async (q: PlayerQueue, start: number, dir: -1 | 1): Promise<Playable | null> => {
      const mode = q.mode ?? "browse";
      const n = q.songs.length;
      for (let step = 0; step < n; step++) {
        const i = (((start + dir * step) % n) + n) % n;
        const song = q.songs[i];
        let m = mediaRef.current[song.id];
        // 목록 재생에서 영상 ID가 있으면 미리듣기를 볼 필요가 없다
        if (!m && !(mode === "playlist" && song.youtubeVideoId)) {
          const batch =
            dir === 1
              ? q.songs.slice(i, i + ENRICH_BATCH)
              : q.songs.slice(Math.max(0, i - ENRICH_BATCH + 1), i + 1);
          await fetchMedia(batch.map((s) => s.id));
          m = mediaRef.current[song.id];
        }
        // 대기 중 큐가 바뀌었으면 진행 중단
        if (queueRef.current !== q) return null;
        const usable = pickEngine({
          mode,
          youtubeVideoId: song.youtubeVideoId,
          previewUrl: m?.previewUrl,
        });
        if (usable) return { song, previewUrl: m?.previewUrl ?? null };
      }
      return null;
    },
    [fetchMedia],
  );

  useEffect(() => {
    advanceRef.current = async (afterId: number) => {
      const q = queueRef.current;
      if (!q) {
        setPlayingId(null);
        return;
      }
      const idx = q.songs.findIndex((s) => s.id === afterId);
      if (idx < 0) {
        setPlayingId(null);
        return;
      }
      // 다음 곡부터 한 바퀴 — 끝나면 첫 곡으로 루프 (findPlayable이 감싸 계산한다)
      const hit = await findPlayable(q, idx + 1, 1);
      if (!hit) {
        if (queueRef.current === q) setPlayingId(null); // 재생 가능한 곡이 하나도 없음
        return;
      }
      playSong(hit.song, hit.previewUrl, q.mode ?? "browse").catch(() => clearIfStill(hit.song.id));
    };
  }, [clearIfStill, findPlayable, playSong, setPlayingId]);

  const playFrom = useCallback(
    async (q: PlayerQueue, songId: number): Promise<void> => {
      queueRef.current = q;
      setQueueState(q);
      let m = mediaRef.current[songId];
      if (!m) {
        await fetchMedia([songId]);
        m = mediaRef.current[songId];
      }
      if (!m?.previewUrl) {
        throw new Error("no-preview");
      }
      // 은하 탐색은 언제나 미리듣기다 — 별을 누를 때마다 영상을 켜지 않는다
      setNotice(null); // 앞 목록의 안내가 탐색 재생까지 따라오지 않게
      const song = q.songs.find((s) => s.id === songId) ?? { id: songId, title: "", artist: "" };
      try {
        await playSong(song, m.previewUrl, "browse");
      } catch (e) {
        clearIfStill(song.id);
        throw e;
      }
    },
    [clearIfStill, fetchMedia, playSong],
  );

  const toggle = useCallback(() => {
    if (playingIdRef.current === null) return;
    // 무대를 기다리는 중이다 — 곧 저절로 재생된다. 여기서 손대면 아직 엔진이
    // 정해지지 않아 미리듣기 분기로 새고, 방금 멈춘 옛 미리듣기가 되살아난다
    if (pendingYtRef.current) return;
    if (engineRef.current === "youtube") {
      const yt = ytRef.current;
      if (!yt) {
        // 무대가 (다시) 서는 중이다 — 은하 카드 패널을 열었다 닫으면 알약과 함께 무대도
        // 내려갔다가 다시 오르는데, 그 창에서 그냥 물러나면 재생 버튼도 "펼치고 이어 듣기"도
        // 아무 반응이 없는 막다른 길이 된다. 지금 곡을 다시 요청해 두면 무대가 준비되는
        // 즉시 이어서 울린다 (보류 → onReady 재실행 경로를 그대로 탄다)
        const q = queueRef.current;
        const song = q?.songs.find((s) => s.id === playingIdRef.current);
        if (song) {
          const m = mediaRef.current[song.id];
          void playSong(song, m?.previewUrl ?? null, q?.mode ?? "browse").catch(() => undefined);
          return;
        }
        // 지금 재생 중이라던 곡이 이 큐에 없다 — 다시 요청할 재료(영상 ID 등)가 없어
        // 여기서 되살릴 수 없는 진짜 막다른 길이다. 재생 상태를 비워 재생 버튼을 풀어준다
        // (advanceRef가 "재생 가능한 곡이 하나도 없음"일 때 쓰는 것과 같은 처리)
        setPlayingId(null);
        return;
      }
      if (isPausedRef.current) {
        setVideoExpandedState(true); // 접힌 채로 재생되면 안 된다
        yt.play();
        setPaused(false);
      } else {
        yt.pause();
        setPaused(true);
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) {
      setPaused(false);
      audio.play().catch(() => setPlayingId(null));
    } else {
      audio.pause();
      setPaused(true);
    }
  }, [playSong, setPaused, setPlayingId]);

  /**
   * 영상 패널 접기/펼치기.
   * 접으면 반드시 멈춘다 — 영상을 숨긴 채 소리만 내는 것은 YouTube 약관 위반이다.
   */
  const setVideoExpanded = useCallback(
    (v: boolean) => {
      setVideoExpandedState(v);
      if (!v && engineRef.current === "youtube") {
        ytRef.current?.pause();
        setPaused(true);
      }
    },
    [setPaused],
  );

  const playStep = useCallback(
    async (dir: -1 | 1, newQueue?: PlayerQueue): Promise<void> => {
      if (newQueue) {
        queueRef.current = newQueue;
        setQueueState(newQueue);
      }
      const q = queueRef.current;
      if (!q || q.songs.length === 0) return;
      const n = q.songs.length;
      const current = playingIdRef.current;
      const idx = current !== null ? q.songs.findIndex((s) => s.id === current) : -1;
      // 목록을 순환하며 재생 가능한 곡을 찾는다 (끝↔처음 루프)
      const start = idx < 0 ? (dir === 1 ? 0 : n - 1) : idx + dir;
      const hit = await findPlayable(q, start, dir);
      if (!hit) return;
      playSong(hit.song, hit.previewUrl, q.mode ?? "browse").catch(() => clearIfStill(hit.song.id));
    },
    [clearIfStill, findPlayable, playSong],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    ytRef.current?.stop();
    rejectPendingYt(new Error("stopped")); // 기다리던 요청이 정지 뒤에 되살아나면 안 된다
    setNotice(null);
    setEngine(null);
    setVideoExpandedState(false);
    setPlayingId(null);
    setPaused(false);
    queueRef.current = null;
    setQueueState(null);
  }, [rejectPendingYt, setEngine, setPaused, setPlayingId]);

  /** 목록 재생 시작 — 큐에 mode: "playlist"를 박아 YouTube 전곡 재생을 시도한다 */
  const playPlaylist = useCallback(
    async (q: PlayerQueue, songId: number): Promise<void> => {
      const withMode: PlayerQueue = { ...q, mode: "playlist" };
      queueRef.current = withMode;
      setQueueState(withMode);
      const idx = withMode.songs.findIndex((s) => s.id === songId);
      if (idx < 0) throw new Error("곡이 목록에 없습니다");
      // 새 목록이니 앞 목록에서 쌓인 오류 이력·안내는 지운다
      ytErrorsRef.current = { since: 0, count: 0 };
      ytSongErrorsRef.current = new Map();
      setNotice(null);
      // 시작 곡에 영상도 미리듣기도 없을 수 있다 — 거기서 멈추지 않고 뒤로 넘어가
      // 재생 가능한 첫 곡을 찾는다. 한 곡 때문에 목록 전체가 죽으면 안 된다
      const hit = await findPlayable(withMode, idx, 1);
      if (!hit) {
        // 기다리는 사이 다른 재생이 큐를 가져갔다면 실패가 아니다 (호출부가 삼키는 사유)
        if (queueRef.current !== withMode) throw new Error("superseded");
        throw new Error("no-source");
      }
      await playSong(hit.song, hit.previewUrl, "playlist");
    },
    [findPlayable, playSong],
  );

  /**
   * 이미 듣고 있는 큐 안에서 곡 고르기 (알약의 재생 목록 클릭).
   * 큐가 들고 있는 mode를 그대로 지킨다 — 목록 재생 중에 browse로 떨어뜨리면
   * 전곡 재생이 30초 미리듣기로 강등되고, 다음 곡부터 다시 영상으로 돌아와
   * 곡마다 재생 방식이 널뛴다.
   */
  const playInQueue = useCallback(
    (q: PlayerQueue, songId: number): Promise<void> =>
      (q.mode ?? "browse") === "playlist" ? playPlaylist(q, songId) : playFrom(q, songId),
    [playFrom, playPlaylist],
  );

  /**
   * 목록 화면에서 순서를 바꿨을 때 지금 듣는 큐도 같은 순서로 맞춘다.
   *
   * playingId·오디오·영상은 건드리지 않는다 — 듣던 곡은 그대로 흐르고,
   * 자동 진행(`advanceRef` → `findPlayable`)이 새 배열에서 현재 곡 다음을 찾는다.
   * 곡 객체를 그대로 재배열한다(새로 만들지 않는다) — youtubeVideoId 같은
   * 큐에서만 갱신된 값(영상 실패로 지워진 ID 등)을 잃지 않기 위해서다.
   */
  const reorderQueue = useCallback(
    (playlistId: number, songIds: number[]): void => {
      const q = queueRef.current;
      if (!q || q.playlistId !== playlistId) return;
      const byId = new Map(q.songs.map((s) => [s.id, s]));
      const songs = songIds.map((id) => byId.get(id)).filter((s): s is PlayerSong => s != null);
      // 큐에 없는 곡이 섞여 있으면(다른 탭에서 담긴 곡) 재배열을 포기한다 —
      // 반쪽짜리 큐를 만들면 듣던 곡이 사라질 수 있다
      if (songs.length !== q.songs.length) return;
      const next = { ...q, songs };
      queueRef.current = next;
      setQueueState(next);
    },
    [],
  );

  /**
   * 목록에서 뺀 곡을 지금 듣는 큐에서도 뺀다.
   *
   * 빼는 곡이 재생 중이면 ⏭를 누른 것과 같게 다음 곡으로 넘긴다 — 그러지 않으면
   * 큐에 없는 곡이 끝났을 때 `advanceRef`가 `idx < 0`으로 재생을 끝내버린다.
   *
   * `playStep(1)`을 그냥 부르면 안 된다: 이미 큐에서 빠진 곡을 찾지 못해(idx < 0)
   * 목록의 **첫 곡**부터 다시 트는데, 우리가 원하는 것은 뺀 자리의 다음 곡이다.
   * 그래서 넘길 곡을 빼기 전에 직접 정한다.
   */
  const removeFromQueue = useCallback(
    (playlistId: number, songId: number): void => {
      const q = queueRef.current;
      if (!q || q.playlistId !== playlistId) return;
      const wasPlaying = playingIdRef.current === songId;
      const at = q.songs.findIndex((s) => s.id === songId);
      const songs = q.songs.filter((s) => s.id !== songId);
      const next = { ...q, songs };
      queueRef.current = next;
      setQueueState(next);
      if (!wasPlaying) return;
      // 뺀 자리로 밀려 올라온 곡이 다음 곡이다. 마지막 곡을 뺐으면 첫 곡으로 돌아간다
      // (목록 재생은 끝↔처음 루프이므로 자동 진행과 같은 규칙)
      if (songs.length === 0) {
        setPlayingId(null);
        return;
      }
      const nextSong = songs[at % songs.length];
      // playInQueue는 이 큐의 mode를 지킨다 — 목록 재생이면 영상으로 이어진다.
      // 재생할 수 없는 곡이면 findPlayable이 그 다음으로 알아서 넘어간다
      void playInQueue(next, nextSong.id).catch(() => undefined);
    },
    [playInQueue, setPlayingId],
  );

  /**
   * 무대가 영상을 못 틀었을 때의 수습 — 그 곡만 미리듣기로 떨어뜨린다.
   *
   * 곡을 통째로 건너뛰면(예전 동작) 임베드가 막힌 영상 하나 때문에 그 곡이 모든 목록에서
   * 영영 재생되지 않는다. 그리고 오류 → 다음 곡 → 오류가 iframe 로드 속도로 이어지면
   * 목록 전체가 몇 초 만에 타버리므로, 짧은 창 안에 오류가 쌓이면 이 목록은 통째로
   * 미리듣기로 내리고 안내를 남긴다(설계의 "IFrame 실패 → 전체 미리듣기 + 안내 한 줄").
   * 그 폭주 차단은 시간 창을 쓰므로 넓게 흩어진 오류는 잡지 못한다 — 그래서 곡별로도
   * 시도 횟수에 상한을 둔다(`YT_PLAYBACK_ERROR_LIMIT`). 두 장치는 서로를 대신하지 않는다.
   */
  const reportYoutubeError = useCallback(
    (reason: YoutubeErrorReason): void => {
      void (async () => {
        const id = playingIdRef.current;
        if (id === null) return;
        const q = queueRef.current;
        const song = q?.songs.find((s) => s.id === id);
        const badId = song?.youtubeVideoId ?? null;

        // 임베드 거부·삭제된 영상만 서버 캐시에서 지운다. 검사 시각(youtube_checked_at)은
        // 남기므로 다시 검색하지 않는다 — 재검색해봐야 같은 영상을 또 찾아오며 쿼터만 태운다.
        // 스크립트 로드 실패("api")나 일시적 오류까지 지우면 멀쩡한 ID를 잃는다
        if (badId && reason === "embed-refused") {
          void fetch(`/api/songs/${id}/video`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId: badId }),
          }).catch(() => undefined);
        }

        const now = Date.now();
        const e = ytErrorsRef.current;
        if (now - e.since > YT_ERROR_WINDOW_MS) ytErrorsRef.current = { since: now, count: 0 };
        ytErrorsRef.current.count += 1;
        const giveUp = ytErrorsRef.current.count >= YT_ERROR_LIMIT;

        // "playback"은 한 번은 그대로 다시 시도한다 — 진짜 일시적인 오류가 흔해서
        // 첫 실패에 영상을 버리면 멀쩡히 재생될 곡을 30초 미리듣기로 강등시킨다.
        // 다만 같은 곡에서 반복되면 포기한다: 그러지 않으면 findPlayable이 같은 영상 ID로
        // 같은 곡을 계속 돌려줘 곡이 처음부터 무한히 다시 시작된다(폭주 창에도 안 걸린다).
        let repeated = false;
        if (reason === "playback") {
          const seen = (ytSongErrorsRef.current.get(id) ?? 0) + 1;
          ytSongErrorsRef.current.set(id, seen);
          repeated = seen >= YT_PLAYBACK_ERROR_LIMIT;
        }
        // 큐에서도 못 쓰는 영상 ID를 지운다 — 남겨두면 같은 영상을 계속 다시 시도한다.
        // 반복된 "playback"은 큐에서만 지우고 서버 캐시(clearYoutubeVideoId)는 건드리지 않는다:
        // 영상 자체는 멀쩡할 수 있고, 다음에 이 목록을 다시 틀면 한 번 더 기회를 준다
        const dropVideo = reason !== "playback" || repeated;
        let next = q;
        if (q && badId && dropVideo) {
          next = {
            ...q,
            songs: q.songs.map((s) => (s.id === id ? { ...s, youtubeVideoId: null } : s)),
          };
        }
        if (next && giveUp) next = { ...next, mode: "browse" };
        if (next && next !== q) {
          queueRef.current = next;
          setQueueState(next);
        }
        setNotice(
          giveUp
            ? "영상을 틀 수 없어 30초 미리듣기로 이어 듣습니다"
            : repeated && badId
              ? "이 곡은 영상이 계속 끊겨 30초 미리듣기로 재생합니다"
              : null,
        );

        const cur = queueRef.current;
        if (!cur) return;
        const at = cur.songs.findIndex((s) => s.id === id);
        // 같은 곡을 미리듣기로 다시, 미리듣기도 없으면 다음 곡으로 (findPlayable이 결정)
        const hit = await findPlayable(cur, at < 0 ? 0 : at, 1);
        if (!hit) {
          clearIfStill(id);
          return;
        }
        playSong(hit.song, hit.previewUrl, cur.mode ?? "browse").catch(() =>
          clearIfStill(hit.song.id),
        );
      })();
    },
    [clearIfStill, findPlayable, playSong],
  );

  const snapshot = useCallback((): PlayerSnapshot | null => {
    const audio = audioRef.current;
    const id = playingIdRef.current;
    // 오디오 객체가 있는지는 따지지 않는다 — 목록 재생만 한 세션은 오디오가 아예 없는데,
    // 여기서 null을 주면 행성에 내릴 때 호출부가 stop()으로 목록을 통째로 날린다
    if (id === null) return null;
    // 위치는 미리듣기 엔진의 것만 의미가 있다 — 영상 재생 중이면 남아 있는 옛 위치를 쓰지 않는다
    return {
      queue: queueRef.current,
      songId: id,
      time: audio && engineRef.current === "preview" ? audio.currentTime : 0,
    };
  }, []);

  const restore = useCallback(
    async (snap: PlayerSnapshot): Promise<void> => {
      queueRef.current = snap.queue;
      setQueueState(snap.queue);
      const mode = snap.queue?.mode ?? "browse";
      // 스냅샷은 곡 id만 들고 있다 — 큐에서 곡을 되찾아야 영상 ID까지 살아난다
      const song = snap.queue?.songs.find((s) => s.id === snap.songId) ?? {
        id: snap.songId,
        title: "",
        artist: "",
      };
      const m = mediaRef.current[snap.songId];
      try {
        await playSong(song, m?.previewUrl ?? null, mode);
        // 이어듣기 위치는 미리듣기에서만 되돌린다
        if (engineRef.current === "preview" && audioRef.current) {
          audioRef.current.currentTime = snap.time;
        }
      } catch {
        clearIfStill(song.id);
      }
    },
    [clearIfStill, playSong],
  );

  const stageVideoId = useMemo(
    () => stageSeed(queue, engine, playingId),
    [queue, engine, playingId],
  );

  const value = useMemo<PlayerContextValue>(
    () => ({
      playingId,
      isPaused,
      queue,
      volume,
      media,
      fetchMedia,
      getMedia,
      playFrom,
      playInQueue,
      toggle,
      playStep,
      stop,
      changeVolume,
      toggleMute,
      snapshot,
      restore,
      uiHosted,
      setUiHosted,
      engine,
      videoExpanded,
      setVideoExpanded,
      stageVideoId,
      playPlaylist,
      reorderQueue,
      removeFromQueue,
      registerYoutube,
      reportYoutubeError,
      notice,
    }),
    [
      playingId,
      isPaused,
      queue,
      volume,
      media,
      fetchMedia,
      getMedia,
      playFrom,
      playInQueue,
      toggle,
      playStep,
      stop,
      changeVolume,
      toggleMute,
      snapshot,
      restore,
      uiHosted,
      engine,
      videoExpanded,
      setVideoExpanded,
      stageVideoId,
      playPlaylist,
      reorderQueue,
      removeFromQueue,
      registerYoutube,
      reportYoutubeError,
      notice,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
