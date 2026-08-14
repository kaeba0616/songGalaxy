import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { getSessionUser } from "@/auth";
import { MIN_LIKES_FOR_STAR } from "@/config/constants";
import { GENRE_CLUSTERS } from "@/config/genre-clusters";
import { DEFAULT_PLANET_THEME } from "@/config/planet-themes";
import BackToGalaxyLink from "@/components/BackToGalaxyLink";
import DataCredits from "@/components/DataCredits";
import LikeButton from "@/components/LikeButton";
import PlanetThemePicker from "./PlanetThemePicker";

export const dynamic = "force-dynamic";

const CLUSTER_LABEL = new Map(GENRE_CLUSTERS.map((c) => [c.slug, { label: c.label, color: c.color }]));

/** 내 취향 페이지 (이슈 #6) — 좋아요 목록, 내 별 상태, 성단 분포 */
export default async function MePage() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#05060f] text-white">
        <div className="text-center">
          <p className="mb-4 text-white/70">내 취향 페이지는 로그인 후 볼 수 있어요</p>
          <a
            href="/api/auth/signin?callbackUrl=/me"
            className="rounded-full border border-white/25 bg-white/15 px-5 py-2 text-sm transition hover:bg-white/25"
          >
            Google 로그인
          </a>
        </div>
      </main>
    );
  }

  const [likedSongs, [star], clusterDist, [me]] = await Promise.all([
    db
      .select({
        id: schema.songs.id,
        title: schema.songs.title,
        artist: schema.songs.artist,
        genre: schema.songs.genre,
        artworkUrl: schema.songs.artworkUrl,
        likedAt: schema.likes.createdAt,
      })
      .from(schema.likes)
      .innerJoin(schema.songs, eq(schema.likes.songId, schema.songs.id))
      .where(eq(schema.likes.userId, user.id))
      .orderBy(desc(schema.likes.createdAt)),
    db.select().from(schema.userStars).where(eq(schema.userStars.userId, user.id)),
    (() => {
      const sub = alias(schema.themes, "sub");
      const big = alias(schema.themes, "big");
      return db
        .select({
          cluster: big.name,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.likes)
        .innerJoin(schema.songs, eq(schema.likes.songId, schema.songs.id))
        .innerJoin(sub, eq(sub.id, schema.songs.themeId))
        .innerJoin(big, eq(big.id, sub.parentId))
        .where(eq(schema.likes.userId, user.id))
        .groupBy(big.name)
        .orderBy(sql`count(*) desc`);
    })(),
    db
      .select({ planetTheme: schema.users.planetTheme })
      .from(schema.users)
      .where(eq(schema.users.id, user.id)),
  ]);
  const currentTheme = me?.planetTheme ?? DEFAULT_PLANET_THEME;

  const total = likedSongs.length;

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">✦ {user.nickname}의 취향</h1>
          <BackToGalaxyLink className="text-sm text-white/50 transition hover:text-white">
            은하로 돌아가기
          </BackToGalaxyLink>
        </div>

        {/* 내 별 상태 */}
        <section className="mb-8 rounded-2xl border border-amber-200/20 bg-amber-100/5 p-5">
          {star ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-amber-100/90">
                내 별이 은하에 떠 있어요 — 좋아요 {total}곡의 취향 중심점에서 빛나는 중
              </p>
              <Link
                href="/?star=me"
                className="rounded-full border border-amber-200/40 bg-amber-100/10 px-4 py-1.5 text-sm text-amber-100 transition hover:bg-amber-100/20"
              >
                은하에서 내 별 보기 →
              </Link>
            </div>
          ) : (
            <p className="text-sm text-amber-100/80">
              별까지 {MIN_LIKES_FOR_STAR - total}곡 남았어요 — 좋아요 {MIN_LIKES_FOR_STAR}곡이 모이면
              취향의 중심에 내 별이 태어납니다
            </p>
          )}
        </section>

        {/* 행성 테마 (이슈 #10 꾸미기 맛보기) */}
        {star && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-white/60">
              내 행성 테마 <span className="text-white/35">— 방문자에게도 이 색으로 보여요</span>
            </h2>
            <PlanetThemePicker current={currentTheme} />
          </section>
        )}

        {/* 꾸미기 칩은 뺐다 — 달은 이제 켜고 끄는 것이 아니라 밤하늘의 기본값이고,
            나머지 오브젝트는 카탈로그(config/planet-decor.ts)에서 빠져 있다. 저장된 행은
            지우지 않았으므로 카탈로그에 다시 넣으면 그대로 살아난다 */}

        {/* 성단 분포 */}
        {clusterDist.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-white/60">내 취향의 성단 분포</h2>
            <div className="flex flex-wrap gap-2">
              {clusterDist.map((d) => {
                const meta = CLUSTER_LABEL.get(d.cluster);
                return (
                  <span
                    key={d.cluster}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs"
                    style={{ color: meta?.color }}
                  >
                    {meta?.label ?? d.cluster} {d.n}곡
                  </span>
                );
              })}
            </div>
          </section>
        )}

        {/* 좋아요 목록 */}
        <section>
          <h2 className="mb-3 text-sm font-medium text-white/60">좋아요한 곡 {total}곡</h2>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
            {likedSongs.map((song) => (
              <li key={song.id} className="flex items-center gap-4 px-4 py-3">
                <Link replace href={`/songs/${song.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {song.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지
                      <img src={song.artworkUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-white/20">✦</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{song.title}</p>
                    <p className="truncate text-xs text-white/50">{song.artist}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">
                    {song.genre}
                  </span>
                </Link>
                <LikeButton songId={song.id} />
              </li>
            ))}
            {total === 0 && (
              <li className="px-4 py-10 text-center text-sm text-white/40">
                아직 좋아요한 곡이 없어요 —{" "}
                <Link href="/songs" className="underline">
                  곡을 찾아보세요
                </Link>
              </li>
            )}
          </ul>
        </section>

        <DataCredits />
      </div>
    </main>
  );
}
