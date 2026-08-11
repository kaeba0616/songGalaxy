"use client";

/** 내 목록 관리 — 만들기·이름 변경·삭제·공유 링크 */
import Link from "next/link";
import { useRef, useState } from "react";
import type { PlaylistSummary } from "@/server/playlists";

/**
 * 서버 에러 메시지를 화면에 찍기 전 실제로 문자열인지 런타임에 확인한다.
 * 지금은 모든 라우트가 문자열 리터럴만 주지만, `as { error?: string }` 캐스팅만으로는
 * 그걸 강제하지 못한다 — 문자열이 아닌 값이 와도 그대로 JSX에 박힐 수 있다.
 */
function serverError(j: unknown, fallback: string): string {
  const msg = j && typeof j === "object" ? (j as Record<string, unknown>).error : undefined;
  return typeof msg === "string" ? msg : fallback;
}

export default function PlaylistManager({ initial }: { initial: PlaylistSummary[] }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 진행 중 여부를 ref로도 들고 있는다 — state는 다음 렌더에서야 반영되므로
   * 더블클릭이나 Enter+클릭처럼 같은 이벤트 루프 틱 안에서 핸들러가 두 번 불리면
   * busy state만으로는 두 번째 호출을 막지 못한다(AddToPlaylist.tsx와 같은 이유).
   * 만들기·이름 변경·공유 전환·삭제 네 동작 모두 이 하나의 빗장을 공유해
   * 서로 겹쳐 불리지 않게 한다 — 그래야 toggleShare가 캡처한 p.shareSlug가
   * 두 번째 클릭 사이에 낡아버리는 경쟁도 함께 막힌다.
   */
  const busyRef = useRef(false);

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busyRef.current) return;
    setBusyBoth(true);
    setError(null);
    try {
      const r = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = (await r.json().catch(() => null)) as { playlist?: PlaylistSummary; error?: string } | null;
      if (!r.ok || !j?.playlist) {
        setError(serverError(j, "목록을 만들지 못했어요"));
        return;
      }
      setItems((p) => [j.playlist as PlaylistSummary, ...p]);
      setName("");
    } catch {
      setError("목록을 만들지 못했어요");
    } finally {
      setBusyBoth(false);
    }
  };

  const rename = async (p: PlaylistSummary) => {
    if (busyRef.current) return;
    const next = window.prompt("새 이름", p.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === p.name) return;
    setBusyBoth(true);
    setError(null);
    try {
      const r = await fetch(`/api/playlists/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setError(serverError(j, "이름을 바꾸지 못했어요"));
        return;
      }
      setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, name: trimmed } : x)));
    } catch {
      setError("이름을 바꾸지 못했어요");
    } finally {
      setBusyBoth(false);
    }
  };

  const toggleShare = async (p: PlaylistSummary) => {
    if (busyRef.current) return;
    setBusyBoth(true);
    setError(null);
    try {
      const r = await fetch(`/api/playlists/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: p.shareSlug === null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setError(serverError(j, "공유 설정을 바꾸지 못했어요"));
        return;
      }
      const j = (await r.json()) as { shareSlug: string | null };
      setItems((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, shareSlug: j.shareSlug } : x)),
      );
    } catch {
      setError("공유 설정을 바꾸지 못했어요");
    } finally {
      setBusyBoth(false);
    }
  };

  const remove = async (id: number) => {
    if (busyRef.current) return;
    setBusyBoth(true);
    setError(null);
    try {
      const r = await fetch(`/api/playlists/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setError(serverError(j, "삭제하지 못했어요"));
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      setError("삭제하지 못했어요");
    } finally {
      setBusyBoth(false);
    }
  };

  return (
    <>
      <div className="mb-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="새 목록 이름"
          aria-label="새 목록 이름"
          disabled={busy}
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
          className="shrink-0 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20 disabled:opacity-40"
        >
          만들기
        </button>
      </div>

      {/* 실패해도 목록은 그대로 남긴다 — 다시 시도할 수 있어야 한다 (AddToPlaylist.tsx와 동일) */}
      {error && <p className="mb-3 text-xs text-rose-300">{error}</p>}

      <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
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
              disabled={busy}
              onClick={() => void rename(p)}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs transition hover:bg-white/10 disabled:opacity-40"
            >
              이름 변경
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleShare(p)}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs transition hover:bg-white/10 disabled:opacity-40"
            >
              {p.shareSlug ? "공유 끄기" : "공유 켜기"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(p.id)}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-white/50 transition hover:bg-white/10 disabled:opacity-40"
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
