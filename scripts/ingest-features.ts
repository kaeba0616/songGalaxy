/**
 * 오디오 특징 조회표 적재 (dataset_features)
 *
 * 초기 데이터셋 CSV에는 은하에 넣지 않은 곡(인기도 하위)의 오디오 특징까지 들어 있다.
 * 나중에 편입되는 곡이 "소리가 비슷한 곡 옆"에 놓이려면 그 특징이 프로덕션에서도
 * 조회 가능해야 하는데, data/ 는 배포되지 않으므로 DB로 옮긴다.
 *
 * 멱등: 실행할 때마다 표를 비우고 다시 채운다 (참조표라 안전).
 * 실행: npx tsx --env-file=.env scripts/ingest-features.ts
 */
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { AUDIO_FEATURE_KEYS } from "../src/config/constants";
import { baseTitleKey, normalizeKey, primaryArtistKey } from "../src/lib/match-key";

const CSV_PATH = "data/dataset.csv";
const CHUNK = 2000;

interface CsvRow {
  track_id: string;
  artists: string;
  track_name: string;
  track_genre: string;
  [key: string]: string;
}

async function main(): Promise<void> {
  const raw = await readFile(CSV_PATH, "utf8");
  const rows: CsvRow[] = parse(raw, { columns: true, skip_empty_lines: true });
  console.log(`CSV 행 수: ${rows.length}`);

  // 같은 곡이 장르별로 중복 등장 → track_id 기준 1행만 (특징 값은 행마다 동일)
  const byTrackId = new Map<string, CsvRow>();
  for (const row of rows) {
    if (!row.track_id || !row.track_name || !row.artists) continue;
    if (!byTrackId.has(row.track_id)) byTrackId.set(row.track_id, row);
  }
  console.log(`고유 곡 수: ${byTrackId.size}`);

  const values = [...byTrackId.values()].map((row) => {
    const features: Record<string, number> = {};
    for (const key of AUDIO_FEATURE_KEYS) features[key] = Number(row[key] ?? 0);
    return {
      titleKey: normalizeKey(row.track_name),
      baseKey: baseTitleKey(row.track_name),
      artistKey: primaryArtistKey(row.artists),
      genre: row.track_genre,
      features,
    };
  });

  await db.execute(sql`TRUNCATE TABLE dataset_features RESTART IDENTITY`);
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(schema.datasetFeatures).values(values.slice(i, i + CHUNK));
    process.stdout.write(`\r적재: ${Math.min(i + CHUNK, values.length)}/${values.length}   `);
  }
  console.log(`\n조회표 적재 완료: ${values.length}곡`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
