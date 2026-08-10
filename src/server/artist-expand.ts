import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/config/env";
import { normalizeKey, primaryArtistKey, titleAliases } from "@/lib/match-key";
import { placeSong } from "./place-song";

/**
 * 아티스트 대표곡 확장 (은하를 채우는 세 번째 경로)
 *
 * "우리가 못 찾은 좋은 노래"의 상당수는 낯선 가수의 곡이 아니라
 * 이미 은하에 있는 가수의 다른 대표곡이다. 그래서 은하의 아티스트 목록을 돌며
 * Last.fm의 대표곡 중 우리에게 없는 곡을 채운다.
 *
 * 이 경로의 이점:
 * - 장르를 추정할 필요가 없다. 그 아티스트의 기존 곡 장르를 물려받는다.
 * - 좌표도 잘 잡힌다. 특징 조회표에 없더라도 "같은 가수 곡 근처" 폴백이 정확히 맞는다.
 * - 인기도가 실제 청취자 수 기반이라 고정값(45/50)보다 정직하다.
 *
 * 기존 행은 건드리지 않고, batch_id로 통째로 롤백할 수 있다.
 */

const SOURCE = "lastfm";
const API = "https://ws.audioscrobbler.com/2.0/";
/** Last.fm 권장 한도(초당 5회)보다 넉넉히 느리게 */
const REQUEST_INTERVAL_MS = 350;

export interface ExpandStats {
  batchId: string;
  /** 조회한 아티스트 수 */
  artists: number;
  /** 후보로 받아온 곡 수 */
  candidates: number;
  /** 이미 은하에 있어 건너뛴 곡 */
  duplicate: number;
  /** 좌표를 잡지 못해 건너뛴 곡 */
  noPlacement: number;
  /** 청취자가 너무 적어 건너뛴 곡 (표기 변형·비주류 트랙) */
  tooQuiet: number;
  inserted: number;
  timedOut: boolean;
}

export interface ExpandOptions {
  /** 이번 실행에서 훑을 아티스트 수 */
  artistLimit?: number;
  /** 아티스트당 새로 넣을 최대 곡 수 */
  perArtist?: number;
  /** 이번 실행 전체 상한 (은하가 갑자기 불어나는 것을 막는다) */
  totalLimit?: number;
  /** 이 인기도에 못 미치는 가수는 건너뛴다 (무명 1곡짜리 가수에 API 호출을 낭비하지 않기 위함) */
  minPopularity?: number;
  /** 특정 가수만 보강한다. 지정하면 자동 선정 대신 이 목록만 훑는다 */
  only?: string[];
  /**
   * 그 가수 최고 인기곡 청취자 수의 이 비율에 못 미치면 넣지 않는다.
   *
   * 표기 변형(로마자·번역 제목)을 거르는 현실적인 수단이다. Last.fm은 한 곡을
   * "サクラキミワタシ"와 "Sakura Kimi Watashi"처럼 글자가 하나도 안 겹치게
   * 따로 등록하는데, 이런 쌍은 문자열로도 MBID로도 구분되지 않는다
   * (실측: 중복 표기에도 MBID가 붙어 있어 MBID는 단서가 못 된다).
   * 다만 스크로블이 원제에 몰려서 변형은 청취자가 한 자릿수 % 수준으로 적다.
   * 부수적으로 "거의 아무도 안 듣는 곡"을 거르는 품질 기준 역할도 한다.
   */
  minListenerShare?: number;
  /**
   * 원제(비ASCII 제목)에 적용하는 완화된 하한선.
   *
   * 로마자·번역 중복은 예외 없이 ASCII 제목이고 청취자가 적다. 반대로 일본어·한글
   * 원제는 청취자가 적어도 진짜 곡이다(예: tuki.의 "第三惑星" 677명). 같은 기준을
   * 쓰면 이런 곡을 잃으므로, 원제에는 낮은 문턱을 준다.
   */
  minListenerShareNonAscii?: number;
  deadlineMs?: number;
  onInsert?: (title: string, artist: string, popularity: number, count: number) => void;
}

