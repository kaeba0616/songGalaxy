/**
 * 주간 신곡 적재 CLI (이슈 #7)
 * 코어 로직은 src/server/new-releases.ts (Vercel Cron과 공용).
 * 실행: npm run ingest:new [-- --days=7 --limit=60]
 */
import net from "node:net";
import { runNewReleaseIngest } from "../src/server/new-releases";

// WSL + Node20 happy-eyeballs 버그 회피 (src/instrumentation.ts와 동일 이유)
net.setDefaultAutoSelectFamily(false);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, "true"];
  }),
);

async function main(): Promise<void> {
  const days = Number(args.days) || 7;
  const limit = Number(args.limit) || 60;
  console.log(`기간: 최근 ${days}일 | 상한: ${limit}곡`);

  const stats = await runNewReleaseIngest({
    days,
    limit,
    onInsert: (title, artist, genre, count) => {
      process.stdout.write(`\r편입 ${count}/${limit}: ${title} — ${artist} (${genre})      `);
    },
  });

  console.log(
    `\n완료 — 후보 ${stats.candidates}, 태그 없음 ${stats.noGenre}, 매핑 실패 ${stats.unmapped}, ` +
      `중복 ${stats.duplicate}, 편입 ${stats.inserted} (배치 ${stats.batchId})`,
  );
  console.log(`롤백: DELETE FROM songs WHERE batch_id = '${stats.batchId}';`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
