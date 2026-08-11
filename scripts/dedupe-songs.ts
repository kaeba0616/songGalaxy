/**
 * 같은 곡 중복 정리
 *
 * 데이터셋에 같은 곡이 여러 앨범·리마스터로 실려 있어서(track_id가 달라
 * 초기 적재의 중복 제거를 통과했다), 은하에 같은 별이 두세 개씩 떠 있다.
 * 예: "As It Was"가 카드 목록에 1번과 4번에 나란히 나오던 현상.
 *
 * 판정 기준은 가수·제목의 정규화 키다. 부제는 떼지 않는다 —
 * "Song"과 "Song - Live"는 다른 녹음일 수 있어 보수적으로 남긴다.
 * 남길 곡: 인기도 높은 것 → 오디오 특징 있는 것 → id 작은 것 순.
 *
 * 안전장치: 삭제 전 songs_backup_dedupe에 원본을 복사한다.
 *   복구: INSERT INTO songs SELECT * FROM songs_backup_dedupe;
 * 좋아요가 걸린 곡은 절대 지우지 않는다 (그 별이 사라지면 안 되므로).
 *
 * 실행: npx tsx --env-file=.env scripts/dedupe-songs.ts          (분석만)
 *      npx tsx --env-file=.env scripts/dedupe-songs.ts --apply   (실제 삭제)
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { normalizeKey, primaryArtistKey } from "../src/lib/match-key";

interface Row extends Record<string, unknown> {
  id: number;
  title: string;
  artist: string;
  popularity: number;
  has_features: boolean;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const rows = await db.execute<Row>(sql`
    SELECT id, title, artist, popularity, (features IS NOT NULL) AS has_features
    FROM songs WHERE pos_x IS NOT NULL`);
  const likedRows = await db.execute<{ song_id: number }>(sql`SELECT DISTINCT song_id FROM likes`);
  const liked = new Set(likedRows.rows.map((l) => l.song_id));

  const groups = new Map<string, Row[]>();
  for (const r of rows.rows) {
    const key = `${primaryArtistKey(r.artist)}|${normalizeKey(r.title)}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }

  const doomed: number[] = [];
  /** 지울 곡 id → 같은 그룹에서 살아남는 곡 id. 유저 목록을 이쪽으로 옮긴다 */
  const winnerOf = new Map<number, number>();
  let protectedByLike = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort(
      (a, b) =>
        b.popularity - a.popularity ||
        Number(b.has_features) - Number(a.has_features) ||
        a.id - b.id,
    );
    const winner = sorted[0];
    for (const s of sorted.slice(1)) {
      // 좋아요가 걸린 곡은 남긴다 — 지우면 그 유저의 별 계산이 흔들린다
      if (liked.has(s.id)) {
        protectedByLike++;
        continue;
      }
      doomed.push(s.id);
      winnerOf.set(s.id, winner.id);
    }
  }

  console.log(`전체 ${rows.rows.length.toLocaleString()}곡`);
  console.log(`중복 그룹 ${[...groups.values()].filter((g) => g.length > 1).length.toLocaleString()}개`);
  console.log(`삭제 대상 ${doomed.length.toLocaleString()}곡 (좋아요가 있어 보호된 곡 ${protectedByLike}곡)`);

  if (!apply) {
    console.log("\n분석만 했습니다. 실제로 지우려면 --apply 를 붙여 실행하세요.");
    process.exit(0);
  }
  if (doomed.length === 0) {
    console.log("\n지울 것이 없습니다.");
    process.exit(0);
  }

  const idList = sql.join(doomed.map((id) => sql`${id}`), sql`, `);
  await db.execute(sql`DROP TABLE IF EXISTS songs_backup_dedupe`);
  await db.execute(sql`CREATE TABLE songs_backup_dedupe AS SELECT * FROM songs WHERE id IN (${idList})`);
  const backed = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM songs_backup_dedupe`);
  console.log(`\n백업 완료: songs_backup_dedupe (${Number(backed.rows[0].n).toLocaleString()}행)`);

  /**
   * 지우기 전에 유저 목록이 가리키는 손가락을 승자 쪽으로 옮긴다.
   *
   * 안 옮기면 담아둔 곡이 목록에서 그냥 사라진다 — playlist_songs.song_id에
   * ON DELETE CASCADE가 걸려 있어 곡과 함께 지워지기 때문이다. 중복 정리의 목적은
   * "같은 곡의 여러 행을 하나로 합치는 것"이니, 사용자가 가리키던 행도 함께 합쳐야 한다.
   * (좋아요는 아예 삭제에서 제외하는 방식으로 이미 보호되고 있다 — 위 참조)
   *
   * NOT EXISTS: 같은 목록에 승자가 이미 담겨 있으면 옮길 수 없다((playlist_id, song_id)
   * 기본키 충돌). 그런 행은 그대로 두면 곧 CASCADE로 지워지는데, 그게 맞는 결과다 —
   * 사용자 눈에는 같은 곡이 두 번 담겨 있던 것이 하나로 합쳐진 것으로 보인다.
   */
  // ::int 캐스트가 없으면 파라미터가 text로 추론돼 song_id(integer)와 비교가 안 된다
  const pairs = sql.join(
    [...winnerOf.entries()].map(([loser, winner]) => sql`(${loser}::int, ${winner}::int)`),
    sql`, `,
  );
  const moved = await db.execute(sql`
    UPDATE playlist_songs ps
    SET song_id = m.winner
    FROM (VALUES ${pairs}) AS m(loser, winner)
    WHERE ps.song_id = m.loser
      AND NOT EXISTS (
        SELECT 1 FROM playlist_songs x
        WHERE x.playlist_id = ps.playlist_id AND x.song_id = m.winner
      )`);
  const merged = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM playlist_songs WHERE song_id IN (${idList})`);
  console.log(
    `유저 목록 이동: ${moved.rowCount ?? 0}건 (승자가 이미 담겨 있어 합쳐진 행 ${merged.rows[0].n}건)`,
  );

  await db.execute(sql`DELETE FROM songs WHERE id IN (${idList})`);
  const after = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM songs WHERE pos_x IS NOT NULL`);
  console.log(`삭제 완료 → 남은 곡 ${Number(after.rows[0].n).toLocaleString()}곡`);
  console.log(`\n복구: INSERT INTO songs SELECT * FROM songs_backup_dedupe;`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
