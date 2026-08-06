/**
 * 초기 은하 적재 파이프라인 (이슈 #2)
 *
 * HuggingFace의 Spotify Tracks 데이터셋(11.4만 곡)을 내려받아
 * 인기도 상위 GALAXY_SONG_COUNT곡을 songs 테이블에 적재한다.
 * 좌표(pos_x/y/z)와 테마(theme_id)는 이 단계에서 비워두고, 레이아웃 배치(이슈 #3)가 채운다.
 *
 * 실행: npm run ingest  (사전 조건: npm run db:up && npm run db:push)
 * 멱등: (source, source_id) 유니크 제약 + onConflictDoNothing으로 재실행해도 중복 없음.
 */
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse/sync";
import { db, schema } from "../src/db";
import { GALAXY_SONG_COUNT } from "../src/config/constants";

const DATASET_URL =
  "https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset/resolve/main/dataset.csv";
const DATA_DIR = "data";
const CSV_PATH = `${DATA_DIR}/dataset.csv`;
const SOURCE = "spotify-tracks-114k";
const BATCH_ID = "initial-dataset";

/** 오디오 특징으로 저장할 수치 컬럼 (유사도 계산 재료, 이슈 #3에서 사용) */
const FEATURE_COLUMNS = [
  "danceability",
  "energy",
  "loudness",
  "speechiness",
  "acousticness",
  "instrumentalness",
  "liveness",
  "valence",
  "tempo",
] as const;

interface CsvRow {
  track_id: string;
  artists: string;
  album_name: string;
  track_name: string;
  popularity: string;
  duration_ms: string;
  explicit: string;
  track_genre: string;
  [key: string]: string;
}

async function download(): Promise<void> {
  if (existsSync(CSV_PATH)) {
    console.log(`이미 내려받음: ${CSV_PATH} (건너뜀)`);
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`다운로드 중: ${DATASET_URL}`);
  const res = await fetch(DATASET_URL);
  if (!res.ok || !res.body) {
    throw new Error(`다운로드 실패: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(CSV_PATH));
  console.log(`저장 완료: ${CSV_PATH}`);
}

async function main(): Promise<void> {
  await download();

  const raw = await readFile(CSV_PATH, "utf8");
  const rows: CsvRow[] = parse(raw, { columns: true, skip_empty_lines: true });
  console.log(`CSV 행 수: ${rows.length}`);

  // 같은 곡이 여러 장르 행으로 중복 등장 → track_id 기준 인기도 최고 행만 유지
  const byTrackId = new Map<string, CsvRow>();
  for (const row of rows) {
    if (!row.track_id || !row.track_name || !row.artists) continue;
    const existing = byTrackId.get(row.track_id);
    if (!existing || Number(row.popularity) > Number(existing.popularity)) {
      byTrackId.set(row.track_id, row);
    }
  }
  console.log(`중복 제거 후 곡 수: ${byTrackId.size}`);

  const top = [...byTrackId.values()]
    .sort((a, b) => Number(b.popularity) - Number(a.popularity))
    .slice(0, GALAXY_SONG_COUNT);
  console.log(`적재 대상 (인기도 상위): ${top.length}곡`);

  const values = top.map((row) => ({
    title: row.track_name,
    artist: row.artists.split(";")[0].trim(),
    album: row.album_name || null,
    releaseYear: null, // 이 데이터셋에는 발매연도가 없음. 추후 MusicBrainz로 보강 가능
    source: SOURCE,
    sourceId: row.track_id,
    genre: row.track_genre,
    features: Object.fromEntries(
      FEATURE_COLUMNS.map((col) => [col, Number(row[col])]),
    ) as Record<string, number>,
    popularity: Number(row.popularity),
    explicit: row.explicit === "True",
    durationMs: Number(row.duration_ms) || null,
    batchId: BATCH_ID,
  }));

  const CHUNK = 1_000;
  let inserted = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    const result = await db
      .insert(schema.songs)
      .values(chunk)
      .onConflictDoNothing({ target: [schema.songs.source, schema.songs.sourceId] })
      .returning({ id: schema.songs.id });
    inserted += result.length;
    process.stdout.write(`\r적재 중: ${Math.min(i + CHUNK, values.length)}/${values.length}`);
  }
  console.log(`\n신규 적재: ${inserted}곡 (기존 존재로 건너뜀: ${values.length - inserted}곡)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
