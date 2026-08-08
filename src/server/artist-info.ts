import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { GENRE_TO_CLUSTER } from "@/config/genre-clusters";

export type ArtistInfo = typeof schema.artists.$inferSelect;

interface MbArtist {
  name: string;
  type?: string;
  country?: string;
  "life-span"?: { begin?: string };
  tags?: { name: string; count?: number }[];
  score?: number;
}

/** MB 태그명 정규화 (우리 장르 표기와 맞춤: 소문자, 공백→하이픈) */
const norm = (s: string) => s.toLowerCase().replace(/ /g, "-");

/**
 * 동명이인 판별: 곡 장르 힌트와 태그가 겹치는 후보를 우선한다.
 * (예: "Sam Smith"는 MB에 여럿 — 곡이 pop이면 rock 1969년생이 아니라
 * pop/soul 태그의 후보를 선택). 태그 수는 유명도 근사로 보조 점수.
 */
function pickCandidate(candidates: MbArtist[], genreHint?: string): MbArtist | undefined {
  const strong = candidates.filter((c) => (c.score ?? 0) >= 85);
  if (strong.length === 0) return undefined;

  // 힌트 장르 + 같은 성단의 장르들을 매칭 집합으로
  const hintSet = new Set<string>();
  if (genreHint) {
    hintSet.add(norm(genreHint));
    GENRE_TO_CLUSTER.get(genreHint)?.genres.forEach((g) => hintSet.add(g));
  }

  let best: MbArtist | undefined;
  let bestScore = -1;
  for (const c of strong) {
    const tags = (c.tags ?? []).map((tg) => norm(tg.name));
    const overlap = tags.filter((tg) => hintSet.has(tg)).length;
    const score =
      (c.score ?? 0) + // 이름 일치도 (85~100)
      overlap * 40 + // 장르 일치가 결정적
      Math.min(tags.length, 10) * 2; // 태그 많음 = 널리 알려진 아티스트 근사
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * 가수 정보 조회 — 원본은 MusicBrainz API(CC0), artists 테이블에 캐시 (docs/SSOT.md).
 * genreHint(곡 장르)가 있으면 동명이인 중 장르가 맞는 후보를 고른다.
 */
export async function getArtistInfo(name: string, genreHint?: string): Promise<ArtistInfo> {
  const cached = await db.select().from(schema.artists).where(eq(schema.artists.name, name));
  if (cached.length > 0) return cached[0];

  const empty: typeof schema.artists.$inferInsert = {
    name,
    type: null,
    country: null,
    beginYear: null,
    tags: null,
  };
  try {
    // 이름을 따옴표로 감싸 구문 검색 — 안 감싸면 "Sam Smith"가 artist:Sam + Smith로
    // 쪼개져 Elliott Smith 같은 성(姓)만 겹치는 아티스트가 1위로 올라온다
    const phrase = `"${name.replace(/"/g, '\\"')}"`;
    const res = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(phrase)}&fmt=json&limit=5`,
      {
        headers: { "User-Agent": "songGalaxy/0.1 (https://github.com/kaeba0616/songGalaxy)" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      // 레이트리밋/일시 오류 — 캐시하지 않고 반환해서 다음 요청 때 재시도
      return { ...empty, checkedAt: new Date() } as ArtistInfo;
    }
    const data = (await res.json()) as { artists?: MbArtist[] };
    const hit = pickCandidate(data.artists ?? [], genreHint);
    const info: typeof schema.artists.$inferInsert = hit
      ? {
          name,
          type: hit.type ?? null,
          country: hit.country ?? null,
          beginYear: hit["life-span"]?.begin?.slice(0, 4) ?? null,
          tags: hit.tags?.slice(0, 5).map((t) => t.name) ?? null,
        }
      : empty;
    await db.insert(schema.artists).values(info).onConflictDoNothing();
    return { ...info, checkedAt: new Date() } as ArtistInfo;
  } catch {
    return { ...empty, checkedAt: new Date() } as ArtistInfo;
  }
}
