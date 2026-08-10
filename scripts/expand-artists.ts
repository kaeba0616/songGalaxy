/**
 * 아티스트 대표곡 확장 CLI
 *
 * 은하에 이미 있는 가수의 대표곡 중 우리에게 없는 곡을 채운다 (src/server/artist-expand.ts).
 * 롤백: batch_id로 통째로 삭제 — DELETE FROM songs WHERE batch_id = '<출력된 배치명>'
 *
 * 실행: npx tsx --env-file=.env scripts/expand-artists.ts [아티스트수] [아티스트당곡수] [전체상한]
 * 예:   npx tsx --env-file=.env scripts/expand-artists.ts 20 2 30   (맛보기)
 *
 * 특정 가수만: npx tsx --env-file=.env scripts/expand-artists.ts --only "tuki." "YOASOBI"
 */
import { expandArtists } from "../src/server/artist-expand";

async function main(): Promise<void> {
  if (!process.env.LASTFM_API_KEY) {
    console.error("LASTFM_API_KEY가 없습니다. https://www.last.fm/api/account/create 에서 발급 후 .env에 넣어주세요.");
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const only = argv[0] === "--only" ? argv.slice(1) : undefined;
  const [artistLimit, perArtist, totalLimit] = (only ? [] : argv).map(Number);
  const stats = await expandArtists({
    only,
    artistLimit: artistLimit || 50,
    perArtist: perArtist || (only ? 30 : 3),
    totalLimit: totalLimit || (only ? 300 : 150),
    onInsert: (title, artist, popularity, count) =>
      process.stdout.write(`\r[${count}] ${artist} — ${title} (인기도 ${popularity})            `),
  });
  console.log("\n\n=== 결과 ===");
  console.log(`배치: ${stats.batchId}`);
  console.log(`아티스트 ${stats.artists}명 조회 → 후보 ${stats.candidates}곡`);
  console.log(`  이미 있음: ${stats.duplicate} / 청취자 적어 제외: ${stats.tooQuiet} / 좌표 실패: ${stats.noPlacement}`);
  console.log(`  새로 추가: ${stats.inserted}곡`);
  console.log(`\n롤백: DELETE FROM songs WHERE batch_id = '${stats.batchId}';`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
