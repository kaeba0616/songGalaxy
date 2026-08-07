import Link from "next/link";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { GENRE_CLUSTERS } from "@/config/genre-clusters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

interface SongsSearchParams {
  q?: string;
  cluster?: string;
  genre?: string;
  sort?: string;
  page?: string;
}

/** 곡 목록 브라우저 — 검색·성단/장르 필터·정렬·페이지네이션 (이슈 #6) */
export default async function SongsPage(props: { searchParams: Promise<SongsSearchParams> }) {
  const params = await props.searchParams;
  const q = params.q?.trim() ?? "";
  const cluster = GENRE_CLUSTERS.find((c) => c.slug === params.cluster);
  const genre = cluster?.genres.includes(params.genre ?? "") ? params.genre : undefined;
  const sort = params.sort === "title" ? "title" : "popularity";
  const page = Math.max(1, Number(params.page) || 1);

  const conditions: SQL[] = [];
  if (q) {
    conditions.push(
      or(ilike(schema.songs.title, `%${q}%`), ilike(schema.songs.artist, `%${q}%`))!,
    );
  }
  if (genre) {
    conditions.push(eq(schema.songs.genre, genre));
  } else if (cluster) {
    conditions.push(inArray(schema.songs.genre, cluster.genres));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.songs.id,
        title: schema.songs.title,
        artist: schema.songs.artist,
        genre: schema.songs.genre,
        popularity: schema.songs.popularity,
        artworkUrl: schema.songs.artworkUrl,
      })
      .from(schema.songs)
      .where(where)
      .orderBy(sort === "title" ? asc(schema.songs.title) : desc(schema.songs.popularity))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.songs)
      .where(where),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** 현재 필터를 유지한 채 일부 파라미터만 바꾼 URL */
  const pageUrl = (overrides: Partial<SongsSearchParams>) => {
    const merged = { q, cluster: cluster?.slug, genre, sort, page: String(page), ...overrides };
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) sp.set(key, String(value));
    }
    return `/songs?${sp.toString()}`;
  };

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">곡 목록</h1>
          <Link href="/" className="text-sm text-white/50 transition hover:text-white">
            ✦ 은하로 돌아가기
          </Link>
        </div>

        {/* 검색 + 필터 (GET 폼 — 새로고침/공유 가능한 URL) */}
        <form className="mb-5 flex flex-wrap gap-2" action="/songs" method="GET">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="곡 제목이나 가수 검색"
            className="min-w-48 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
          />
          <select
            name="cluster"
            defaultValue={cluster?.slug ?? ""}
            className="rounded-full border border-white/15 bg-[#0d0f1e] px-3 py-2 text-sm"
          >
            <option value="">모든 성단</option>
            {GENRE_CLUSTERS.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-full border border-white/15 bg-[#0d0f1e] px-3 py-2 text-sm"
          >
            <option value="popularity">인기순</option>
            <option value="title">제목순</option>
          </select>
          <button
            type="submit"
            className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20"
          >
            검색
          </button>
        </form>

        {/* 성단 선택 시 세부 장르 칩 */}
        {cluster && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            <Link
              href={pageUrl({ genre: undefined, page: "1" })}
              className={`rounded-full border px-3 py-1 text-xs transition ${!genre ? "border-white/50 bg-white/15" : "border-white/15 text-white/60 hover:bg-white/10"}`}
            >
              전체
            </Link>
            {cluster.genres.map((g) => (
              <Link
                key={g}
                href={pageUrl({ genre: g, page: "1" })}
                className={`rounded-full border px-3 py-1 text-xs transition ${genre === g ? "border-white/50 bg-white/15" : "border-white/15 text-white/60 hover:bg-white/10"}`}
                style={{ color: genre === g ? cluster.color : undefined }}
              >
                {g}
              </Link>
            ))}
          </div>
        )}

        <p className="mb-3 text-xs text-white/40">{total.toLocaleString()}곡</p>

        {/* 곡 목록 */}
        <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {rows.map((song) => (
            <li key={song.id}>
              <Link
                href={`/songs/${song.id}`}
                className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/5"
              >
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
                <span className="w-10 shrink-0 text-right text-xs text-white/40">{song.popularity}</span>
              </Link>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-white/40">검색 결과가 없습니다</li>
          )}
        </ul>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <Link href={pageUrl({ page: String(page - 1) })} className="rounded-full border border-white/20 px-4 py-1.5 transition hover:bg-white/10">
                ← 이전
              </Link>
            ) : (
              <span className="rounded-full border border-white/10 px-4 py-1.5 text-white/25">← 이전</span>
            )}
            <span className="text-white/50">
              {page} / {totalPages.toLocaleString()}
            </span>
            {page < totalPages ? (
              <Link href={pageUrl({ page: String(page + 1) })} className="rounded-full border border-white/20 px-4 py-1.5 transition hover:bg-white/10">
                다음 →
              </Link>
            ) : (
              <span className="rounded-full border border-white/10 px-4 py-1.5 text-white/25">다음 →</span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
