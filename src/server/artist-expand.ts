import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/config/env";
import { baseTitleKey, normalizeKey, primaryArtistKey } from "@/lib/match-key";
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
  deadlineMs?: number;
  onInsert?: (title: string, artist: string, popularity: number, count: number) => void;
}

interface LastfmTrack {
  name?: string;
  listeners?: string;
  mbid?: string;
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

/** 한 아티스트의 대표곡 (인기순) */
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
    const data = (await res.json()) as { toptracks?: { track?: LastfmTrack | LastfmTrack[] } };
    const track = data.toptracks?.track;
    if (!track) return [];
    return Array.isArray(track) ? track : [track];
  } catch {
    return [];
  }
}

/**
 * 은하에 곡이 많은 아티스트부터 훑는다.
 * 곡이 여럿 있는 가수일수록 그 가수의 장르·좌표가 안정적이라 결과가 좋다.
 */
async function pickArtists(limit: number): Promise<{ artist: string; genre: string }[]> {
  const rows = await db.execute<{ artist: string; genre: string }>(sql`
    SELECT artist, mode() WITHIN GROUP (ORDER BY genre) AS genre
    FROM songs
    WHERE pos_x IS NOT NULL
    GROUP BY artist
    ORDER BY count(*) DESC, artist
    LIMIT ${limit}
  `);
  return rows.rows;
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
    inserted: 0,
    timedOut: false,
  };
  if (!env.lastfmApiKey) return stats;

  const artists = await pickArtists(artistLimit);
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
    for (const row of existing) {
      known.add(normalizeKey(row.title));
      known.add(baseTitleKey(row.title));
    }

    const tracks = await fetchTopTracks(artist, perArtist * 4);
    await sleep(REQUEST_INTERVAL_MS);
    stats.candidates += tracks.length;

    let addedForArtist = 0;
    for (const track of tracks) {
      if (addedForArtist >= perArtist || stats.inserted >= totalLimit) break;
      const title = track.name?.trim();
      if (!title) continue;
      if (known.has(normalizeKey(title)) || known.has(baseTitleKey(title))) {
        stats.duplicate++;
        continue;
      }
      known.add(normalizeKey(title)); // 같은 실행 안에서의 중복도 막는다

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
