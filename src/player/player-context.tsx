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
import { ENRICH_BATCH } from "@/config/constants";
import { pickEngine, type Engine } from "./engine";

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
  /** playlist면 YouTube 전곡 재생을 시도한다. 없으면 browse(30초 미리듣기) */
  mode?: "playlist" | "browse";
  songs: PlayerSong[];
}

/** YoutubeStage가 넘겨주는 제어 손잡이. 제어권은 Provider가 갖는다 */
export interface YoutubeApi {
  load(videoId: string): void;
  play(): void;
  pause(): void;
  stop(): void;
  setVolume(v0to1: number): void;
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
  /** 지금 소리를 내고 있는 엔진 — 둘 중 하나만 켜진다 */
  engine: Engine | null;
  /** 영상 패널이 펼쳐져 있는지. 접으면 재생도 멈춘다 (약관: 영상은 보여야 한다) */
  videoExpanded: boolean;
  setVideoExpanded: (v: boolean) => void;
  /** 목록 재생 시작 — YouTube 전곡 재생을 시도한다 */
  playPlaylist: (queue: PlayerQueue, songId: number) => Promise<void>;
  registerYoutube: (api: YoutubeApi | null) => void;
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

  // 볼륨 뒤에 둔다 — 등록 즉시 현재 볼륨을 맞춰야 첫 곡부터 소리 크기가 같다
  const registerYoutube = useCallback(
    (api: YoutubeApi | null) => {
      ytRef.current = api;
      if (api) {
        api.setVolume(volumeRef.current);
        return;
      }
      // 무대가 사라지면 영상은 이미 멈춘 것이다 — 재생 중이라고 우기면
      // 재생 버튼이 먹통이 되므로(누를 손잡이가 없다) 일시정지로 표시한다
      if (engineRef.current === "youtube") setPaused(true);
    },
    [setPaused],
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
      const yt = chosen === "youtube" ? ytRef.current : null;
      if (chosen === "youtube" && !yt) {
        // 무대가 아직 준비되지 않았다. 엔진·무대 상태는 건드리지 않고 물러난다 —
        // 반쯤 켜두면 빈 무대만 펼쳐진 채 재생 버튼도 먹지 않는 상태에 갇힌다.
        // 다만 울리던 미리듣기는 반드시 멈춘다: 호출부들이 이 거부를 삼키며
        // playingId를 지우므로, 그냥 두면 조작할 UI 없이 소리만 남는다
        audioRef.current?.pause();
        setPaused(true);
        return Promise.reject(new Error("yt-not-ready"));
      }

      silenceOther(chosen);
      setEngine(chosen);
      setPlayingId(song.id);
      setPaused(false);

      if (yt) {
        // 영상을 트려면 패널이 보여야 한다
        setVideoExpandedState(true);
        yt.setVolume(volumeRef.current);
        yt.load(song.youtubeVideoId as string);
        yt.play();
        return Promise.resolve();
      }

      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      audio.volume = volumeRef.current;
      audio.src = previewUrl as string;
      audio.onended = () => void advanceRef.current(song.id);
      return audio.play();
    },
    [setEngine, setPaused, setPlayingId, silenceOther],
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
      // 다음 곡부터 목록을 한 바퀴 돌며 재생 가능한 곡을 찾는다 — 끝나면 첫 곡으로 루프
      const mode = q.mode ?? "browse";
      const n = q.songs.length;
      for (let step = 1; step <= n; step++) {
        const i = (idx + step) % n;
        const song = q.songs[i];
        let m = mediaRef.current[song.id];
        // 목록 재생에서 영상 ID가 있으면 미리듣기를 볼 필요가 없다
        if (!m && !(mode === "playlist" && song.youtubeVideoId)) {
          await fetchMedia(q.songs.slice(i, i + ENRICH_BATCH).map((s) => s.id));
          m = mediaRef.current[song.id];
        }
        // 대기 중 큐가 바뀌었으면 진행 중단
        if (queueRef.current !== q) return;
        const usable = pickEngine({
          mode,
          youtubeVideoId: song.youtubeVideoId,
          previewUrl: m?.previewUrl,
        });
        if (usable) {
          playSong(song, m?.previewUrl ?? null, mode).catch(() => setPlayingId(null));
          return;
        }
      }
      setPlayingId(null); // 재생 가능한 곡이 하나도 없음
    };
  }, [fetchMedia, playSong, setPlayingId]);

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
      const song = q.songs.find((s) => s.id === songId) ?? { id: songId, title: "", artist: "" };
      try {
        await playSong(song, m.previewUrl, "browse");
      } catch (e) {
        setPlayingId(null);
        throw e;
      }
    },
    [fetchMedia, playSong, setPlayingId],
  );

  const toggle = useCallback(() => {
    if (playingIdRef.current === null) return;
    if (engineRef.current === "youtube") {
      const yt = ytRef.current;
      if (!yt) return;
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
  }, [setPaused, setPlayingId]);

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
      const start = idx < 0 ? (dir === 1 ? 0 : n - 1) : (((idx + dir) % n) + n) % n;
      // 목록을 순환하며 재생 가능한 곡을 찾는다 (끝↔처음 루프)
      const mode = q.mode ?? "browse";
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
        if (queueRef.current !== q) return;
        const usable = pickEngine({
          mode,
          youtubeVideoId: song.youtubeVideoId,
          previewUrl: m?.previewUrl,
        });
        if (usable) {
          playSong(song, m?.previewUrl ?? null, mode).catch(() => setPlayingId(null));
          return;
        }
      }
    },
    [fetchMedia, playSong, setPlayingId],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    ytRef.current?.stop();
    setEngine(null);
    setVideoExpandedState(false);
    setPlayingId(null);
    setPaused(false);
    queueRef.current = null;
    setQueueState(null);
  }, [setEngine, setPaused, setPlayingId]);

  /** 목록 재생 시작 — 큐에 mode: "playlist"를 박아 YouTube 전곡 재생을 시도한다 */
  const playPlaylist = useCallback(
    async (q: PlayerQueue, songId: number): Promise<void> => {
      const withMode: PlayerQueue = { ...q, mode: "playlist" };
      queueRef.current = withMode;
      setQueueState(withMode);
      const song = withMode.songs.find((s) => s.id === songId);
      if (!song) throw new Error("곡이 목록에 없습니다");
      let m = mediaRef.current[songId];
      if (!m && !song.youtubeVideoId) {
        await fetchMedia([songId]);
        m = mediaRef.current[songId];
      }
      await playSong(song, m?.previewUrl ?? null, "playlist");
    },
    [fetchMedia, playSong],
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
        setPlayingId(null);
      }
    },
    [playSong, setPlayingId],
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
      playPlaylist,
      registerYoutube,
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
      playPlaylist,
      registerYoutube,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
