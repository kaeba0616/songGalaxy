"use client";

/**
 * 로그인·좋아요·내 별 상태의 단일 원본 (SSOT).
 *
 * 서버의 원본은 `likes` 테이블이고, 클라이언트에서는 `/api/likes`가 그 창구다.
 * 은하 캔버스·미니플레이어처럼 여러 화면이 같은 좋아요 상태를 보여줘야 하므로
 * 여기서 한 번만 불러오고, 토글도 여기서만 한다 (컴포넌트별 중복 fetch 금지).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface AuthState {
  authenticated: boolean;
  userId?: number;
  nickname?: string;
  /** 프로필 사진 URL — 없으면 닉네임 첫 글자로 대신 그린다 */
  avatarUrl?: string | null;
  likedIds: Set<number>;
  likesCount: number;
  /** 내 별 좌표 (없으면 아직 미탄생) */
  star: { x: number; y: number; z: number } | null;
}

/** 좋아요 토글 결과 — 별 탄생 연출 등 화면별 후처리에 쓴다 */
export interface LikeResult {
  likesCount: number;
  star: { x: number; y: number; z: number } | null;
  starBorn: boolean;
}

interface LikesValue {
  auth: AuthState;
  /**
   * 좋아요 토글. 낙관적으로 먼저 반영하고 실패하면 되돌린다.
   * 비로그인이면 로그인 화면으로 보내고 null을 반환한다.
   */
  toggleLike: (songId: number) => Promise<LikeResult | null>;
  /** 프로필 저장 후 닉네임 갱신 */
  setNickname: (nickname: string) => void;
}

const LikesContext = createContext<LikesValue | null>(null);

export function useLikes(): LikesValue {
  const ctx = useContext(LikesContext);
  if (!ctx) throw new Error("useLikes는 LikesProvider 안에서만 쓸 수 있습니다");
  return ctx;
}

export function LikesProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    authenticated: false,
    likedIds: new Set(),
    likesCount: 0,
    star: null,
  });

  useEffect(() => {
    let alive = true;
    fetch("/api/likes")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (data: {
          authenticated: boolean;
          userId?: number;
          nickname?: string;
          avatarUrl?: string | null;
          likedIds?: number[];
          likesCount?: number;
          star?: { x: number; y: number; z: number } | null;
        } | null) => {
          if (!data || !alive) return;
          setAuth({
            authenticated: data.authenticated,
            userId: data.userId,
            nickname: data.nickname,
            avatarUrl: data.avatarUrl ?? null,
            likedIds: new Set(data.likedIds ?? []),
            likesCount: data.likesCount ?? 0,
            star: data.star ?? null,
          });
        },
      )
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const toggleLike = useCallback(
    async (songId: number): Promise<LikeResult | null> => {
      let liked = false;
      let wasAuthenticated = true;
      setAuth((prev) => {
        if (!prev.authenticated) {
          wasAuthenticated = false;
          return prev;
        }
        liked = !prev.likedIds.has(songId);
        const next = new Set(prev.likedIds);
        if (liked) next.add(songId);
        else next.delete(songId);
        return { ...prev, likedIds: next };
      });
      if (!wasAuthenticated) {
        const back = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/api/auth/signin?callbackUrl=${back}`;
        return null;
      }
      try {
        const res = await fetch("/api/likes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ songId, liked }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as LikeResult;
        setAuth((prev) => ({ ...prev, likesCount: data.likesCount, star: data.star }));
        return data;
      } catch {
        // 실패 시 낙관적 반영 롤백
        setAuth((prev) => {
          const next = new Set(prev.likedIds);
          if (liked) next.delete(songId);
          else next.add(songId);
          return { ...prev, likedIds: next };
        });
        return null;
      }
    },
    [],
  );

  const setNickname = useCallback((nickname: string) => {
    setAuth((prev) => ({ ...prev, nickname }));
  }, []);

  const value = useMemo<LikesValue>(
    () => ({ auth, toggleLike, setNickname }),
    [auth, toggleLike, setNickname],
  );

  return <LikesContext.Provider value={value}>{children}</LikesContext.Provider>;
}
