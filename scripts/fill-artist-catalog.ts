/**
 * 은하에 이미 있는 가수의 "빠진 곡" 채우기
 *
 * 초기 적재는 인기도 상위 3만 곡만 넣었다. 그래서 같은 가수의 곡이라도
 * 인기도 43 미만이면 통째로 빠졌다 — 모차르트 301곡, 엘라 피츠제럴드 115곡처럼
 * 오래된 명곡일수록 최근 스트리밍 기준 인기도가 낮아 많이 잘렸다.
 *
 * 이 곡들은 CSV에 오디오 특징이 다 있으므로, 같은 장르에서 특징이 가까운
 * 기존 곡들의 좌표를 빌려 정확한 자리에 놓는다 (src/lib/neighbor-place.ts).
 *
 * 좌표 불변: 기존 곡은 건드리지 않고 새 행만 만든다.
 * 롤백: DELETE FROM songs WHERE batch_id = '<출력된 배치명>'
 * 실행: npx tsx --env-file=.env scripts/fill-artist-catalog.ts [최소인기도] [최대곡수]
 */
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { AUDIO_FEATURE_KEYS } from "../src/config/constants";
import { hashString, mulberry32 } from "../src/lib/layout-math";
import { baseTitleKey, primaryArtistKey } from "../src/lib/match-key";
import { buildNeighborPool, clampPoint, pointFromNeighbors } from "../src/lib/neighbor-place";

const CSV_PATH = "data/dataset.csv";
const SOURCE = "spotify-tracks-114k";
const CHUNK = 1000;

interface Candidate {
  trackId: string;
  title: string;
  artist: string;
  genre: string;
  popularity: number;
  explicit: boolean;
  durationMs: number | null;
  features: Record<string, number>;
}

