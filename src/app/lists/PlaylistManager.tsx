"use client";

/** 내 목록 관리 — 만들기·이름 변경·삭제·공유 링크 */
import Link from "next/link";
import { useState } from "react";
import type { PlaylistSummary } from "@/server/playlists";

export default function PlaylistManager({ initial }: { initial: PlaylistSummary[] }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const r = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const j = (await r.json()) as { playlist?: PlaylistSummary };
    if (j.playlist) {
      setItems((p) => [j.playlist as PlaylistSummary, ...p]);
      setName("");
    }
  };

  const rename = async (p: PlaylistSummary) => {
    const next = window.prompt("새 이름", p.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === p.name) return;
    const r = await fetch(`/api/playlists/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!r.ok) return;
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, name: trimmed } : x)));
  };

  const toggleShare = async (p: PlaylistSummary) => {
    const r = await fetch(`/api/playlists/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: p.shareSlug === null }),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { shareSlug: string | null };
    setItems((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, shareSlug: j.shareSlug } : x)),
    );
  };

  const remove = async (id: number) => {
    await fetch(`/api/playlists/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <>
      <div className="mb-5 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="새 목록 이름"
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void create()}
          className="shrink-0 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20"
        >
          만들기
        </button>
      </div>

      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <Link href={`/lists/${p.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-white/40">{p.songCount}곡</span>
            </Link>
            {p.shareSlug && (
              <Link
                href={`/list/${p.shareSlug}`}
                className="shrink-0 text-xs text-amber-200/80 underline"
              >
                공유 링크
              </Link>
            )}
            <button
              type="button"
              onClick={() => void rename(p)}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs transition hover:bg-white/10"
            >
              이름 변경
            </button>
            <button
              type="button"
              onClick={() => void toggleShare(p)}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs transition hover:bg-white/10"
            >
              {p.shareSlug ? "공유 끄기" : "공유 켜기"}
            </button>
            <button
              type="button"
              onClick={() => void remove(p.id)}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-white/50 transition hover:bg-white/10"
            >
              삭제
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-white/40">
            아직 목록이 없어요 — 위에서 하나 만들어보세요
          </li>
        )}
      </ul>
    </>
  );
}
