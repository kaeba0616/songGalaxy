import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DataCredits from "@/components/DataCredits";
import PlaylistPlayButton from "@/components/PlaylistPlayButton";
import { getPlaylistBySlug } from "@/server/playlists";

export const dynamic = "force-dynamic";

/**
 * slug를 아는 사람에게만 보이라고 만든 링크다 — 색인되면 "아는 사람만"이 무너지고,
 * 크롤러가 목록의 곡 상세를 줄줄이 따라 들어가며 외부 API 호출까지 태운다.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * 공유 링크 열람 — slug를 아는 누구나 볼 수 있다(로그인 불필요).
 * 소유자 확인을 하지 않는 대신 편집 UI가 전혀 없다.
 * getPlaylistBySlug는 shareSlug 컬럼이 NULL인 행과는 절대 매치되지 않으므로
 * (share_slug = slug 조건, NULL은 어떤 비교에도 참이 되지 않는다) 공유를 끈 목록은
 * 이 경로로 영영 닿지 않는다 — 별도의 "공유됐는지" 검사가 필요 없다.
 */
export default async function SharedListPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const pl = await getPlaylistBySlug(slug);
  if (!pl) notFound();

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/50 transition hover:text-white">
          ← 은하로 돌아가기
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
            </li>
          ))}
        </ul>
        <DataCredits />
      </div>
    </main>
  );
}
