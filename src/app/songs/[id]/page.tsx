import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSessionUser } from "@/auth";
import DataCredits from "@/components/DataCredits";
import LikeButton from "@/components/LikeButton";
import { enrichSongs } from "@/server/enrich";
import { getArtistInfo } from "@/server/artist-info";
import { getLyrics } from "@/server/lyrics";

export const dynamic = "force-dynamic";

/**
 * 곡 상세 페이지 — 메타데이터 + 가수 정보(MusicBrainz) + YouTube 재생 + 가사(LRCLIB).
 *
 * YouTube 영상은 **이미 캐시된 ID가 있을 때만** 임베드한다. 여기서 `getYoutubeVideoId`를
 * 부르면 안 된다: 이 페이지는 force-dynamic이고 공개(공유 목록에서 곡마다 링크된다)라
 * 크롤러가 링크를 따라오는 것만으로 하루 100회 검색 쿼터가 통째로 마른다.
 * 영상 ID를 새로 찾는 곳은 목록에 담을 때와 소유자가 목록을 열 때뿐이다 (docs/SSOT.md).
 */
export default async function SongDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const songId = Number(id);
  if (!Number.isInteger(songId)) notFound();

  const [song] = await db.select().from(schema.songs).where(eq(schema.songs.id, songId));
  if (!song) notFound();

  const [subTheme] = song.themeId
    ? await db.select().from(schema.themes).where(eq(schema.themes.id, song.themeId))
    : [undefined];
  const [cluster] = subTheme?.parentId
    ? await db.select().from(schema.themes).where(eq(schema.themes.id, subTheme.parentId))
    : [undefined];

  const user = await getSessionUser();
  const videoId = song.youtubeVideoId; // 캐시된 것만 — 새로 찾지 않는다 (위 주석)
  const [media, artist, lyrics, [likeCount], myLike] = await Promise.all([
    enrichSongs([songId]).then((m) => m[songId]),
    getArtistInfo(song.artist, song.genre),
    getLyrics(songId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.likes)
      .where(eq(schema.likes.songId, songId)),
    user
      ? db
          .select({ songId: schema.likes.songId })
          .from(schema.likes)
          .where(and(eq(schema.likes.userId, user.id), eq(schema.likes.songId, songId)))
      : Promise.resolve([]),
  ]);

  const artistLine = [
    artist.type === "Group" ? "그룹" : artist.type === "Person" ? "솔로" : artist.type,
    artist.country,
    artist.beginYear && `${artist.beginYear}~`,
    artist.tags?.slice(0, 4).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  const youtubeQuery = encodeURIComponent(`${song.title} ${song.artist}`);
  const themeColor = subTheme?.color ?? "#8899ff";

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="text-sm text-white/50 transition hover:text-white">
            ← 은하로 돌아가기
          </Link>
          <Link
            href={`/?song=${song.id}`}
            className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm backdrop-blur transition hover:bg-white/20"
          >
            ✦ 은하에서 보기
          </Link>
        </div>

        {/* 곡 헤더 */}
        <div className="flex gap-5">
          <div className="h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            {media?.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지
              <img src={media.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-4xl" style={{ color: themeColor }}>
                ✦
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-2xl font-semibold">{song.title}</h1>
              <LikeButton
                songId={song.id}
                initialLiked={myLike.length > 0}
                authenticated={user != null}
                size="lg"
              />
              {likeCount.n > 0 && (
                <span className="shrink-0 text-sm text-pink-200/70">{likeCount.n}명이 좋아요</span>
              )}
            </div>
            <p className="mt-1 truncate text-lg text-white/70">{song.artist}</p>
            {artistLine && <p className="mt-1 truncate text-sm text-white/40">{artistLine}</p>}
            <p className="mt-3 text-sm text-white/50">
              {cluster && (
                <span
                  className="mr-2 rounded-full border border-white/15 px-2.5 py-0.5"
                  style={{ color: cluster.color ?? undefined }}
                >
                  {cluster.name}
                </span>
              )}
              <span className="mr-2 rounded-full border border-white/15 px-2.5 py-0.5" style={{ color: themeColor }}>
                {song.genre}
              </span>
              {song.album && <span className="text-white/35">{song.album}</span>}
            </p>
          </div>
        </div>

        {/* YouTube 재생 — 영상 ID가 캐시되어 있으면 임베드, 없으면 검색 링크 폴백 */}
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-medium text-white/60">영상으로 듣기</h2>
          {videoId ? (
            <div className="aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black">
              <iframe
                className="h-full w-full"
                src={`https://www.youtube.com/embed/${videoId}`}
                title={`${song.title} - ${song.artist}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <a
              href={`https://www.youtube.com/results?search_query=${youtubeQuery}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/10"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-red-600/90 text-sm">▶</span>
              <span>
                <span className="block text-sm">YouTube에서 &ldquo;{song.title} {song.artist}&rdquo; 검색하기</span>
                <span className="block text-xs text-white/40">
                  이 곡을 노래 목록에 담으면 영상을 찾아 다음부터 이 자리에서 바로 재생됩니다
                </span>
              </span>
            </a>
          )}
        </section>

        {/* 가사 (LRCLIB) */}
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-medium text-white/60">가사</h2>
          {lyrics.plain ? (
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/5 p-5 font-sans text-sm leading-7 text-white/80">
              {lyrics.plain}
            </pre>
          ) : (
            <p className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/40">
              가사를 찾지 못했습니다.
            </p>
          )}
          {lyrics.plain && (
            <p className="mt-1.5 text-xs text-white/30">
              커뮤니티 기여 데이터입니다 — 출처는 아래 참조
            </p>
          )}
        </section>

        <DataCredits />
      </div>
    </main>
  );
}
