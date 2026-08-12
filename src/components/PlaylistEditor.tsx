"use client";

/**
 * 목록 상세의 곡 목록 — 드래그로 재생 순서 바꾸기 + 곡 빼기.
 *
 * 드래그 라이브러리를 쓰지 않는다: 이 저장소는 npm install이 멈춰 새 패키지를 들일 수
 * 없고(2026-08-11 실측), HTML5 draggable은 터치에서 아예 동작하지 않는다. 포인터
 * 이벤트는 마우스·터치·펜을 한 코드로 덮으므로 직접 구현하는 편이 낫다.
 *
 * 순서 계산은 하지 않는다 — `src/lib/reorder.ts`가 원본이다 (docs/SSOT.md).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { dropIndex, moveItem } from "@/lib/reorder";
import { usePlayer } from "@/player/player-context";
import type { PlaylistTrack } from "@/server/playlists";

/** 드래그 중인 행의 상태 — 어디서 잡았고 지금 어디까지 왔나 */
interface Drag {
  from: number;
  /** 잡은 순간의 포인터 Y (뷰포트 기준) */
  startY: number;
  /** 지금까지의 이동량 px */
  deltaY: number;
  /** 지금 놓으면 들어갈 자리 */
  to: number;
}

export default function PlaylistEditor({
  playlistId,
  songs: initial,
}: {
  playlistId: number;
  songs: PlaylistTrack[];
}) {
  const router = useRouter();
  const { reorderQueue, removeFromQueue } = usePlayer();
  const [songs, setSongs] = useState(initial);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** 요청이 겹치지 않게 — 저장 중에는 새 드래그를 받지 않는다 */
  const busyRef = useRef(false);

  /** 행 높이를 그때그때 잰다 — 글꼴·화면 폭에 따라 달라진다 */
  const rowHeight = (): number =>
    (listRef.current?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (busyRef.current || songs.length < 2) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setError(null);
    setDrag({ from: index, startY: e.clientY, deltaY: 0, to: index });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    setDrag((d) => {
      if (!d) return d;
      const deltaY = e.clientY - d.startY;
      return { ...d, deltaY, to: dropIndex(d.from, deltaY, rowHeight(), songs.length) };
    });
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    // 캡처 해제를 제자리 놓기 검사보다 먼저 한다 — 뒤에 두면 제자리에 놓았을 때
    // 캡처가 걸린 채 남아 다음 드래그가 시작되지 않는다
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d.to === d.from) return;

    const before = songs;
    const next = moveItem(songs, d.from, d.to);
    setSongs(next); // 낙관적 — 손을 떼는 즉시 새 순서로 보인다
    busyRef.current = true;
    try {
      const r = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songIds: next.map((s) => s.id) }),
      });
      if (r.status === 409) {
        setSongs(before);
        setError("목록이 바뀌었어요 — 새로 불러옵니다");
        router.refresh();
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // 지금 이 목록을 듣고 있으면 큐 순서도 맞춘다 (재생은 끊기지 않는다)
      reorderQueue(playlistId, next.map((s) => s.id));
    } catch {
      setSongs(before);
      setError("순서를 저장하지 못했어요");
    } finally {
      busyRef.current = false;
    }
  };

  const remove = async (songId: number) => {
    if (busyRef.current) return;
    const before = songs;
    setSongs(before.filter((s) => s.id !== songId));
    setError(null);
    busyRef.current = true;
    try {
      const r = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      removeFromQueue(playlistId, songId);
    } catch {
      setSongs(before);
      setError("곡을 빼지 못했어요");
    } finally {
      busyRef.current = false;
    }
  };

  /**
   * 드래그 중 각 행을 얼마나 밀어 보여줄지.
   * 잡은 행은 손가락을 따라오고, 사이에 낀 행들은 한 칸씩 비켜선다.
   */
  const shift = (index: number): number => {
    if (!drag) return 0;
    const h = rowHeight();
    if (index === drag.from) return drag.deltaY;
    if (drag.to > drag.from && index > drag.from && index <= drag.to) return -h;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return h;
    return 0;
  };

  return (
    <>
      {error && <p className="mb-2 text-center text-xs text-rose-300">{error}</p>}
      <ul ref={listRef} className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
        {/* eslint-disable-next-line react-hooks/refs -- shift()가 렌더 중에 listRef를 읽어 드래그 중인
            행의 위치를 계산한다. 측정값은 DOM에 이미 반영된 실제 행 높이이고 드래그 상태(state)가
            바뀔 때만 다시 그려지므로 다음 렌더에서 값이 안정된다 — 여기서 값을 만들어내지 않는다 */}
        {songs.map((s, i) => (
          <li
            key={s.id}
            style={{
              transform: `translateY(${shift(i)}px)`,
              // 잡은 행만 손가락을 즉시 따라오게 하고, 비켜서는 행은 부드럽게
              transition: drag?.from === i ? "none" : "transform 150ms ease-out",
              zIndex: drag?.from === i ? 1 : undefined,
              position: "relative",
            }}
            className={`flex items-center gap-3 px-4 py-3 ${
              drag?.from === i ? "bg-white/10 shadow-lg" : ""
            }`}
          >
            {songs.length > 1 && (
              <button
                type="button"
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => void onPointerUp(e)}
                onPointerCancel={() => setDrag(null)}
                aria-label={`${s.title} 순서 바꾸기 — 끌어서 옮기세요`}
                title="끌어서 순서 바꾸기"
                /* touch-none: 없으면 브라우저가 세로 스크롤로 가로채 드래그가 시작되지 않는다 */
                className="shrink-0 cursor-grab touch-none px-1 text-white/30 transition hover:text-white/70 active:cursor-grabbing"
              >
                ⠿
              </button>
            )}
            <span className="w-6 shrink-0 text-xs text-white/30">{i + 1}</span>
            <a href={`/songs/${s.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm">{s.title}</span>
              <span className="block truncate text-xs text-white/45">{s.artist}</span>
            </a>
            {!s.youtubeVideoId && (
              <span
                className="shrink-0 text-xs text-white/30"
                title="영상을 아직 찾지 못해 30초 미리듣기로 재생됩니다"
              >
                미리듣기
              </span>
            )}
            <button
              type="button"
              onClick={() => void remove(s.id)}
              aria-label={`${s.title} 목록에서 빼기`}
              title="목록에서 빼기"
              className="shrink-0 cursor-pointer rounded-full px-2 py-1 text-sm text-white/30 transition hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </li>
        ))}
        {songs.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-white/40">
            아직 담은 곡이 없어요 — 곡을 들으면서 알약의 + 를 눌러보세요
          </li>
        )}
      </ul>
    </>
  );
}
