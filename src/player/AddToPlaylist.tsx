"use client";

/**
 * 지금 듣는 곡을 목록에 담는 팝오버.
 * 목록이 하나도 없으면 그 자리에서 이름을 입력해 만든다 —
 * 목록을 만들러 다른 페이지로 보내면 담으려던 곡을 놓친다.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Item {
  id: number;
  name: string;
  songCount: number;
}

/** 알약 위에 띄울 때의 자리 — 알약 폭을 그대로 쓰고 위로 펼친다 */
const PANEL_ABOVE_FULL =
  "absolute bottom-full left-0 mb-2 w-full rounded-2xl border border-white/15 bg-black/90 p-3 text-sm text-white shadow-xl backdrop-blur";

export default function AddToPlaylist({
  songId,
  onClose,
  panelClassName = PANEL_ABOVE_FULL,
  panelStyle,
  onAdded,
}: {
  songId: number;
  onClose: () => void;
  /** 붙는 자리는 부르는 쪽이 정한다 — 알약과 목록 행은 폭도 방향도 다르다 */
  panelClassName?: string;
  /**
   * 담기 성공(이미 있음 포함) 알림 — 넘기면 "«이름»에 담았어요" 문구 대신
   * 팝오버를 바로 닫고 부모가 + 버튼을 ✓로 잠깐 바꾸는 식으로 피드백한다
   */
  onAdded?: () => void;
  /** fixed 배치용 좌표 — AddToPlaylistButton이 조상 overflow 클리핑을 피해 쓴다 */
  panelStyle?: React.CSSProperties;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [authed, setAuthed] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  /** 실패는 done과 따로 둔다 — done은 화면을 덮어버려 다시 시도할 길이 없어진다 */
  const [error, setError] = useState<string | null>(null);

  /** 언마운트 뒤 setState 방지 */
  const aliveRef = useRef(true);
  /**
   * 진행 중 여부를 ref로도 들고 있는다 — Enter 키 반복은 상태가 다시 그려지기 전에
   * 같은 핸들러를 여러 번 부를 수 있고, 그러면 이름이 같은 목록이 두 개 만들어진다
   * (서버에 이름 중복 검사가 없다)
   */
  const busyRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/playlists");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { authenticated: boolean; playlists: Item[] };
        if (!aliveRef.current) return;
        setAuthed(j.authenticated);
        setItems(j.playlists);
      } catch {
        // 목록을 못 읽어도 팝오버는 살아 있다 — 새 목록을 만들어 담는 길이 남는다
        if (aliveRef.current) setItems([]);
      }
    })();
  }, []);

  /** 실제 담기 요청 — 빗장(busy)은 부른 쪽이 이미 걸었다고 가정한다 */
  const postSong = async (playlistId: number, label: string) => {
    try {
      const r = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId }),
      });
      const j = (await r.json()) as { ok?: boolean; already?: boolean; error?: string };
      if (!aliveRef.current) return;
      // r.ok를 먼저 본다 — 서버가 error만 돌려줄 때 j.already가 undefined라
      // 그대로 두면 실패를 "담았어요"로 알리게 된다
      if (!r.ok || !j.ok) {
        setError(j.error ?? "담지 못했어요");
        setBusyBoth(false);
        return;
      }
      if (onAdded) {
        // 피드백은 부모의 + 버튼(✓ 플래시)이 맡는다 — 문구 없이 바로 닫는다
        onAdded();
        onClose();
        return;
      }
      setDone(j.already ? `이미 «${label}»에 있어요` : `«${label}»에 담았어요`);
      closeTimer.current = setTimeout(onClose, 1200);
    } catch {
      if (!aliveRef.current) return;
      setError("담지 못했어요");
      setBusyBoth(false);
    }
  };

  const add = async (playlistId: number, label: string) => {
    if (busyRef.current) return;
    setBusyBoth(true);
    setError(null);
    await postSong(playlistId, label);
  };

  const createAndAdd = async () => {
    if (busyRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusyBoth(true);
    setError(null);
    try {
      const r = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = (await r.json()) as { playlist?: Item };
      if (!aliveRef.current) return;
      if (!j.playlist) {
        setError("목록을 만들지 못했어요");
        setBusyBoth(false);
        return;
      }
      // 담기가 실패해 다시 시도할 때 같은 이름의 목록이 또 만들어지면 안 된다 —
      // 만들어진 목록을 바로 위 목록에 넣고 입력칸을 비워, 재시도가 "이미 있는 목록에 담기"가 되게 한다
      const created = j.playlist;
      setItems((prev) => [created, ...(prev ?? [])]);
      setName("");
      // 빗장은 걸어 둔 채로 이어서 담는다 (풀었다 다시 걸면 그 틈에 또 눌릴 수 있다)
      await postSong(created.id, created.name);
    } catch {
      if (!aliveRef.current) return;
      setError("목록을 만들지 못했어요");
      setBusyBoth(false);
    }
  };

  return (
    <div data-nodrag className={panelClassName} style={panelStyle}>
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
          {/* 실패해도 목록과 입력칸을 남긴다 — 다시 누르면 그 자리에서 재시도된다 */}
          {error && <p className="mb-2 text-center text-xs text-rose-300">{error}</p>}
          {items && items.length > 0 && (
            <ul
              className="mb-2 max-h-40 overflow-y-auto overscroll-contain"
              style={{ touchAction: "pan-y" }}
            >
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
          {/* 담은 뒤 목록을 열어 보는 길 — 여기서 만든 목록을 재생·공유하려면 /lists로 가야 한다 */}
          <Link
            href="/lists"
            className="mt-2 block text-center text-xs text-white/45 underline transition hover:text-white"
          >
            내 노래 목록 관리
          </Link>
        </>
      )}
    </div>
  );
}
