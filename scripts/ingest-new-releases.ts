/**
 * 주간 신곡 적재 파이프라인 (이슈 #7)
 *
 * MusicBrainz API(CC0)에서 최근 발매된 공식 싱글을 가져와 은하에 편입한다.
 * 보수적 선별 기준 (무명곡 노이즈 방지):
 *   1) status:official 싱글 릴리즈 그룹만
 *   2) 장르 태그가 달린 것만 (커뮤니티가 태깅할 정도의 곡)
 *   3) 우리 장르 매핑에 성공한 것만 (실패 시 편입하지 않음 — pop 폴백 없음)
 *   4) 회당 상한 (--limit, 기본 60)
 *
 * 기존 행은 절대 수정하지 않는다 (좌표 불변). 롤백: batch_id로 해당 배치 삭제.
 * 멱등: (source='musicbrainz', source_id=릴리즈그룹 mbid) 유니크.
 * MusicBrainz 레이트리밋(초당 1회)을 준수한다.
 *
 * 실행: npm run ingest:new [-- --days=7 --limit=60]
 * 배포 후에는 Vercel Cron으로 주 1회 실행 예정.
 */
import net from "node:net";
import { and, eq, ilike } from "drizzle-orm";
import { db, schema } from "../src/db";
import { GENRE_TO_CLUSTER } from "../src/config/genre-clusters";
import { placeInGenre } from "../src/server/place-song";

// WSL + Node20 happy-eyeballs 버그 회피 (src/instrumentation.ts와 동일 이유)
net.setDefaultAutoSelectFamily(false);

const SOURCE = "musicbrainz";
const USER_AGENT = "songGalaxy/0.1 (https://github.com/kaeba0616/songGalaxy)";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, "true"];
  }),
);
const DAYS = Number(args.days) || 7;
const LIMIT = Number(args.limit) || 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;
async function mb<T>(path: string): Promise<T | null> {
  // 초당 1회 제한 준수
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 503) {
    // 일시적 과부하 — 한 번만 재시도
    await sleep(3000);
    return mb(path);
  }
  if (!res.ok) return null;
  return (await res.json()) as T;
}

interface RgSearchResult {
  "release-groups": {
    id: string;
    title: string;
    "first-release-date"?: string;
    "artist-credit"?: { name: string }[];
  }[];
  count: number;
}

interface RgLookup {
  genres?: { name: string; count: number }[];
}

/** MusicBrainz 장르명 → 우리 세부 테마. 직접 일치만 인정 (보수적) */
function mapGenre(mbGenres: { name: string; count: number }[]): string | null {
  const sorted = [...mbGenres].sort((a, b) => b.count - a.count);
  for (const g of sorted) {
    const name = g.name.toLowerCase().replace(/ /g, "-");
    if (GENRE_TO_CLUSTER.has(name)) return name;
  }
  return null;
}

async function main(): Promise<void> {
  const today = new Date();
  const from = new Date(today.getTime() - DAYS * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const batchId = `mb-weekly-${fmt(today)}`;
  console.log(`기간: ${fmt(from)} ~ ${fmt(today)} | 상한: ${LIMIT}곡 | 배치: ${batchId}`);

  const stats = { candidates: 0, noGenre: 0, unmapped: 0, duplicate: 0, inserted: 0 };

  outer: for (let page = 0; page < MAX_PAGES; page++) {
    const query = encodeURIComponent(
      `firstreleasedate:[${fmt(from)} TO ${fmt(today)}] AND primarytype:single AND status:official`,
    );
    const data = await mb<RgSearchResult>(
      `release-group/?query=${query}&fmt=json&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    );
    if (!data || data["release-groups"].length === 0) break;

    for (const rg of data["release-groups"]) {
      if (stats.inserted >= LIMIT) break outer;
      const artist = rg["artist-credit"]?.[0]?.name;
      if (!artist || !rg.title) continue;
      stats.candidates++;

      // 멱등: 이미 이 릴리즈그룹을 편입했으면 건너뜀
      const [bySource] = await db
        .select({ id: schema.songs.id })
        .from(schema.songs)
        .where(and(eq(schema.songs.source, SOURCE), eq(schema.songs.sourceId, rg.id)));
      if (bySource) {
        stats.duplicate++;
        continue;
      }
      // 다른 소스(데이터셋/iTunes)로 이미 있는 곡도 건너뜀 (제목+가수 일치)
      const [byName] = await db
        .select({ id: schema.songs.id })
        .from(schema.songs)
        .where(and(ilike(schema.songs.title, rg.title), ilike(schema.songs.artist, artist)));
      if (byName) {
        stats.duplicate++;
        continue;
      }

      // 장르 태그 조회 (곡당 1회, 1rps)
      const detail = await mb<RgLookup>(`release-group/${rg.id}?inc=genres&fmt=json`);
      const genres = detail?.genres ?? [];
      if (genres.length === 0) {
        stats.noGenre++;
        continue;
      }
      const genre = mapGenre(genres);
      if (!genre) {
        stats.unmapped++;
        continue;
      }

      const placement = await placeInGenre(genre, `${SOURCE}:${rg.id}`);
      if (!placement) {
        stats.unmapped++;
        continue;
      }

      await db
        .insert(schema.songs)
        .values({
          title: rg.title,
          artist,
          album: null,
          releaseYear: rg["first-release-date"] ? Number(rg["first-release-date"].slice(0, 4)) : null,
          source: SOURCE,
          sourceId: rg.id,
          genre,
          themeId: placement.themeId,
          posX: placement.x,
          posY: placement.y,
          posZ: placement.z,
          features: null, // 오디오 특징 없음 — 태그 기반 배치
          popularity: 45, // 인기도 정보 없음 — 중간보다 약간 낮게 시작
          batchId,
        })
        .onConflictDoNothing({ target: [schema.songs.source, schema.songs.sourceId] });
      stats.inserted++;
      process.stdout.write(`\r편입 ${stats.inserted}/${LIMIT}: ${rg.title} — ${artist} (${genre})      `);
    }
  }

  console.log(
    `\n완료 — 후보 ${stats.candidates}, 태그 없음 ${stats.noGenre}, 매핑 실패 ${stats.unmapped}, ` +
      `중복 ${stats.duplicate}, 편입 ${stats.inserted} (배치 ${batchId})`,
  );
  console.log(`롤백: DELETE FROM songs WHERE batch_id = '${batchId}';`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
