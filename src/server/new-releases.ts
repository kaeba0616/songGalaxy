import { and, eq, ilike } from "drizzle-orm";
import { db, schema } from "@/db";
import { GENRE_TO_CLUSTER } from "@/config/genre-clusters";
import { placeSong } from "./place-song";

/**
 * 주간 신곡 적재 코어 (이슈 #7·#8) — CLI(scripts/ingest-new-releases.ts)와
 * Vercel Cron(/api/cron/ingest-new-releases)이 공용으로 사용한다.
 *
 * 보수적 선별: 공식 싱글 + 장르 태그 필수 + 매핑 성공 필수 + 상한.
 * MusicBrainz 레이트리밋(초당 1회) 준수. 기존 행 불변, batch_id로 롤백.
 * deadlineMs를 주면 서버리스 실행 시간 안에서 안전하게 중단한다 (다음 주에 이어짐).
 */

const SOURCE = "musicbrainz";
const USER_AGENT = "songGalaxy/0.1 (https://github.com/kaeba0616/songGalaxy)";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

export interface IngestStats {
  batchId: string;
  candidates: number;
  noGenre: number;
  unmapped: number;
  duplicate: number;
  inserted: number;
  /** deadline에 걸려 조기 종료했는지 */
  timedOut: boolean;
}

export interface IngestOptions {
  days?: number;
  limit?: number;
  deadlineMs?: number;
  /** 곡 하나 편입할 때마다 호출 (CLI 진행 표시용) */
  onInsert?: (title: string, artist: string, genre: string, count: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RgSearchResult {
  "release-groups": {
    id: string;
    title: string;
    "first-release-date"?: string;
    "artist-credit"?: { name: string }[];
  }[];
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

export async function runNewReleaseIngest(opts: IngestOptions = {}): Promise<IngestStats> {
  const days = opts.days ?? 7;
  const limit = opts.limit ?? 60;
  const startedAt = Date.now();
  const deadline = opts.deadlineMs ? startedAt + opts.deadlineMs : Infinity;

  let lastCall = 0;
  const mb = async <T>(path: string, retried = false): Promise<T | null> => {
    const wait = 1100 - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 503 && !retried) {
      await sleep(3000);
      return mb(path, true);
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  };

  const today = new Date();
  const from = new Date(today.getTime() - days * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const batchId = `mb-weekly-${fmt(today)}`;
  const stats: IngestStats = {
    batchId,
    candidates: 0,
    noGenre: 0,
    unmapped: 0,
    duplicate: 0,
    inserted: 0,
    timedOut: false,
  };

  outer: for (let page = 0; page < MAX_PAGES; page++) {
    const query = encodeURIComponent(
      `firstreleasedate:[${fmt(from)} TO ${fmt(today)}] AND primarytype:single AND status:official`,
    );
    const data = await mb<RgSearchResult>(
      `release-group/?query=${query}&fmt=json&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    );
    if (!data || data["release-groups"].length === 0) break;

    for (const rg of data["release-groups"]) {
      if (stats.inserted >= limit) break outer;
      if (Date.now() > deadline) {
        stats.timedOut = true;
        break outer;
      }
      const artist = rg["artist-credit"]?.[0]?.name;
      if (!artist || !rg.title) continue;
      stats.candidates++;

      const [bySource] = await db
        .select({ id: schema.songs.id })
        .from(schema.songs)
        .where(and(eq(schema.songs.source, SOURCE), eq(schema.songs.sourceId, rg.id)));
      if (bySource) {
        stats.duplicate++;
        continue;
      }
      const [byName] = await db
        .select({ id: schema.songs.id })
        .from(schema.songs)
        .where(and(ilike(schema.songs.title, rg.title), ilike(schema.songs.artist, artist)));
      if (byName) {
        stats.duplicate++;
        continue;
      }

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

      const placement = await placeSong({
        genre,
        seedKey: `${SOURCE}:${rg.id}`,
        title: rg.title,
        artist,
      });
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
          releaseYear: rg["first-release-date"]
            ? Number(rg["first-release-date"].slice(0, 4))
            : null,
          source: SOURCE,
          sourceId: rg.id,
          genre,
          themeId: placement.themeId,
          posX: placement.x,
          posY: placement.y,
          posZ: placement.z,
          features: placement.features, // 조회표에서 찾았으면 저장
          popularity: 45, // 인기도 정보 없음 — 중간보다 약간 낮게 시작
          batchId,
        })
        .onConflictDoNothing({ target: [schema.songs.source, schema.songs.sourceId] });
      stats.inserted++;
      opts.onInsert?.(rg.title, artist, genre, stats.inserted);
    }
  }

  return stats;
}
