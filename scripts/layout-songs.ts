/**
 * 곡 3D 좌표 산출 배치 (이슈 #3) — 하이브리드 배치의 "유사도" 절반
 *
 * 세부 테마(장르)별로 오디오 특징을 PCA 3성분으로 투영해
 * 세부 테마 구역 안에 곡을 흩뿌린다. 비슷한 곡일수록 가까이 놓인다.
 *
 * 좌표 불변 원칙: pos가 NULL인 곡만 채운다. 이미 좌표가 있는 곡은 절대 건드리지 않는다.
 * 롤백: 실행 전 songs 백업 테이블 생성 (songs_backup_layout).
 * 실행: npx tsx --env-file=.env scripts/layout-songs.ts
 */
import { eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { GALAXY_RADIUS } from "../src/config/constants";
import { hashString, mulberry32, pcaScores, scaleToUnit, zscore } from "./lib/layout-math";

/** PCA 입력으로 쓸 특징 (scripts/ingest-dataset.ts의 FEATURE_COLUMNS와 일치) */
const FEATURE_KEYS = [
  "danceability", "energy", "loudness", "speechiness", "acousticness",
  "instrumentalness", "liveness", "valence", "tempo",
];

/** PCA 3성분을 세부 테마 반지름에 곱할 비율 (타원체 모양으로 예쁘게) */
const AXIS_SCALE = [0.95, 0.75, 0.55];
/** 좌표에 더할 지터 비율 (겹침 완화) */
const JITTER = 0.06;

async function main(): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS songs_backup_layout`);
  await db.execute(sql`CREATE TABLE songs_backup_layout AS TABLE songs`);
  console.log("백업 생성: songs_backup_layout");

  const subThemes = await db
    .select()
    .from(schema.themes)
    .where(eq(schema.themes.level, 2));
  const bigThemes = await db
    .select()
    .from(schema.themes)
    .where(eq(schema.themes.level, 1));
  const bigById = new Map(bigThemes.map((t) => [t.id, t]));
  console.log(`세부 테마 ${subThemes.length}개 처리 시작`);

  let placed = 0;
  for (const theme of subThemes) {
    const pending = await db
      .select({
        id: schema.songs.id,
        sourceId: schema.songs.sourceId,
        features: schema.songs.features,
      })
      .from(schema.songs)
      .where(sql`${schema.songs.genre} = ${theme.name} AND ${isNull(schema.songs.posX)}`);
    if (pending.length === 0) continue;

    const matrix = pending.map((s) =>
      FEATURE_KEYS.map((key) => Number(s.features?.[key] ?? 0)),
    );
    const scores = pcaScores(zscore(matrix), 3);
    const axes = [0, 1, 2].map((axis) => scaleToUnit(scores.map((row) => row[axis])));

    const radius = theme.radius ?? 50;
    const center = { x: theme.posX ?? 0, y: theme.posY ?? 0, z: theme.posZ ?? 0 };

    const updates = pending.map((song, i) => {
      const rng = mulberry32(hashString(song.sourceId));
      const jitter = () => (rng() * 2 - 1) * radius * JITTER;
      let x = center.x + axes[0][i] * radius * AXIS_SCALE[0] + jitter();
      let y = center.y + axes[1][i] * radius * AXIS_SCALE[1] + jitter();
      let z = center.z + axes[2][i] * radius * AXIS_SCALE[2] + jitter();
      // 성단(부모) 경계 밖으로 나가지 않게 클램프 (AC: 경계 침범 0건)
      const big = theme.parentId != null ? bigById.get(theme.parentId) : undefined;
      if (big && big.radius != null) {
        const dx = x - (big.posX ?? 0);
        const dy = y - (big.posY ?? 0);
        const dz = z - (big.posZ ?? 0);
        const d = Math.hypot(dx, dy, dz);
        const maxD = big.radius * 0.98;
        if (d > maxD) {
          const s = maxD / d;
          x = (big.posX ?? 0) + dx * s;
          y = (big.posY ?? 0) + dy * s;
          z = (big.posZ ?? 0) + dz * s;
        }
      }
      // 은하 전체 반지름 밖으로 나가지 않게 클램프
      const dist = Math.hypot(x, y, z);
      if (dist > GALAXY_RADIUS) {
        const s = GALAXY_RADIUS / dist;
        x *= s; y *= s; z *= s;
      }
      return { id: song.id, x, y, z };
    });

    // 세부 테마 단위 벌크 업데이트
    const valuesSql = sql.join(
      updates.map((u) => sql`(${u.id}::int, ${u.x}::real, ${u.y}::real, ${u.z}::real)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE songs AS s
      SET pos_x = v.x, pos_y = v.y, pos_z = v.z, theme_id = ${theme.id}
      FROM (VALUES ${valuesSql}) AS v(id, x, y, z)
      WHERE s.id = v.id
    `);
    placed += updates.length;
    process.stdout.write(`\r배치: ${placed}곡 (${theme.name})        `);
  }

  console.log(`\n좌표 산출 완료: ${placed}곡`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
