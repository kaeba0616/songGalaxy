/**
 * 테마 계층(성단) 생성 배치 (이슈 #3)
 *
 * 장르→성단 매핑(src/config/genre-clusters.ts, SSOT)을 읽어
 * level 1(성단)과 level 2(세부 테마 = 장르) 행을 themes 테이블에 만든다.
 *
 * 좌표 불변 원칙: 이미 존재하는 테마는 절대 수정하지 않고, 없는 것만 추가한다.
 * 실행: npx tsx --env-file=.env scripts/build-themes.ts
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { GALAXY_RADIUS } from "../src/config/constants";
import { GENRE_CLUSTERS } from "../src/config/genre-clusters";
import { fibonacciSphere } from "../src/lib/layout-math";

/** 성단 중심이 놓이는 구면 반지름 */
const CLUSTER_SHELL_RADIUS = GALAXY_RADIUS * 0.6;
/** 성단 반지름 범위 (곡 수에 비례) */
const CLUSTER_RADIUS_MIN = 110;
const CLUSTER_RADIUS_MAX = 270;

async function main(): Promise<void> {
  // 장르별 곡 수 (성단 크기 산정용)
  const counts = await db.execute<{ genre: string; n: string }>(
    sql`SELECT genre, count(*) AS n FROM songs GROUP BY genre`,
  );
  const genreCount = new Map(counts.rows.map((r) => [r.genre, Number(r.n)]));

  const clusterCount = GENRE_CLUSTERS.map((c) =>
    c.genres.reduce((sum, g) => sum + (genreCount.get(g) ?? 0), 0),
  );
  const maxClusterCount = Math.max(...clusterCount);

  const existing = await db.select().from(schema.themes);
  const existingByKey = new Map(existing.map((t) => [`${t.level}:${t.name}`, t]));

  const centers = fibonacciSphere(GENRE_CLUSTERS.length, CLUSTER_SHELL_RADIUS);
  let created = 0;

  for (let i = 0; i < GENRE_CLUSTERS.length; i++) {
    const cluster = GENRE_CLUSTERS[i];
    const total = clusterCount[i];
    const radius =
      CLUSTER_RADIUS_MIN +
      (CLUSTER_RADIUS_MAX - CLUSTER_RADIUS_MIN) * Math.sqrt(total / maxClusterCount);

    let parent = existingByKey.get(`1:${cluster.slug}`);
    if (!parent) {
      [parent] = await db
        .insert(schema.themes)
        .values({
          name: cluster.slug,
          level: 1,
          parentId: null,
          posX: centers[i].x,
          posY: centers[i].y,
          posZ: centers[i].z,
          radius,
          color: cluster.color,
        })
        .returning();
      created++;
    }

    // 실제 곡이 있는 장르만 세부 테마로 생성
    const presentGenres = cluster.genres.filter((g) => (genreCount.get(g) ?? 0) > 0);
    const maxGenreCount = Math.max(1, ...presentGenres.map((g) => genreCount.get(g) ?? 0));
    const subCenters = fibonacciSphere(presentGenres.length, (parent.radius ?? radius) * 0.55);

    for (let j = 0; j < presentGenres.length; j++) {
      const genre = presentGenres[j];
      if (existingByKey.has(`2:${genre}`)) continue;
      const n = genreCount.get(genre) ?? 0;
      const subRadius =
        (parent.radius ?? radius) * (0.18 + 0.3 * Math.sqrt(n / maxGenreCount));
      await db.insert(schema.themes).values({
        name: genre,
        level: 2,
        parentId: parent.id,
        posX: (parent.posX ?? 0) + subCenters[j].x,
        posY: (parent.posY ?? 0) + subCenters[j].y,
        posZ: (parent.posZ ?? 0) + subCenters[j].z,
        radius: subRadius,
        color: cluster.color,
      });
      created++;
    }
  }

  const all = await db.select().from(schema.themes);
  const level1 = all.filter((t) => t.level === 1).length;
  const level2 = all.filter((t) => t.level === 2).length;
  console.log(`테마 생성 완료: 신규 ${created}개 (성단 ${level1}개, 세부 테마 ${level2}개)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
