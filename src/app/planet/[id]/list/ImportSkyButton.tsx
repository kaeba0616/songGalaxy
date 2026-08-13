"use client";

/** 이 행성의 밤하늘을 내 노래 목록으로 복제 — 보기(페이지)와 가져오기(버튼)를 분리 */
import { useState } from "react";

export default function ImportSkyButton({ fromUserId }: { fromUserId: number }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    if (state !== "idle") return;
    setState("busy");
    try {
      const res = await fetch("/api/playlists/import-sky", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId }),
      });
      const data = (await res.json()) as { name?: string; count?: number; error?: string };
      if (res.status === 401) {
        // 비로그인 — 로그인하고 돌아오면 다시 누르면 된다
        window.location.href = `/api/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!res.ok) throw new Error(data.error);
      setState("done");
      setMessage(`"${data.name}"으로 ${data.count}곡을 가져왔어요`);
    } catch {
      setState("idle");
      setMessage("가져오지 못했어요. 잠시 후 다시 시도해주세요");
      setTimeout(() => setMessage(null), 4000);
    }
  };

  return (
    <span className="flex items-center gap-3">
      {message && <span className="text-xs text-amber-100/80">{message}</span>}
      <button
        type="button"
        onClick={() => void run()}
        disabled={state !== "idle"}
        className="cursor-pointer rounded-full border border-amber-200/50 bg-amber-100/10 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-100/20 disabled:cursor-default disabled:opacity-60"
      >
        {state === "done" ? "✓ 가져왔어요" : state === "busy" ? "가져오는 중…" : "⤵ 내 목록으로 가져오기"}
      </button>
    </span>
  );
}
