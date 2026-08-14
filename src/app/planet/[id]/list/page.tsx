import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import BackToGalaxyLink from "@/components/BackToGalaxyLink";
import DataCredits from "@/components/DataCredits";
import LikeButton from "@/components/LikeButton";
import ImportSkyButton from "./ImportSkyButton";

export const dynamic = "force-dynamic";

/** 행성 주인의 취향 목록 — 공개 화면이지만 검색엔진에 올릴 이유는 없다 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * 행성 플리 열람 — 그 행성 밤하늘의 곡들(주인의 좋아요, 최근순)을 목록으로 본다.
 * 행성에 착륙하면 누구나 듣는 목록이므로 이 화면도 공개다 (D15와 같은 방침).
 * 내 계정으로 가져오기는 이 화면의 버튼이 담당한다 — 보기와 가져오기를 분리.
 */
export default async function PlanetListPage(props: { params: Promise<{ id: string }> }) {
  const userId = Number((await props.params).id);
  if (!Number.isInteger(userId)) notFound();

  const [[owner], rows] = await Promise.all([
    db
      .select({ nickname: schema.users.nickname })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
    db
      .select({
        id: schema.songs.id,
        title: schema.songs.title,
        artist: schema.songs.artist,
        artworkUrl: schema.songs.artworkUrl,
      })
      .from(schema.likes)
      .innerJoin(schema.songs, eq(schema.likes.songId, schema.songs.id))
      .where(eq(schema.likes.userId, userId))
      .orderBy(desc(schema.likes.createdAt)),
  ]);
  if (!owner) notFound();

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-end">
          <BackToGalaxyLink className="text-sm text-white/50 transition hover:text-white" />
        </div>
        <div className="mb-5 mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">✦ {owner.nickname}의 밤하늘</h1>
            <p className="mt-1 text-sm text-white/45">{rows.length}곡 · 최근 좋아요 순</p>
          </div>
          {rows.length > 0 && <ImportSkyButton fromUserId={userId} />}
        </div>

        <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {rows.map((song, i) => (
            <li key={song.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/5">
              <span className="w-6 shrink-0 text-right text-xs text-white/30">{i + 1}</span>
              <Link replace href={`/songs/${song.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {song.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지
                    <img src={song.artworkUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-white/20">✦</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{song.title}</p>
                  <p className="truncate text-xs text-white/50">{song.artist}</p>
                </div>
              </Link>
              <LikeButton songId={song.id} />
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-white/40">
              아직 좋아요한 곡이 없어요
            </li>
          )}
        </ul>
        <DataCredits />
      </div>
    </main>
  );
}
