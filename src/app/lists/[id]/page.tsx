import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/auth";
import DataCredits from "@/components/DataCredits";
import PlaylistEditor from "@/components/PlaylistEditor";
import PlaylistPlayButton from "@/components/PlaylistPlayButton";
import { getPlaylistById, retryMissingVideos } from "@/server/playlists";

export const dynamic = "force-dynamic";

/** 남의 눈에 띌 이유가 없는 개인 화면이다 — 검색엔진에 올리지 않는다 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * getPlaylistById는 user id를 받지 않고 소유권도 검사하지 않는다 — 남의(비공개)
 * 목록이라도 id만 알면 내용을 그대로 돌려준다. 그래서 소유권 확인은 여기서
 * 반드시 해야 한다: 로그인 안 함 / 존재하지 않음 / 내 목록이 아님 모두 404로 통일해
 * "이 id의 목록이 있는지 없는지"조차 남에게 새지 않게 한다.
 */
export default async function PlaylistDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) notFound();
  const user = await getSessionUser();
  const found0 = await getPlaylistById(id);
  if (!found0 || !user || found0.ownerId !== user.id) notFound();

  // 담을 때 쿼터가 말라 영상을 못 찾은 곡을 여기서 몇 개만 보충 조회한다.
  // 소유자 화면에서만 — 공유 열람 화면에 걸면 크롤러 한 번에 하루 쿼터가 날아간다
  const refilled = await retryMissingVideos(user.id, id);
  const pl = refilled > 0 ? ((await getPlaylistById(id)) ?? found0) : found0;

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/lists" className="text-sm text-white/50 transition hover:text-white">
          ← 내 목록
        </Link>
        <div className="mt-6 mb-5 flex items-center justify-between gap-4">
          <h1 className="min-w-0 truncate text-2xl font-semibold">{pl.name}</h1>
          <PlaylistPlayButton id={pl.id} name={pl.name} songs={pl.songs} />
        </div>
        <PlaylistEditor playlistId={pl.id} songs={pl.songs} />
        <DataCredits />
      </div>
    </main>
  );
}