interface LastfmTrack {
  name?: string;
  listeners?: string;
  mbid?: string;
  artist?: { name?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 청취자 수 → 0~100 인기도 (로그 스케일).
 * 1천 명 ≈ 20, 10만 명 ≈ 60, 100만 명 ≈ 80.
 * 데이터셋 인기도(43~100)와 대략 같은 자에 놓이도록 맞춘 값이다.
 */
export function listenersToPopularity(listeners: number): number {
  if (!Number.isFinite(listeners) || listeners <= 0) return 1;
  return Math.max(1, Math.min(99, Math.round(20 * Math.log10(listeners) - 40)));
}

/**
 * 한 아티스트의 대표곡 (인기순).
 *
 * autocorrect가 엉뚱한 동명 가수로 넘겨버리는 일이 있어(짧은 이름일수록 위험),
 * 응답이 우리가 요청한 가수의 것이 맞는지 확인하고 아니면 통째로 버린다.
 */
async function fetchTopTracks(artist: string, limit: number): Promise<LastfmTrack[]> {
  const key = env.lastfmApiKey;
  if (!key) return [];
  const params = new URLSearchParams({
    method: "artist.gettoptracks",
    artist,
    api_key: key,
    format: "json",
    limit: String(limit),
    autocorrect: "1",
  });
  try {
    const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      toptracks?: { track?: LastfmTrack | LastfmTrack[]; "@attr"?: { artist?: string } };
    };
    const wanted = primaryArtistKey(artist);
    const corrected = data.toptracks?.["@attr"]?.artist;
    if (corrected && primaryArtistKey(corrected) !== wanted) return [];
    const track = data.toptracks?.track;
    if (!track) return [];
    const list = Array.isArray(track) ? track : [track];
    // 트랙별 가수명도 확인 (컴필레이션·피처링이 섞여 들어오는 경우 방지)
    return list.filter((t) => {
      const name = t.artist?.name;
      return !name || primaryArtistKey(name) === wanted;
    });
  } catch {
    return [];
  }
}

/**
 * 은하에 곡이 "적은" 아티스트부터 훑는다.
 *
 * 처음엔 곡이 많은 가수부터 훑었는데, 그런 가수는 이미 잘 채워져 있어
 * 후보의 91%가 중복이었다. 정작 비어 있는 쪽은 곡이 한두 개뿐인 가수다
 * (예: tuki. — 데이터셋이 2022년 스냅샷이라 2023년 데뷔 가수는 1곡뿐이었다).
 * 같은 조건이면 대표곡 인기도가 높은 가수를 먼저 본다.
 */
async function pickArtists(
  limit: number,
  minPopularity: number,
): Promise<{ artist: string; genre: string }[]> {
  const rows = await db.execute<{ artist: string; genre: string }>(sql`
    SELECT artist, mode() WITHIN GROUP (ORDER BY genre) AS genre
    FROM songs
    WHERE pos_x IS NOT NULL
    GROUP BY artist
    HAVING max(popularity) >= ${minPopularity}
    ORDER BY count(*) ASC, max(popularity) DESC, artist
    LIMIT ${limit}
  `);
  return rows.rows;
}

/** 이름으로 지정한 가수들 (은하에 있어야 장르를 물려받을 수 있다) */
async function namedArtists(names: string[]): Promise<{ artist: string; genre: string }[]> {
  const out: { artist: string; genre: string }[] = [];
  for (const name of names) {
    const rows = await db.execute<{ artist: string; genre: string }>(sql`
      SELECT artist, mode() WITHIN GROUP (ORDER BY genre) AS genre
      FROM songs
      WHERE pos_x IS NOT NULL AND lower(artist) = lower(${name})
      GROUP BY artist
    `);
    out.push(...rows.rows);
  }
  return out;
}

export async function expandArtists(opts: ExpandOptions = {}): Promise<ExpandStats> {
  const artistLimit = opts.artistLimit ?? 50;
  const perArtist = opts.perArtist ?? 3;
  const totalLimit = opts.totalLimit ?? 150;
  const batchId = `lastfm-expand-${new Date().toISOString().slice(0, 10)}`;
  const stats: ExpandStats = {
    batchId,
    artists: 0,
    candidates: 0,
    duplicate: 0,
    noPlacement: 0,
    tooQuiet: 0,
    inserted: 0,
    timedOut: false,
  };
  if (!env.lastfmApiKey) return stats;

  const artists = opts.only?.length
    ? await namedArtists(opts.only)
    : await pickArtists(artistLimit, opts.minPopularity ?? 35);
  for (const { artist, genre } of artists) {
    if (stats.inserted >= totalLimit) break;
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      stats.timedOut = true;
      break;
    }
    stats.artists++;

    // 이 아티스트의 기존 곡 제목 (중복 판정용) — 표기 차이를 흡수해 비교한다
    const existing = await db
      .select({ title: schema.songs.title })
      .from(schema.songs)
      .where(sql`lower(${schema.songs.artist}) = lower(${artist})`);
    const known = new Set<string>();
    for (const row of existing) for (const k of titleAliases(row.title)) known.add(k);

    const tracks = await fetchTopTracks(artist, perArtist * 4);
    await sleep(REQUEST_INTERVAL_MS);
    stats.candidates += tracks.length;

    // 이 가수 최고 인기곡 기준으로 하한선을 잡는다 (응답이 인기순이라 첫 곡이 최고)
    const topListeners = Number(tracks[0]?.listeners ?? 0);
    const asciiFloor = topListeners * (opts.minListenerShare ?? 0.05);
    const nonAsciiFloor = topListeners * (opts.minListenerShareNonAscii ?? 0.02);

    let addedForArtist = 0;
    for (const track of tracks) {
      if (addedForArtist >= perArtist || stats.inserted >= totalLimit) break;
      const title = track.name?.trim();
      if (!title) continue;
      const isAscii = !/[^ -~]/.test(title);
      if (Number(track.listeners ?? 0) < (isAscii ? asciiFloor : nonAsciiFloor)) {
        stats.tooQuiet++;
        continue;
      }
      const aliases = titleAliases(title);
      if (aliases.some((k) => known.has(k))) {
        stats.duplicate++;
        continue;
      }
      // 같은 실행 안에서의 중복도 막는다 — Last.fm은 한 곡을 원제·"원제 - 로마자"·
      // 로마자 단독으로 각각 등록해 두므로 별칭을 전부 기억해야 한다
      for (const k of aliases) known.add(k);

      const sourceId = track.mbid || `${primaryArtistKey(artist)}:${normalizeKey(title)}`;
      const placement = await placeSong({
        genre,
        seedKey: `${SOURCE}:${sourceId}`,
        title,
        artist,
      });
      if (!placement) {
        stats.noPlacement++;
        continue;
      }

      const popularity = listenersToPopularity(Number(track.listeners ?? 0));
      const [inserted] = await db
        .insert(schema.songs)
        .values({
          title,
          artist,
          album: null,
          releaseYear: null,
          source: SOURCE,
          sourceId,
          genre,
          themeId: placement.themeId,
          posX: placement.x,
          posY: placement.y,
          posZ: placement.z,
          features: placement.features,
          popularity,
          batchId,
        })
        .onConflictDoNothing({ target: [schema.songs.source, schema.songs.sourceId] })
        .returning({ id: schema.songs.id });
      if (!inserted) {
        stats.duplicate++;
        continue;
      }
      stats.inserted++;
      addedForArtist++;
      opts.onInsert?.(title, artist, popularity, stats.inserted);
    }
  }
  return stats;
}
