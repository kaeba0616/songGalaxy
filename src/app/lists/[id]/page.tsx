import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/auth";
import DataCredits from "@/components/DataCredits";
import PlaylistPlayButton from "@/components/PlaylistPlayButton";
import { getPlaylistById } from "@/server/playlists";

export const dynamic = "force-dynamic";

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
  const pl = await getPlaylistById(id);
  if (!pl || !user || pl.ownerId !== user.id) notFound();

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/lists" className="text-sm text-white/50 transition hover:text-white">
          ← 내 목록
        </Link>
        <div className="mt-6 mb-5 flex items-center justify-between gap-4">
          <h1 className="min-w-0 truncate text-2xl font-semibold">{pl.name}</h1>
          <PlaylistPlayButton name={pl.name} songs={pl.songs} />
        </div>
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
          {pl.songs.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 shrink-0 text-xs text-white/30">{i + 1}</span>
              <Link href={`/songs/${s.id}`} className="min-w-0 flex-1">
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
            </li>
          ))}
          {pl.songs.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-white/40">
              아직 담은 곡이 없어요 — 곡을 들으면서 알약의 + 를 눌러보세요
            </li>
          )}
        </ul>
        <DataCredits />
      </div>
    </main>
  );
}
