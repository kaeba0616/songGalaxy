"use client";

import { useState } from "react";

/**
 * 좋아요 토글 버튼 (곡 상세·내 취향 페이지용).
 * 비로그인 클릭 시 Google 로그인으로 보낸다. 별 탄생 시 짧은 알림을 띄운다.
 */
export default function LikeButton({
  songId,
  initialLiked,
  authenticated,
  size = "md",
}: {
  songId: number;
  initialLiked: boolean;
  authenticated: boolean;
  size?: "md" | "lg";
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = async () => {
    if (!authenticated) {
      window.location.href = `/api/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    const next = !liked;
    setLiked(next);
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId, liked: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { starBorn: boolean };
      if (data.starBorn) {
        setMessage("🌟 내 별이 태어났어요! 은하에서 확인해보세요");
        setTimeout(() => setMessage(null), 4500);
      }
    } catch {
      setLiked(!next);
    }
  };

  const base =
    size === "lg"
      ? "h-11 w-11 text-lg"
      : "h-8 w-8 text-sm";

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => void toggle()}
        className={`grid ${base} place-items-center rounded-full border transition ${
          liked
            ? "border-pink-400/60 bg-pink-500/25 text-pink-200"
            : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"
        }`}
        aria-label={liked ? "좋아요 취소" : "좋아요"}
        title={authenticated ? "좋아요" : "로그인하고 좋아요"}
      >
        {liked ? "♥" : "♡"}
      </button>
      {message && (
        <span className="absolute left-full top-1/2 ml-3 w-max -translate-y-1/2 rounded-full border border-amber-200/40 bg-black/80 px-4 py-1.5 text-xs text-amber-100">
          {message}
        </span>
      )}
    </span>
  );
}
