"use client";

/** 목록 재생 시작 — 서버 컴포넌트에서 넘겨준 곡들을 큐로 만들어 전곡 재생을 건다 */
import { useState } from "react";
import { usePlayer, type PlayerSong } from "@/player/player-context";

export default function PlaylistPlayButton({
  name,
  songs,
}: {
  name: string;
  songs: PlayerSong[];
}) {
  const { playPlaylist } = usePlayer();
  const [error, setError] = useState<string | null>(null);
  if (songs.length === 0) return null;

  const handleClick = () => {
    setError(null);
    // playPlaylist는 사용자가 다른 곡을 누르거나(superseded) 정지를 누르면(stopped)도
    // 정상적으로 reject한다 — 이걸 그냥 삼키지 않으면 콘솔에 처리되지 않은 거부만 쌓이고,
    // 그렇다고 무조건 삼키면 진짜 실패(영상 못 찾음·무대 미준비)까지 조용히 묻힌다
    playPlaylist({ title: name, songs }, songs[0].id).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : "";
      if (message === "superseded" || message === "stopped") return;
      setError(
        message === "yt-not-ready"
          ? "영상을 준비하지 못했어요 — 잠시 후 다시 눌러주세요"
          : "재생할 수 있는 곡이 없어요",
      );
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm transition hover:bg-white/20"
      >
        ▶ 목록 재생
      </button>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
