"use client";

/**
 * ♥ 좋아요 버튼 — 곡 목록 행·곡 상세·내 취향 페이지 공용.
 *
 * 상태는 공용 컨텍스트(likes-context)가 원본이다 — 예전엔 이 컴포넌트가 자체
 * state + fetch를 들고 있어서, 여기서 누른 좋아요가 알약·카드에는 반영되지 않았다.
 * 비로그인 처리(로그인 화면 이동)와 낙관적 반영·실패 되돌림은 toggleLike가 한다.
 * 별이 태어나면 짧은 알림을 띄운다.
 */
import { useState } from "react";
import { useLikes } from "@/likes/likes-context";

export default function LikeButton({
  songId,
  size = "md",
}: {
  songId: number;
  size?: "md" | "lg";
}) {
  const { auth, toggleLike } = useLikes();
  const liked = auth.likedIds.has(songId);
  const [message, setMessage] = useState<string | null>(null);

  const onClick = async () => {
    const result = await toggleLike(songId);
    if (result?.starBorn) {
      setMessage("🌟 내 별이 태어났어요! 은하에서 확인해보세요");
      setTimeout(() => setMessage(null), 4500);
    }
  };

  const base = size === "lg" ? "h-11 w-11 text-lg" : "h-8 w-8 text-sm";

  return (
    <span className="relative inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => void onClick()}
        className={`grid ${base} cursor-pointer place-items-center rounded-full border transition ${
          liked
            ? "border-pink-400/60 bg-pink-500/25 text-pink-200"
            : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"
        }`}
        aria-label={liked ? "좋아요 취소" : "좋아요"}
        aria-pressed={liked}
        title={auth.authenticated ? "좋아요" : "로그인하고 좋아요"}
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
