/**
 * 미리듣기가 비어 있는 곡의 앨범아트·미리듣기 재조회 CLI.
 * 조회 로직 원본은 src/server/enrich.ts (docs/SSOT.md) — 여기서 다시 구현하지 않는다.
 *
 * 왜 필요한가: 외부 API가 잠깐 빈 결과(HTTP 200 + results 0건)를 준 것이
 * "이 곡엔 미디어가 없다"로 캐시에 굳어버린 곡들이 있다. enriched_at을 지워서
 * 캐시를 무효화한 뒤 다시 조회한다.
 *
 * 실행: npm run refresh:media [-- --limit=500 --dry]
 */
import net from "node:net";
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { enrichSongs } from "../src/server/enrich";

// WSL + Node20 happy-eyeballs 버그 회피 (src/instrumentation.ts와 동일 이유)
net.setDefaultAutoSelectFamily(false);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    // 값 없는 플래그(--dry)도 대시를 뗀 키로 담는다
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);

/** enrichSongs는 곡을 순차 조회한다. 배치 사이에 숨을 돌려 외부 API 부담을 낮춘다 */
const BATCH = 25;
const PAUSE_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const limit = Number(args.limit) || 1000;
  const dry = args.dry === "true";

  const targets = await db
    .select({ id: schema.songs.id, title: schema.songs.title, artist: schema.songs.artist })
    .from(schema.songs)
    .where(sql`enriched_at is not null and preview_url is null`)
    .orderBy(sql`popularity desc nulls last`)
    .limit(limit);

  console.log(`재조회 대상: ${targets.length}곡 (상한 ${limit})`);
  if (targets.length === 0) return;
  if (dry) {
    for (const t of targets.slice(0, 20)) console.log(`  ${t.artist} — ${t.title}`);
    console.log("--dry 이므로 여기서 멈춥니다.");
    return;
  }

  let preview = 0;
  let artworkOnly = 0;
  let still = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const ids = chunk.map((t) => t.id);

    // 캐시 무효화 — enrichSongs가 enriched_at이 있는 곡은 외부 조회를 건너뛴다
    await db
      .update(schema.songs)
      .set({ enrichedAt: null })
      .where(inArray(schema.songs.id, ids));

    const media = await enrichSongs(ids);
    for (const t of chunk) {
      const m = media[t.id];
      if (m?.previewUrl) preview += 1;
      else if (m?.artworkUrl) artworkOnly += 1;
      else still += 1;
    }
    process.stdout.write(
      `\r진행 ${Math.min(i + BATCH, targets.length)}/${targets.length} | 미리듣기 ${preview} | 아트만 ${artworkOnly} | 여전히 없음 ${still}    `,
    );
    if (i + BATCH < targets.length) await sleep(PAUSE_MS);
  }

  console.log(
    `\n완료 — 미리듣기 복구 ${preview}곡, 아트만 복구 ${artworkOnly}곡, 여전히 없음 ${still}곡`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
