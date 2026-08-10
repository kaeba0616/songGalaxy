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
  songs: PlayerSong[];
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
  /** 재생/일시정지 토글 (재생 중인 곡이 있을 때만 동작) */
  toggle: () => void;
  /** 이전/다음 곡 — 미리듣기 없는 곡은 건너뜀, 끝↔처음 루프. newQueue를 주면 그 목록을 큐로 삼는다 */
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
  const [queue, setQueueState] = useState<PlayerQueue | null>(null);
  const queueRef = useRef<PlayerQueue | null>(null);
  const [uiHosted, setUiHosted] = useState(false);

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
    localStorage.setItem("songgalaxy-volume", String(v));
  }, []);

  const toggleMute = useCallback(() => {
    changeVolume(volumeRef.current > 0 ? 0 : lastAudibleVolume.current);
  }, [changeVolume]);

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
    (songId: number, previewUrl: string): Promise<void> => {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;
      audio.volume = volumeRef.current;
      audio.src = previewUrl;
      audio.onended = () => void advanceRef.current(songId);
      setPlayingId(songId);
      setIsPaused(false);
      return audio.play();
    },
    [setPlayingId],
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
      // 다음 곡부터 목록을 한 바퀴 돌며 미리듣기 있는 곡을 찾는다 — 끝나면 첫 곡으로 루프
      const n = q.songs.length;
      for (let step = 1; step <= n; step++) {
        const i = (idx + step) % n;
        const song = q.songs[i];
        let m = mediaRef.current[song.id];
        if (!m) {
          await fetchMedia(q.songs.slice(i, i + ENRICH_BATCH).map((s) => s.id));
          m = mediaRef.current[song.id];
        }
        // 대기 중 큐가 바뀌었으면 진행 중단
        if (queueRef.current !== q) return;
        if (m?.previewUrl) {
          playSong(song.id, m.previewUrl).catch(() => setPlayingId(null));
          return;
        }
      }
      setPlayingId(null); // 미리듣기 가능한 곡이 하나도 없음
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
      try {
        await playSong(songId, m.previewUrl);
      } catch (e) {
        setPlayingId(null);
        throw e;
      }
    },
    [fetchMedia, playSong, setPlayingId],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (playingIdRef.current === null || !audio || !audio.src) return;
    if (audio.paused) {
      setIsPaused(false);
      audio.play().catch(() => setPlayingId(null));
    } else {
      audio.pause();
      setIsPaused(true);
    }
  }, [setPlayingId]);

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
      // 목록을 순환하며 미리듣기 있는 곡을 찾는다 (끝↔처음 루프)
      for (let step = 0; step < n; step++) {
        const i = (((start + dir * step) % n) + n) % n;
        const song = q.songs[i];
        let m = mediaRef.current[song.id];
        if (!m) {
          const batch =
            dir === 1
              ? q.songs.slice(i, i + ENRICH_BATCH)
              : q.songs.slice(Math.max(0, i - ENRICH_BATCH + 1), i + 1);
          await fetchMedia(batch.map((s) => s.id));
          m = mediaRef.current[song.id];
        }
        // 대기 중 큐가 바뀌었으면 진행 중단
        if (queueRef.current !== q) return;
        if (m?.previewUrl) {
          playSong(song.id, m.previewUrl).catch(() => setPlayingId(null));
          return;
        }
      }
    },
    [fetchMedia, playSong, setPlayingId],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlayingId(null);
    setIsPaused(false);
    queueRef.current = null;
    setQueueState(null);
  }, [setPlayingId]);

  const snapshot = useCallback((): PlayerSnapshot | null => {
    const audio = audioRef.current;
    const id = playingIdRef.current;
    if (id === null || !audio) return null;
    return { queue: queueRef.current, songId: id, time: audio.currentTime };
  }, []);

  const restore = useCallback(
    async (snap: PlayerSnapshot): Promise<void> => {
      queueRef.current = snap.queue;
      setQueueState(snap.queue);
      const m = mediaRef.current[snap.songId];
      if (!m?.previewUrl) {
        setPlayingId(null);
        return;
      }
      try {
        await playSong(snap.songId, m.previewUrl);
        if (audioRef.current) audioRef.current.currentTime = snap.time;
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
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
