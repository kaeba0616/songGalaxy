import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { baseTitleKey, primaryArtistKey } from "@/lib/match-key";

export interface Media {
  artworkUrl: string | null;
  previewUrl: string | null;
}

/** 외부 조회 결과. ok=false는 네트워크 실패 — 캐시하지 않고 다음에 다시 시도한다 */
interface Lookup {
  ok: boolean;
  media: Media;
}

const EMPTY: Media = { artworkUrl: null, previewUrl: null };

/**
 * 아트도 미리듣기도 못 구한 곡을 다시 조회하기까지의 유예 기간.
 *
 * 빈 결과를 "이 곡엔 미디어가 없다"로 영구 캐시하면 안 된다. 실제로 그렇게
 * 굳어버린 324곡을 나중에 다시 조회해보니 Sam Smith, Beyoncé처럼 스토어에
 * 멀쩡히 있는 곡들이 전부 정상적으로 나왔다 — 조회 당시 외부 API가 잠깐
 * 결과를 못 준 것이었다(응답은 200이라 실패로도 잡히지 않는다).
 *
 * 그렇다고 매번 재조회하면 진짜 없는 곡 때문에 외부 API를 계속 두들기게 되므로,
 * 이 기간이 지난 빈 캐시만 다시 조회한다.
 */
const EMPTY_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deezer의 미리듣기 URL은 서명이 붙은 한시적 링크다. 만료되면 403을 준다.
 *
 * 실측(2026-08-11): 캐시된 Deezer URL 15건이 전부 403인데, 같은 곡을 그 자리에서
 * 다시 검색해 받은 URL은 200에 audio/mpeg 480KB였다. 브라우저 UA와 Referer를 붙여도
 * 캐시된 쪽은 그대로 403이었으므로 우리 요청 방식이나 IP 문제가 아니라 만료가 맞다.
 *
 * 만료된 링크를 그대로 내보내면 재생 버튼은 멀쩡히 보이는데 누르면 즉시 끊긴다.
 * 그래서 이 호스트의 미리듣기만은 캐시를 믿지 않고 읽을 때마다 새로 받는다.
 * 앨범아트는 호스트가 다르고(`cdn-images.dzcdn.net`) 만료되지 않으므로
 * (실측 10/10 정상) 그대로 캐시한다.
 */
const EPHEMERAL_PREVIEW_HOST = "cdnt-preview.dzcdn.net";

const isEphemeralPreview = (url: string | null | undefined): boolean =>
  typeof url === "string" && url.includes(EPHEMERAL_PREVIEW_HOST);

const looselyEqual = (a: string, b: string) =>
  !!a && !!b && (a === b || a.includes(b) || b.includes(a));

/**
 * 검색 결과가 그 곡일 가능성을 점수로 매긴다 (2 = 제목·가수 둘 다, 1 = 하나만, 0 = 없음).
 *
 * 둘 다 일치할 것을 요구하면 안 된다. 스토어는 표기를 자주 바꿔서,
 * 한국 스토어는 가수명을 한글로("ENHYPEN" → "엔하이픈"), 일본 곡은 제목을
 * 로마자로 돌려주는 일이 흔하다. 그러면 멀쩡한 곡이 통째로 걸러진다.
 */
function matchScore(
  want: { title: string; artist: string },
  got: { title: string; artist: string },
): number {
  const artistOk = looselyEqual(primaryArtistKey(want.artist), primaryArtistKey(got.artist));
  const titleOk = looselyEqual(baseTitleKey(want.title), baseTitleKey(got.title));
  return (artistOk ? 1 : 0) + (titleOk ? 1 : 0);
}

/** 가장 그럴듯한 결과를 고른다. 아무것도 확신할 수 없으면 첫 결과 (검증 도입 이전 동작) */
function pickBest<T>(
  candidates: T[],
  want: { title: string; artist: string },
  read: (c: T) => { title: string; artist: string } | null,
): T | undefined {
  let best: T | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    const got = read(c);
    if (!got) continue;
    const score = matchScore(want, got);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best ?? candidates[0];
}

