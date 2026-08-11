/**
 * 원본 데이터셋의 장르 오분류 정정 CLI.
 *
 * Spotify Tracks 데이터셋은 곡마다 장르를 하나씩 붙여놨는데 일부가 틀렸다.
 * 실측(2026-08-11): j-dance는 사실상 자메이카 댄스홀 통이었고(Vybz Kartel 111곡 등),
 * j-rock에는 터키 가수가, j-pop에는 미국·캐나다 재즈팝이 들어 있었다.
 * 더 나쁜 것은 카탈로그 보강·아티스트 확장이 "그 가수의 기존 곡에서 장르를 물려받는"
 * 규칙을 쓰기 때문에, 틀린 씨앗 하나가 그 가수의 새 곡으로 계속 번진다는 점이다.
 *
 * 판정은 MusicBrainz 국가 + 곡 제목의 문자 종류 두 신호를 함께 본다.
 * 국가만 보면 동명이인 때문에 오탐이 난다 — MusicBrainz가 일본 밴드 女王蜂(QUEEN BEE)에
 * 독일 가수를, MAX에 영국 가수를 물어왔다. 제목에 가나·한자가 있으면 일본 가수로 보고 제외한다.
 * 그래도 로마자 제목만 쓰는 일본 밴드(frederic)는 걸러지지 않으므로 이름으로 직접 제외한다.
 *
 * 장르만 바꾸면 별이 엉뚱한 성단에 남으므로 좌표도 placeSong으로 다시 잡는다.
 * 롤백: songs_backup_genre_fix에 이전 장르·테마·좌표를 남긴다.
 *
 * 실행: npx tsx --env-file=.env scripts/fix-genre-mislabel.ts [--apply]
 *       (--apply 없이 돌리면 대상만 보여주고 아무것도 바꾸지 않는다)
 */
import net from "node:net";
import { sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { placeSong } from "../src/server/place-song";

net.setDefaultAutoSelectFamily(false);

const APPLY = process.argv.includes("--apply");

/**
 * 이름으로 직접 빼는 가수 — 두 신호로도 걸러지지 않는 일본 가수들.
 * frederic: 일본 밴드인데 제목이 로마자(Oddloop)뿐이라 문자 필터에 안 걸린다.
 * ØMI: 일본 가수인데 MusicBrainz가 국가를 JM으로 준다.
 */
const NEVER_MOVE = ["frederic", "ØMI", "QUEEN BEE", "MAX"];

/** (원래 장르 → 옮길 장르) 를 MusicBrainz 국가로 결정한다 */
const RULES: { from: string[]; country: string; to: string }[] = [
  { from: ["j-dance"], country: "JM", to: "dancehall" },
  { from: ["j-rock", "j-pop", "j-idol"], country: "TR", to: "turkish" },
];

interface Target extends Record<string, unknown> {
  id: number;
  title: string;
  artist: string;
  genre: string;
  country: string;
}

async function targetsFor(rule: (typeof RULES)[number]): Promise<Target[]> {
  const rows = await db.execute<Target>(sql`
    SELECT s.id, s.title, s.artist, s.genre, a.country
    FROM songs s
    JOIN artists a ON a.name = s.artist
    WHERE s.genre = ANY(${sql.raw(`ARRAY[${rule.from.map((g) => `'${g}'`).join(",")}]`)})
      AND a.country = ${rule.country}
      AND s.artist <> ALL(${sql.raw(`ARRAY[${NEVER_MOVE.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")}]`)})
      -- 제목에 가나·한자가 하나라도 있는 가수는 일본 가수로 보고 통째로 제외
      AND NOT EXISTS (
        SELECT 1 FROM songs x
        WHERE x.artist = s.artist AND x.title ~ '[぀-ゟ゠-ヿ一-鿿]'
      )
    ORDER BY s.artist, s.id`);
  return rows.rows;
}

async function main(): Promise<void> {
  let moved = 0;
  let failed = 0;
  const methods: Record<string, number> = {};

  for (const rule of RULES) {
    const targets = await targetsFor(rule);
    const artists = new Set(targets.map((t) => t.artist));
    console.log(
      `\n[${rule.from.join("/")} → ${rule.to}] 국가 ${rule.country}: 가수 ${artists.size}명, ${targets.length}곡`,
    );
    console.log("  " + [...artists].join(", "));
    if (!APPLY) continue;

    for (const t of targets) {
      const placement = await placeSong({
        genre: rule.to,
        seedKey: String(t.id),
        title: t.title,
        artist: t.artist,
      });
      if (!placement) {
        failed += 1;
        continue;
      }
      // 되돌릴 수 있도록 먼저 남긴다
      await db.execute(sql`
        INSERT INTO songs_backup_genre_fix (id, old_genre, old_theme_id, old_pos_x, old_pos_y, old_pos_z)
        SELECT id, genre, theme_id, pos_x, pos_y, pos_z FROM songs WHERE id = ${t.id}
        ON CONFLICT (id) DO NOTHING`);
      await db
        .update(schema.songs)
        .set({
          genre: rule.to,
          themeId: placement.themeId,
          posX: placement.x,
          posY: placement.y,
          posZ: placement.z,
        })
        .where(sql`id = ${t.id}`);
      methods[placement.method] = (methods[placement.method] ?? 0) + 1;
      moved += 1;
      if (moved % 25 === 0) process.stdout.write(`\r  옮기는 중 ${moved}곡   `);
    }
  }

  if (!APPLY) {
    console.log("\n\n--apply 없이 돌렸으므로 아무것도 바꾸지 않았습니다.");
    return;
  }
  console.log(`\n\n=== 결과 ===`);
  console.log(`옮긴 곡: ${moved} / 좌표 실패로 건너뜀: ${failed}`);
  console.log(`배치 방법:`, methods);
  console.log(`\n롤백:`);
  console.log(`  UPDATE songs s SET genre=b.old_genre, theme_id=b.old_theme_id,`);
  console.log(`    pos_x=b.old_pos_x, pos_y=b.old_pos_y, pos_z=b.old_pos_z`);
  console.log(`  FROM songs_backup_genre_fix b WHERE s.id=b.id;`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