async function main(): Promise<void> {
  const minPopularity = Number(process.argv[2] ?? 0);
  const maxSongs = Number(process.argv[3] ?? Infinity);
  const batchId = `catalog-fill-${new Date().toISOString().slice(0, 10)}`;

  const rows: Record<string, string>[] = parse(await readFile(CSV_PATH, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
  // 적재 스크립트와 동일: track_id 기준 인기도 최고 행
  const byId = new Map<string, Record<string, string>>();
  for (const r of rows) {
    if (!r.track_id || !r.track_name || !r.artists) continue;
    const cur = byId.get(r.track_id);
    if (!cur || Number(r.popularity) > Number(cur.popularity)) byId.set(r.track_id, r);
  }

  // 은하에 있는 곡 (중복 판정 + 가수 목록)
  const have = await db.execute<{ title: string; artist: string }>(sql`
    SELECT title, artist FROM songs WHERE pos_x IS NOT NULL`);
  const haveKeys = new Set<string>();
  const galaxyArtists = new Set<string>();
  for (const s of have.rows) {
    const ak = primaryArtistKey(s.artist);
    haveKeys.add(`${ak}|${baseTitleKey(s.title)}`);
    galaxyArtists.add(ak);
  }

  const candidates: Candidate[] = [];
  for (const t of byId.values()) {
    const ak = primaryArtistKey(t.artists.split(";")[0]);
    if (!galaxyArtists.has(ak)) continue;
    if (haveKeys.has(`${ak}|${baseTitleKey(t.track_name)}`)) continue;
    const popularity = Number(t.popularity);
    if (popularity < minPopularity) continue;
    const features: Record<string, number> = {};
    for (const key of AUDIO_FEATURE_KEYS) features[key] = Number(t[key] ?? 0);
    candidates.push({
      trackId: t.track_id,
      title: t.track_name,
      artist: t.artists.split(";")[0],
      genre: t.track_genre,
      popularity,
      explicit: t.explicit === "True",
      durationMs: Number(t.duration_ms) || null,
      features,
    });
    // 같은 실행 안 중복도 막는다 (다른 track_id의 같은 곡)
    haveKeys.add(`${ak}|${baseTitleKey(t.track_name)}`);
  }
  candidates.sort((a, b) => b.popularity - a.popularity);
  const picked = candidates.slice(0, maxSongs);
  console.log(`후보 ${candidates.length.toLocaleString()}곡 중 ${picked.length.toLocaleString()}곡 적재`);

  // 세부 테마 + 부모 성단
  const themes = await db.select().from(schema.themes);
  const subByGenre = new Map(themes.filter((t) => t.level === 2).map((t) => [t.name, t]));
  const byId2 = new Map(themes.map((t) => [t.id, t]));

  // 장르별로 묶어 처리한다 (곡마다 DB를 조회하면 2만 번 왕복하게 된다)
  const byGenre = new Map<string, Candidate[]>();
  for (const c of picked) {
    if (!subByGenre.has(c.genre)) continue; // 테마가 없는 장르는 건너뛴다
    const list = byGenre.get(c.genre) ?? [];
    list.push(c);
    byGenre.set(c.genre, list);
  }

  let inserted = 0;
  let noPool = 0;
  for (const [genre, list] of byGenre) {
    const subTheme = subByGenre.get(genre)!;
    const parent = subTheme.parentId != null ? (byId2.get(subTheme.parentId) ?? null) : null;
    const existing = await db
      .select({
        x: schema.songs.posX,
        y: schema.songs.posY,
        z: schema.songs.posZ,
        features: schema.songs.features,
      })
      .from(schema.songs)
      .where(sql`${schema.songs.genre} = ${genre} AND ${isNotNull(schema.songs.posX)}
                 AND ${isNotNull(schema.songs.features)}`);
    const pool = buildNeighborPool(
      existing
        .filter((e) => e.x != null && e.y != null && e.z != null)
        .map((e) => ({ x: e.x!, y: e.y!, z: e.z!, features: e.features })),
    );
    const jitter = (subTheme.radius ?? 40) * 0.05;

    const values = list.map((c) => {
      const rng = mulberry32(hashString(`${SOURCE}:${c.trackId}`));
      let point;
      if (pool) {
        point = pointFromNeighbors(pool, c.features, rng, jitter);
      } else {
        // 이웃이 부족한 장르 — 장르 구역 안 시드 랜덤
        noPool++;
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        const r = (subTheme.radius ?? 40) * 0.85 * Math.cbrt(rng());
        point = {
          x: (subTheme.posX ?? 0) + r * Math.sin(phi) * Math.cos(theta),
          y: (subTheme.posY ?? 0) + r * Math.sin(phi) * Math.sin(theta),
          z: (subTheme.posZ ?? 0) + r * Math.cos(phi),
        };
      }
      const p = clampPoint(point, parent);
      return {
        title: c.title,
        artist: c.artist,
        album: null,
        releaseYear: null,
        source: SOURCE,
        sourceId: c.trackId,
        genre: c.genre,
        themeId: subTheme.id,
        posX: p.x,
        posY: p.y,
        posZ: p.z,
        features: c.features,
        popularity: c.popularity,
        explicit: c.explicit,
        durationMs: c.durationMs,
        batchId,
      };
    });

    for (let i = 0; i < values.length; i += CHUNK) {
      await db
        .insert(schema.songs)
        .values(values.slice(i, i + CHUNK))
        .onConflictDoNothing({ target: [schema.songs.source, schema.songs.sourceId] });
    }
    inserted += values.length;
    process.stdout.write(`\r적재: ${inserted.toLocaleString()}곡 (${genre})              `);
  }

  console.log(`\n\n=== 결과 ===`);
  console.log(`배치: ${batchId}`);
  console.log(`적재: ${inserted.toLocaleString()}곡 (이웃 부족으로 랜덤 배치: ${noPool}곡)`);
  console.log(`\n롤백: DELETE FROM songs WHERE batch_id = '${batchId}';`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
