import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { itunesGenreToGenre } from "@/config/genre-clusters";
import { GALAXY_RADIUS } from "@/config/constants";
import { hashString, mulberry32 } from "@/lib/layout-math";

/** 검색 즉석 편입 배치 식별자 — 롤백 시 이 값으로 삭제 (docs/SSOT.md) */
const USER_IMPORT_BATCH = "user-import";
const SOURCE = "itunes";

export interface ExternalSong {
  itunesId: number;
  title: string;
  artist: string;
  album: string | null;
  genre: string;
  artworkUrl: string | null;
  previewUrl: string | null;
  releaseYear: number | null;
  /** 이미 은하에 있는 곡이면 해당 곡 id */
  existingSongId: number | null;
}

interface ItunesTrack {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  trackExplicitness?: string;
}

async function itunesFetch(path: string): Promise<ItunesTrack[]> {
  const res = await fetch(`https://itunes.apple.com/${path}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: ItunesTrack[] };
  return data.results ?? [];
}

/**
 * 은하 밖 검색 — iTunes에서 곡 후보를 찾는다 (무료·무키).
 * KR 스토어 우선, 결과가 없으면 JP → US 순으로 폴백 (일본 신인 등 커버).
 */
export async function searchExternal(q: string, limit = 5): Promise<ExternalSong[]> {
  const term = encodeURIComponent(q);
  let tracks: ItunesTrack[] = [];
  for (const country of ["KR", "JP", "US"]) {
    tracks = await itunesFetch(`search?term=${term}&entity=song&limit=${limit}&country=${country}`);
    if (tracks.length > 0) break;
  }
  const valid = tracks.filter((t) => t.trackId && t.trackName && t.artistName);

  // 이미 편입된 곡 표시 (source=itunes, sourceId 일치)
  const results: ExternalSong[] = [];
  for (const t of valid) {
    const [existing] = await db
      .select({ id: schema.songs.id })
      .from(schema.songs)
      .where(and(eq(schema.songs.source, SOURCE), eq(schema.songs.sourceId, String(t.trackId))));
    results.push({
      itunesId: t.trackId!,
      title: t.trackName!,
      artist: t.artistName!,
      album: t.collectionName ?? null,
      genre: t.primaryGenreName ?? "",
      artworkUrl: t.artworkUrl100?.replace("100x100", "300x300") ?? null,
      previewUrl: t.previewUrl ?? null,
      releaseYear: t.releaseDate ? Number(t.releaseDate.slice(0, 4)) : null,
      existingSongId: existing?.id ?? null,
    });
  }
  return results;
}

/**
 * iTunes 곡을 은하에 새 별로 편입한다 (D10 확장 — 유저 검색 트리거).
 * 장르 매핑(SSOT: genre-clusters.ts) → 세부 테마의 구역 안에 시드 랜덤 좌표 부여.
 * 기존 별 좌표는 건드리지 않는다 (좌표 불변). 멱등: 이미 있으면 그 곡 id 반환.
 */
export async function importFromItunes(itunesId: number): Promise<number | null> {
  const sourceId = String(itunesId);
  const [existing] = await db
    .select({ id: schema.songs.id })
    .from(schema.songs)
    .where(and(eq(schema.songs.source, SOURCE), eq(schema.songs.sourceId, sourceId)));
  if (existing) return existing.id;

  const [track] = await itunesFetch(`lookup?id=${itunesId}&country=KR`).then(async (r) =>
    r.length > 0 ? r : itunesFetch(`lookup?id=${itunesId}&country=JP`),
  );
  if (!track?.trackId || !track.trackName || !track.artistName) return null;

  const genre = itunesGenreToGenre(track.primaryGenreName ?? "");
  let [subTheme] = await db
    .select()
    .from(schema.themes)
    .where(and(eq(schema.themes.level, 2), eq(schema.themes.name, genre)));
  if (!subTheme) {
    [subTheme] = await db
      .select()
      .from(schema.themes)
      .where(and(eq(schema.themes.level, 2), eq(schema.themes.name, "pop")));
  }
  if (!subTheme) return null;

  // 세부 테마 구 안에 시드 랜덤 좌표 (구 내부 균일 분포), 은하 반지름 클램프
  const rng = mulberry32(hashString(`${SOURCE}:${sourceId}`));
  const theta = rng() * Math.PI * 2;
  const phi = Math.acos(2 * rng() - 1);
  const r = (subTheme.radius ?? 40) * 0.85 * Math.cbrt(rng());
  let x = (subTheme.posX ?? 0) + r * Math.sin(phi) * Math.cos(theta);
  let y = (subTheme.posY ?? 0) + r * Math.sin(phi) * Math.sin(theta);
  let z = (subTheme.posZ ?? 0) + r * Math.cos(phi);
  const dist = Math.hypot(x, y, z);
  if (dist > GALAXY_RADIUS) {
    const s = GALAXY_RADIUS / dist;
    x *= s; y *= s; z *= s;
  }

  const [inserted] = await db
    .insert(schema.songs)
    .values({
      title: track.trackName,
      artist: track.artistName,
      album: track.collectionName ?? null,
      releaseYear: track.releaseDate ? Number(track.releaseDate.slice(0, 4)) : null,
      source: SOURCE,
      sourceId,
      genre,
      themeId: subTheme.id,
      posX: x,
      posY: y,
      posZ: z,
      features: null, // 오디오 특징 없음 — 태그 기반 배치
      popularity: 50, // iTunes에는 인기도가 없어 중간값으로 시작
      explicit: track.trackExplicitness === "explicit",
      durationMs: track.trackTimeMillis ?? null,
      batchId: USER_IMPORT_BATCH,
      artworkUrl: track.artworkUrl100?.replace("100x100", "300x300") ?? null,
      previewUrl: track.previewUrl ?? null,
      enrichedAt: new Date(),
    })
    .onConflictDoNothing({ target: [schema.songs.source, schema.songs.sourceId] })
    .returning({ id: schema.songs.id });
  if (inserted) return inserted.id;
  // 동시 요청으로 이미 삽입된 경우
  const [raced] = await db
    .select({ id: schema.songs.id })
    .from(schema.songs)
    .where(and(eq(schema.songs.source, SOURCE), eq(schema.songs.sourceId, sourceId)));
  return raced?.id ?? null;
}
