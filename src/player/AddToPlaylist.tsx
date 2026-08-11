"use client";

/**
 * 지금 듣는 곡을 목록에 담는 팝오버.
 * 목록이 하나도 없으면 그 자리에서 이름을 입력해 만든다 —
 * 목록을 만들러 다른 페이지로 보내면 담으려던 곡을 놓친다.
 */
import { useEffect, useState } from "react";

interface Item {
  id: number;
  name: string;
  songCount: number;
}

export default function AddToPlaylist({
  songId,
  onClose,
}: {
  songId: number;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [authed, setAuthed] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/playlists");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { authenticated: boolean; playlists: Item[] };
        if (!alive) return;
        setAuthed(j.authenticated);
        setItems(j.playlists);
      } catch {
        // 목록을 못 읽어도 팝오버는 살아 있다 — 새 목록을 만들어 담는 길이 남는다
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const add = async (playlistId: number, label: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId }),
      });
      const j = (await r.json()) as { ok?: boolean; already?: boolean; error?: string };
      // r.ok를 먼저 본다 — 서버가 error만 돌려줄 때 j.already가 undefined라
      // 그대로 두면 실패를 "담았어요"로 알리게 된다
      if (!r.ok || !j.ok) {
        setDone(j.error ?? "담지 못했어요");
        setBusy(false);
        return;
      }
      setDone(j.already ? `이미 «${label}»에 있어요` : `«${label}»에 담았어요`);
      setTimeout(onClose, 1200);
    } catch {
      setDone("담지 못했어요");
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const r = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = (await r.json()) as { playlist?: Item };
      if (j.playlist) await add(j.playlist.id, j.playlist.name);
      else {
        setDone("목록을 만들지 못했어요");
        setBusy(false);
      }
    } catch {
      setDone("목록을 만들지 못했어요");
      setBusy(false);
    }
  };

  return (
    <div
      data-nodrag
      className="absolute bottom-full left-0 mb-2 w-full rounded-2xl border border-white/15 bg-black/90 p-3 text-sm text-white shadow-xl backdrop-blur"
    >
      {done ? (
        <p className="py-2 text-center text-white/70">{done}</p>
      ) : !authed ? (
        <a
          href={`/api/auth/signin?callbackUrl=${encodeURIComponent("/")}`}
          className="block py-2 text-center underline"
        >
          로그인하고 목록에 담기
        </a>
      ) : (
        <>
          {items && items.length > 0 && (
            <ul className="mb-2 max-h-40 overflow-y-auto overscroll-contain" style={{ touchAction: "pan-y" }}>
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void add(p.id, p.name)}
                    className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-white/35">{p.songCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAndAdd();
              }}
              placeholder="새 목록 이름"
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => void createAndAdd()}
              className="shrink-0 cursor-pointer rounded-full border border-white/20 bg-white/10 px-3 py-1.5 transition hover:bg-white/20 disabled:opacity-40"
            >
              담기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
