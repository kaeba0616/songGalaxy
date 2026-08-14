"use client";

/**
 * 목록 상세 — 제목·재생 버튼·곡 목록을 한 컴포넌트가 같은 state로 갖는다.
 *
 * 처음엔 재생 버튼(`PlaylistPlayButton`)이 이 컴포넌트의 형제로, 서버가 내려준
 * `pl.songs`를 그대로 들고 있었다. 그러면 여기서 순서를 바꾸거나 곡을 빼도 그
 * 형제는 낡은 목록을 그대로 쥔 채라 "재생" 버튼이 옛 순서로 큐를 만들거나 이미
 * 뺀 곡을 태웠다. 재생 버튼을 이 안으로 들여 같은 `songs` state를 읽게 해서
 * 화면과 재생이 항상 같은 데이터를 보게 한다.
 *
 * 드래그 라이브러리를 쓰지 않는다: 이 저장소는 npm install이 멈춰 새 패키지를 들일 수
 * 없고(2026-08-11 실측), HTML5 draggable은 터치에서 아예 동작하지 않는다. 포인터
 * 이벤트는 마우스·터치·펜을 한 코드로 덮으므로 직접 구현하는 편이 낫다.
 *
 * 순서 계산은 하지 않는다 — `src/lib/reorder.ts`가 원본이다 (docs/SSOT.md).
 */
import Link from "next/link";
import LikeButton from "@/components/LikeButton";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import PlaylistPlayButton from "@/components/PlaylistPlayButton";
import { dropIndex, moveItem } from "@/lib/reorder";
import { usePlayer } from "@/player/player-context";
import type { PlaylistTrack } from "@/server/playlists";

/**
 * 서버 에러 메시지를 화면에 찍기 전 실제로 문자열인지 런타임에 확인한다.
 * `src/app/lists/PlaylistManager.tsx`의 같은 이름 헬퍼와 같은 이유 — 지금은 모든
 * 라우트가 문자열 리터럴만 주지만, 캐스팅만으로는 그걸 강제하지 못한다.
 */
function serverError(j: unknown, fallback: string): string {
  const msg = j && typeof j === "object" ? (j as Record<string, unknown>).error : undefined;
  return typeof msg === "string" ? msg : fallback;
}

/** 드래그 중인 행의 상태 — 어디서 잡았고 지금 어디까지 왔나 */
interface Drag {
  from: number;
  /** 잡은 순간의 포인터 Y (뷰포트 기준) */
  startY: number;
  /** 지금까지의 이동량 px */
  deltaY: number;
  /** 지금 놓으면 들어갈 자리 */
  to: number;
  /**
   * 잡는 순간(onPointerDown, 이벤트 핸들러)에 한 번만 잰 행 높이.
   * 렌더 중에 ref를 읽으면 안 된다 — 렌더는 순수해야 하고, eslint의
   * `react-hooks/refs`가 잡는 것도 그 이유다. 드래그하는 동안 행의 내용·높이는
   * 바뀌지 않으므로 시작할 때 굳혀 둬도 매 렌더 다시 재는 것과 결과가 같다.
   */
  rowHeight: number;
}

export default function PlaylistEditor({
  playlistId,
  name,
  songs: initial,
}: {
  playlistId: number;
  name: string;
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

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (busyRef.current || songs.length < 2) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setError(null);
    // 행 높이가 아니라 첫 두 행의 top 좌표 차이(행 간격/피치)를 잰다. divide-y는 첫 행을
    // 뺀 나머지 모든 행에 1px border-top을 붙이므로, 첫 행 자신의 offsetHeight로 재면
    // 실제 피치보다 1px 짧다. Math.round(dropIndex)가 그 오차를 한동안 삼키다가 행이
    // 30개쯤 쌓이면(오차가 반 행을 넘으면) 드래그가 한 칸씩 어긋난다. 손잡이는
    // songs.length > 1일 때만 그려지므로 이 시점엔 행이 최소 두 개 있다.
    const first = listRef.current?.children[0] as HTMLElement | undefined;
    const second = listRef.current?.children[1] as HTMLElement | undefined;
    const rowHeight =
      first && second ? second.getBoundingClientRect().top - first.getBoundingClientRect().top : 0;
    setDrag({ from: index, startY: e.clientY, deltaY: 0, to: index, rowHeight });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    setDrag((d) => {
      if (!d) return d;
      const deltaY = e.clientY - d.startY;
      return { ...d, deltaY, to: dropIndex(d.from, deltaY, d.rowHeight, songs.length) };
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
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setSongs(before);
        setError(serverError(j, "순서를 저장하지 못했어요"));
        return;
      }
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
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setSongs(before);
        setError(serverError(j, "곡을 빼지 못했어요"));
        return;
      }
      removeFromQueue(playlistId, songId);
      // 성공한 뒤에는 굳이 서버에서 다시 받아오지 않는다. 이 화면의 songs state가
      // 이미 정답이고(재생 버튼도 이 state를 쓴다), refresh를 걸면 늦게 도착한 RSC가
      // key를 바꿔 그 사이에 성공한 정렬을 옛 순서로 되돌려 보인다.
      // 낡은 화면을 되살리는 일은 409 경로의 refresh 한 곳만 맡는다
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
    const h = drag.rowHeight;
    if (index === drag.from) return drag.deltaY;
    if (drag.to > drag.from && index > drag.from && index <= drag.to) return -h;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return h;
    return 0;
  };

  return (
    <>
      <div className="mt-6 mb-5 flex items-center justify-between gap-4">
        <h1 className="min-w-0 truncate text-2xl font-semibold">{name}</h1>
        <PlaylistPlayButton id={playlistId} name={name} songs={songs} />
      </div>
      {error && (
        <p role="alert" className="mb-2 text-center text-xs text-rose-300">
          {error}
        </p>
      )}
      <ul ref={listRef} className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
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
            <Link replace href={`/songs/${s.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm">{s.title}</span>
              <span className="block truncate text-xs text-white/45">{s.artist}</span>
            </Link>
            {!s.youtubeVideoId && (
              <span
                className="shrink-0 text-xs text-white/30"
                title="영상을 아직 찾지 못해 30초 미리듣기로 재생됩니다"
              >
                미리듣기
              </span>
            )}
            <LikeButton songId={s.id} />
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
