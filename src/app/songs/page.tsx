import Link from "next/link";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { GENRE_CLUSTERS } from "@/config/genre-clusters";
import { searchExternal } from "@/server/import-song";
import { importSongAction } from "./actions";
import ImportButton from "./ImportButton";
import SongFilters from "./SongFilters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

interface SongsSearchParams {
  q?: string;
  /** 검색 대상 — 비우면 제목+가수 모두 */
  field?: string;
  cluster?: string;
  genre?: string;
  sort?: string;
  page?: string;
  /** 방금 "은하에 추가"로 편입한 곡 id — 그 곡 버튼을 "추가했어요"로 표시 */
  added?: string;
  /** 편입 실패 안내 (외부 API 오류·스토어에 없는 곡) */
  importError?: string;
}

/** 곡 목록 브라우저 — 검색·성단/장르 필터·정렬·페이지네이션 (이슈 #6) */
export default async function SongsPage(props: { searchParams: Promise<SongsSearchParams> }) {
  const params = await props.searchParams;
  const q = params.q?.trim() ?? "";
  const cluster = GENRE_CLUSTERS.find((c) => c.slug === params.cluster);
  const genre = cluster?.genres.includes(params.genre ?? "") ? params.genre : undefined;
  const sort =
    params.sort === "title" ? "title" : params.sort === "recent" ? "recent" : "popularity";
  const field = params.field === "title" || params.field === "artist" ? params.field : "";
  const page = Math.max(1, Number(params.page) || 1);

  const conditions: SQL[] = [];
  if (q) {
    // 검색 대상 필터 — 제목만/가수만/전체(제목+가수)
    if (field === "title") {
      conditions.push(ilike(schema.songs.title, `%${q}%`));
    } else if (field === "artist") {
      conditions.push(ilike(schema.songs.artist, `%${q}%`));
    } else {
      conditions.push(
        or(ilike(schema.songs.title, `%${q}%`), ilike(schema.songs.artist, `%${q}%`))!,
      );
    }
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
      .orderBy(
        // 검색 시 정확 일치 > 접두 일치 > 부분 일치 순으로 먼저 — "ado" 검색이면
        // 가수 Ado가 Nelly Furtado보다 위에 온다. 그 안에서 선택한 정렬 적용.
        ...(q
          ? (() => {
              const exact = q.toLowerCase();
              const prefix = `${exact}%`;
              if (field === "artist") {
                return [
                  sql`(lower(${schema.songs.artist}) = ${exact}) DESC`,
                  sql`(lower(${schema.songs.artist}) LIKE ${prefix}) DESC`,
                ];
              }
              if (field === "title") {
                return [
                  sql`(lower(${schema.songs.title}) = ${exact}) DESC`,
                  sql`(lower(${schema.songs.title}) LIKE ${prefix}) DESC`,
                ];
              }
              return [
                sql`(lower(${schema.songs.title}) = ${exact} OR lower(${schema.songs.artist}) = ${exact}) DESC`,
                sql`(lower(${schema.songs.title}) LIKE ${prefix} OR lower(${schema.songs.artist}) LIKE ${prefix}) DESC`,
              ];
            })()
          : []),
        ...(sort === "title"
          ? [asc(schema.songs.title)]
          : sort === "recent"
            ? // 최신순 = 발매연도 내림차순 (연도 없는 곡은 뒤로), 같은 해면 인기순
              [sql`${schema.songs.releaseYear} DESC NULLS LAST`, desc(schema.songs.popularity)]
            : [desc(schema.songs.popularity)]),
      )
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.songs)
      .where(where),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 검색어가 있으면 은하 밖(iTunes)에서도 후보를 찾는다 — 신인·최신곡 즉석 편입 경로
  // 이미 은하에 있는 곡은 목록에서 뺀다 (방금 추가한 곡만 "추가했어요" 표시용으로 남김)
  const external = (q && page === 1 ? await searchExternal(q) : []).filter(
    (ext) => !ext.existingSongId || String(ext.existingSongId) === params.added,
  );

  /** 현재 필터를 유지한 채 일부 파라미터만 바꾼 URL */
  const pageUrl = (overrides: Partial<SongsSearchParams>) => {
    const merged = { q, field, cluster: cluster?.slug, genre, sort, page: String(page), ...overrides };
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

        {/* 검색 + 필터 — URL에 조건이 남는 건 그대로, 이동만 클라이언트로.
            일반 GET 폼이면 문서를 새로 열어 듣던 노래가 꺼진다 */}
        <SongFilters
          current={{ q, field, cluster: cluster?.slug ?? "", genre, sort }}
          clusters={GENRE_CLUSTERS.map((c) => ({ slug: c.slug, label: c.label }))}
        />

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
              </Link>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-white/40">검색 결과가 없습니다</li>
          )}
        </ul>

        {/* 은하 밖에서 검색 — iTunes 결과를 새 별로 편입 (신인·최신곡 커버) */}
        {external.length > 0 && (
          <section className="mt-8" id="external">
            <h2 className="mb-1 text-sm font-medium text-white/70">은하 밖에서 검색</h2>
            <p className="mb-3 text-xs text-white/40">
              아직 은하에 없는 곡이면 추가해서 새 별로 태어나게 할 수 있어요
            </p>
            {params.importError && (
              <p className="mb-3 rounded-xl border border-red-300/30 bg-red-500/10 px-4 py-2 text-xs text-red-200">
                ⚠ 곡을 추가하지 못했어요. 잠시 후 다시 시도해주세요.
              </p>
            )}
            <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-dashed border-white/15 bg-white/[0.02]">
              {external.map((ext) => (
                <li key={ext.itunesId} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {ext.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지
                      <img src={ext.artworkUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-white/20">✦</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ext.title}</p>
                    <p className="truncate text-xs text-white/50">
                      {ext.artist}
                      {ext.releaseYear && <span className="ml-1.5 text-white/30">· {ext.releaseYear}</span>}
                      {ext.genre && <span className="ml-1.5 text-white/30">· {ext.genre}</span>}
                    </p>
                  </div>
                  {ext.existingSongId ? (
                    /* 필터 덕에 여기 오는 건 방금 추가한 곡뿐 — 한 번 더 누르면 상세로 */
                    <Link
                      href={`/songs/${ext.existingSongId}`}
                      className="added-pop shrink-0 rounded-full border border-amber-200/50 bg-amber-100/15 px-3.5 py-1.5 text-xs text-amber-100 transition hover:bg-amber-100/25"
                    >
                      ✓ 추가했어요 →
                    </Link>
                  ) : (
                    <form action={importSongAction}>
                      <input type="hidden" name="itunesId" value={ext.itunesId} />
                      {/* 현재 검색 상태 유지용 — 추가 후 같은 화면으로 복귀 */}
                      <input type="hidden" name="q" value={q} />
                      <input type="hidden" name="field" value={field} />
                      <input type="hidden" name="cluster" value={cluster?.slug ?? ""} />
                      <input type="hidden" name="genre" value={genre ?? ""} />
                      <input type="hidden" name="sort" value={sort} />
                      <ImportButton />
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

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