/** 1순위 — iTunes Search API (무키). 앨범아트 해상도가 높고 한국 곡 커버리지가 좋다 */
async function fromItunes(title: string, artist: string): Promise<Lookup> {
  try {
    const term = encodeURIComponent(`${title} ${artist}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=3&country=KR`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return { ok: false, media: EMPTY };
    const data = (await res.json()) as {
      results?: { trackName?: string; artistName?: string; artworkUrl100?: string; previewUrl?: string }[];
    };
    const hit = pickBest(data.results ?? [], { title, artist }, (r) =>
      r.trackName && r.artistName ? { title: r.trackName, artist: r.artistName } : null,
    );
    return {
      ok: true,
      media: {
        // 100px 아트워크 URL을 300px로 승격 (iTunes URL 규칙)
        artworkUrl: hit?.artworkUrl100?.replace("100x100", "300x300") ?? null,
        previewUrl: hit?.previewUrl ?? null,
      },
    };
  } catch {
    return { ok: false, media: EMPTY };
  }
}

/**
 * 2순위 — Deezer 공개 API (무키).
 * iTunes 스토어에 없는 곡(인도 영화음악 등)을 메운다. 실측으로 iTunes가 놓친 곡을 찾아냈다.
 */
async function fromDeezer(title: string, artist: string): Promise<Lookup> {
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=3`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, media: EMPTY };
    const data = (await res.json()) as {
      data?: {
        title?: string;
        preview?: string;
        artist?: { name?: string };
        album?: { cover_big?: string; cover_medium?: string };
      }[];
    };
    const hit = pickBest(data.data ?? [], { title, artist }, (r) =>
      r.title && r.artist?.name ? { title: r.title, artist: r.artist.name } : null,
    );
    return {
      ok: true,
      media: {
        artworkUrl: hit?.album?.cover_big ?? hit?.album?.cover_medium ?? null,
        previewUrl: hit?.preview ?? null,
      },
    };
  } catch {
    return { ok: false, media: EMPTY };
  }
}

/**
 * 앨범아트/30초 미리듣기 조회 — 원본은 iTunes → Deezer 순, songs 테이블에 캐시 (docs/SSOT.md).
 * /api/enrich 라우트와 곡 상세 페이지가 공용으로 사용한다.
 * 이미 조회한 곡(enrichedAt 존재)은 외부 호출 없이 캐시로 응답한다.
 *
 * 미리듣기는 링크만 저장한다. 파일을 받아 보관하지 않는다 (양쪽 API 모두 그 조건이다).
 */
export async function enrichSongs(ids: number[]): Promise<Record<number, Media>> {
  if (ids.length === 0) return {};
  const rows = await db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.songs.artist,
      artworkUrl: schema.songs.artworkUrl,
      previewUrl: schema.songs.previewUrl,
      enrichedAt: schema.songs.enrichedAt,
    })
    .from(schema.songs)
    .where(inArray(schema.songs.id, ids));

  const result: Record<number, Media> = {};
  /** 캐시로 응답한 곡 — 만료되는 미리듣기라면 아래에서 새 링크로 갈아끼운다 */
  const servedFromCache: typeof rows = [];
  for (const row of rows) {
    // 하나라도 건진 캐시는 그대로 쓰고, 통째로 빈 캐시는 유예 기간이 지나면 다시 조회한다
    const cached =
      row.artworkUrl !== null ||
      row.previewUrl !== null ||
      Date.now() - (row.enrichedAt?.getTime() ?? 0) < EMPTY_RETRY_MS;
    if (row.enrichedAt && cached) {
      result[row.id] = { artworkUrl: row.artworkUrl, previewUrl: row.previewUrl };
      servedFromCache.push(row);
      continue;
    }

    const itunes = await fromItunes(row.title, row.artist);
    let media = itunes.media;
    let responded = itunes.ok;
    // 미리듣기를 못 구했을 때만 Deezer를 부른다 (불필요한 외부 호출을 줄인다)
    if (!media.previewUrl) {
      const deezer = await fromDeezer(row.title, row.artist);
      responded = responded || deezer.ok;
      media = {
        artworkUrl: media.artworkUrl ?? deezer.media.artworkUrl,
        previewUrl: deezer.media.previewUrl,
      };
    }

    // 두 곳 다 응답하지 못했으면 캐시하지 않는다 — 다음 요청에서 재시도된다
    if (!responded) {
      result[row.id] = EMPTY;
      continue;
    }
    await db
      .update(schema.songs)
      .set({ artworkUrl: media.artworkUrl, previewUrl: media.previewUrl, enrichedAt: new Date() })
      .where(inArray(schema.songs.id, [row.id]));
    result[row.id] = media;
  }

  /**
   * 캐시로 응답한 곡 중 만료되는 미리듣기는 새 링크로 갈아끼운다.
   * 새로 못 받으면 null로 둔다 — 죽은 링크로 재생 버튼을 띄우느니 없는 게 낫다.
   * 방금 조회한 곡은 이미 새 링크라 건너뛴다.
   */
  const stale = servedFromCache.filter((r) => isEphemeralPreview(r.previewUrl));
  if (stale.length > 0) {
    const fresh = await Promise.all(stale.map((r) => fromDeezer(r.title, r.artist)));
    stale.forEach((r, i) => {
      result[r.id] = { ...result[r.id], previewUrl: fresh[i].media.previewUrl };
    });
  }
  return result;
}
