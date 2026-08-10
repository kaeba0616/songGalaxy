/**
 * 확장 배치에서 Last.fm 동명이인 오귀속 후보를 찾는다.
 * 확장(`npm run expand:artists`)을 돌린 뒤 매번 함께 돌리고 결과를 눈으로 확인한다.
 *
 * artist-expand.ts의 가드는 primaryArtistKey로 비교하는데, 이 정규화가 문장부호를
 * 지우기 때문에 'RAINBOW.'(프랑스) 요청에 Last.fm이 'Rainbow'(영국 록밴드)를
 * 돌려줘도 같은 이름으로 통과해버렸다. 여기서는 대소문자만 무시하고
 * 문장부호는 그대로 두고 비교해 그런 경우를 잡아낸다.
 *
 * 결과는 "후보"이지 판정이 아니다 — 실측 9건 중 8건('Dr Zeus'→'Dr. Zeus',
 * 'Ivan Ferreiro'→'Iván Ferreiro' 등)은 표기만 다른 같은 인물이었다.
 * 그래서 가드를 문장부호까지 엄격하게 바꾸면 멀쩡한 곡을 잃는다. 사람이 본다.
 *
 * 한계: Last.fm에 철자가 완전히 같은 다른 가수가 있으면 이름이 바뀌지 않으므로
 * 이 방법으로는 잡히지 않는다.
 *
 * 실행: npm run audit:expand [-- --batch=lastfm-expand-2026-08-10]
 */
import net from "node:net";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { env } from "../src/config/env";

net.setDefaultAutoSelectFamily(false);

const API = "https://ws.audioscrobbler.com/2.0/";
const argBatch = process.argv.slice(2).find((a) => a.startsWith("--batch="));
const BATCH = argBatch?.slice("--batch=".length) ?? `lastfm-expand-${new Date().toISOString().slice(0, 10)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row extends Record<string, unknown> {
  artist: string;
  n: number;
  genre: string;
}

async function correctedName(artist: string): Promise<string | null> {
  const params = new URLSearchParams({
    method: "artist.gettoptracks",
    artist,
    api_key: env.lastfmApiKey ?? "",
    format: "json",
    limit: "1",
    autocorrect: "1",
  });
  try {
    const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      toptracks?: { "@attr"?: { artist?: string } };
    };
    return data.toptracks?.["@attr"]?.artist ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const rows = await db.execute<Row>(sql`
    select artist, count(*)::int as n, mode() within group (order by genre) as genre
    from songs where batch_id = ${BATCH} group by artist order by artist`);
  console.log(`배치 아티스트 ${rows.rows.length}명 검사`);

  const suspects: { artist: string; corrected: string; n: number; genre: string }[] = [];
  let i = 0;
  for (const r of rows.rows) {
    i += 1;
    const corrected = await correctedName(r.artist);
    if (corrected && corrected.trim().toLowerCase() !== r.artist.trim().toLowerCase()) {
      suspects.push({ artist: r.artist, corrected, n: r.n, genre: r.genre });
      console.log(`\n  ⚠ "${r.artist}" → Last.fm "${corrected}" (${r.n}곡, ${r.genre})`);
    }
    if (i % 50 === 0) process.stdout.write(`\r진행 ${i}/${rows.rows.length} | 후보 ${suspects.length}   `);
    await sleep(120);
  }
  console.log(`\n\n=== 오귀속 후보 ${suspects.length}건 ===`);
  console.table(suspects);
}

main().then(() => process.exit(0));
