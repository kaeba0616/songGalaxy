import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSessionUser } from "@/auth";
import BackToGalaxyLink from "@/components/BackToGalaxyLink";
import DataCredits from "@/components/DataCredits";
import LikeButton from "@/components/LikeButton";
import { enrichSongs } from "@/server/enrich";
import { getArtistInfo } from "@/server/artist-info";
import { getLyrics } from "@/server/lyrics";
import { getYoutubeVideoId } from "@/server/youtube";

export const dynamic = "force-dynamic";

/**
 * 곡 상세 페이지 — 메타데이터 + 가수 정보(MusicBrainz) + YouTube 재생 + 가사(LRCLIB).
 *
 * YouTube 영상 ID는 캐시가 있으면 그걸 쓰고, 없으면 **로그인한 사람이 연 경우에만** 찾는다.
 *
 * 이 페이지는 force-dynamic이고 공개다(공유 목록이 곡마다 여기로 링크한다). 그래서
 * 누구에게나 찾아주면 크롤러가 링크를 훑는 것만으로 하루 100회 검색 쿼터가 통째로 마른다 —
 * 한때 그 이유로 조회를 아예 뺐었지만, 그러면 목록에 담기 전까지 영상이 안 뜬다.
 * 로그인 조건이 둘을 모두 만족시킨다: 크롤러는 로그인하지 않고, 로그인한 사람도
 * `YOUTUBE_LOOKUPS_PER_USER_PER_DAY`에 막혀 서비스 전체 쿼터를 말릴 수 없다 (docs/SSOT.md).
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
  const [media, artist, lyrics, videoId, [likeCount], myLike] = await Promise.all([
    enrichSongs([songId]).then((m) => m[songId]),
    getArtistInfo(song.artist, song.genre),
    getLyrics(songId),
    // 캐시가 있으면 그걸 쓰고, 없으면 로그인한 사람이 연 경우에만 찾는다.
    // 크롤러는 로그인하지 않으므로 공개 링크를 훑는 것만으로는 쿼터가 새지 않고,
    // 로그인한 사람도 YOUTUBE_LOOKUPS_PER_USER_PER_DAY에 막혀 서비스 전체를 말릴 수 없다.
    song.youtubeVideoId ?? (user ? getYoutubeVideoId(songId, user.id) : null),
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
          <BackToGalaxyLink className="text-sm text-white/50 transition hover:text-white" />
          {/* ml-auto: 겹쳐 띄운 화면에서는 왼쪽의 "은하로 돌아가기"가 사라지는데,
              justify-between은 자식이 하나면 왼쪽에 붙이므로 이 버튼이 반대편으로 튄다 */}
          <Link
            href={`/?song=${song.id}`}
            className="ml-auto rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm backdrop-blur transition hover:bg-white/20"
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
