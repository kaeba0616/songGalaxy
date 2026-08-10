import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { GALAXY_RADIUS } from "@/config/constants";
import { buildNeighborPool, pointFromNeighbors } from "@/lib/neighbor-place";
import { hashString, mulberry32 } from "@/lib/layout-math";
import { baseTitleKey, normalizeKey, primaryArtistKey } from "@/lib/match-key";

export interface Placement {
  themeId: number;
  x: number;
  y: number;
  z: number;
  /** 찾아낸 오디오 특징 (곡 행에 함께 저장해 두면 다음에 다시 조회할 필요가 없다) */
  features: Record<string, number> | null;
  /** 어떤 방법으로 자리를 잡았는지 — 로그·검증용 */
  method: "features" | "artist" | "genre";
}

type Theme = typeof schema.themes.$inferSelect;

/** 성단·은하 경계 밖으로 나가지 않게 안쪽으로 당긴다 */
async function clampToBounds(
  subTheme: Theme,
  p: { x: number; y: number; z: number },
): Promise<{ x: number; y: number; z: number }> {
  let { x, y, z } = p;
  if (subTheme.parentId != null) {
    const [big] = await db
      .select()
      .from(schema.themes)
      .where(eq(schema.themes.id, subTheme.parentId));
    if (big?.radius != null) {
      const dx = x - (big.posX ?? 0);
      const dy = y - (big.posY ?? 0);
      const dz = z - (big.posZ ?? 0);
      const d = Math.hypot(dx, dy, dz);
      const maxD = big.radius * 0.98;
      if (d > maxD) {
        const s = maxD / d;
        x = (big.posX ?? 0) + dx * s;
        y = (big.posY ?? 0) + dy * s;
        z = (big.posZ ?? 0) + dz * s;
      }
    }
  }
  const dist = Math.hypot(x, y, z);
  if (dist > GALAXY_RADIUS) {
    const s = GALAXY_RADIUS / dist;
    x *= s;
    y *= s;
    z *= s;
  }
  return { x, y, z };
}

/**
 * 데이터셋 조회표에서 오디오 특징을 찾는다.
 * 제목+가수 → 부제 뗀 제목+가수 순으로 시도한다 (스토어마다 표기가 다르다).
 */
async function lookupFeatures(
  title: string,
  artist: string,
): Promise<Record<string, number> | null> {
  const titleKey = normalizeKey(title);
  const baseKey = baseTitleKey(title);
  const artistKey = primaryArtistKey(artist);
  if (!artistKey || (!titleKey && !baseKey)) return null;

  const [hit] = await db
    .select({ features: schema.datasetFeatures.features })
    .from(schema.datasetFeatures)
    .where(
      and(
        eq(schema.datasetFeatures.artistKey, artistKey),
        or(
          eq(schema.datasetFeatures.titleKey, titleKey),
          eq(schema.datasetFeatures.baseKey, baseKey),
        ),
      ),
    )
    .limit(1);
  return hit?.features ?? null;
}

/**
 * 같은 장르에서 특징이 가장 가까운 곡들의 좌표 중심에 놓는다.
 *
 * 배치 스크립트가 쓴 PCA 축은 저장돼 있지 않지만, 기존 곡들이 특징과 좌표를
 * 둘 다 갖고 있으므로 "가까운 이웃의 자리"를 빌리면 같은 성질을 얻을 수 있다.
 * 특징 스케일이 제각각(tempo는 세 자리, valence는 0~1)이라 z-score로 맞춘 뒤 비교한다.
 */
async function placeByFeatures(
  subTheme: Theme,
  genre: string,
  features: Record<string, number>,
  rng: () => number,
): Promise<{ x: number; y: number; z: number } | null> {
  const neighbours = await db
    .select({
      x: schema.songs.posX,
      y: schema.songs.posY,
      z: schema.songs.posZ,
      features: schema.songs.features,
    })
    .from(schema.songs)
    .where(
      and(
        eq(schema.songs.genre, genre),
        isNotNull(schema.songs.posX),
        isNotNull(schema.songs.features),
      ),
    );
  const pool = buildNeighborPool(
    neighbours
      .filter((n) => n.x != null && n.y != null && n.z != null)
      .map((n) => ({ x: n.x!, y: n.y!, z: n.z!, features: n.features })),
  );
  if (!pool) return null;
  return pointFromNeighbors(pool, features, rng, (subTheme.radius ?? 40) * 0.05);
}

/**
 * 특징을 못 찾았을 때 — 같은 가수의 기존 곡 근처 (같은 가수 곡은 대체로 소리가 비슷하다).
 *
 * 같은 장르의 곡만 먼저 본다. 한 가수의 곡이 여러 장르에 흩어져 있으면
 * 전체 평균이 그 사이 빈 공간에 떨어져, 정작 어느 곡과도 가깝지 않게 된다
 * (Bethel Music: ambient 53곡 + world-music 25곡 → 중심이 두 무리 사이).
 */
async function placeByArtist(
  subTheme: Theme,
  genre: string,
  artist: string,
  rng: () => number,
): Promise<{ x: number; y: number; z: number } | null> {
  const sameArtist = and(
    sql`lower(${schema.songs.artist}) = lower(${artist})`,
    isNotNull(schema.songs.posX),
  );
  const cols = { x: schema.songs.posX, y: schema.songs.posY, z: schema.songs.posZ };
  let rows = await db
    .select(cols)
    .from(schema.songs)
    .where(and(sameArtist, eq(schema.songs.genre, genre)))
    .limit(20);
  if (rows.length === 0) {
    rows = await db.select(cols).from(schema.songs).where(sameArtist).limit(20);
  }
  if (rows.length === 0) return null;
  const n = rows.length;
  const jitter = (subTheme.radius ?? 40) * 0.15;
  return {
    x: rows.reduce((s, r) => s + r.x!, 0) / n + (rng() * 2 - 1) * jitter,
    y: rows.reduce((s, r) => s + r.y!, 0) / n + (rng() * 2 - 1) * jitter,
    z: rows.reduce((s, r) => s + r.z!, 0) / n + (rng() * 2 - 1) * jitter,
  };
}

/** 마지막 수단 — 장르 구역 안 시드 랜덤 (기존 동작) */
function placeRandom(subTheme: Theme, rng: () => number): { x: number; y: number; z: number } {
  const theta = rng() * Math.PI * 2;
  const phi = Math.acos(2 * rng() - 1);
  const r = (subTheme.radius ?? 40) * 0.85 * Math.cbrt(rng());
  return {
    x: (subTheme.posX ?? 0) + r * Math.sin(phi) * Math.cos(theta),
    y: (subTheme.posY ?? 0) + r * Math.sin(phi) * Math.sin(theta),
    z: (subTheme.posZ ?? 0) + r * Math.cos(phi),
  };
}

/**
 * 신규 곡의 좌표 산출 (docs/SSOT.md).
 *
 * "비슷한 소리끼리 모인다"는 은하의 규칙을 신규 곡에도 지키기 위해
 * ① 데이터셋 조회표에서 오디오 특징을 찾아 가까운 이웃 옆에 놓고,
 * ② 못 찾으면 같은 가수 곡 근처,
 * ③ 그것도 없으면 장르 구역 안 랜덤 순으로 물러난다.
 * 기존 곡의 좌표는 어떤 경우에도 건드리지 않는다.
 */
export async function placeSong(args: {
  genre: string;
  seedKey: string;
  title: string;
  artist: string;
}): Promise<Placement | null> {
  const { genre, seedKey, title, artist } = args;
  const [subTheme] = await db
    .select()
    .from(schema.themes)
    .where(and(eq(schema.themes.level, 2), eq(schema.themes.name, genre)));
  if (!subTheme) return null;

  const rng = mulberry32(hashString(seedKey));
  const features = await lookupFeatures(title, artist);

  let method: Placement["method"] = "genre";
  let point: { x: number; y: number; z: number } | null = null;

  if (features) {
    point = await placeByFeatures(subTheme, genre, features, rng);
    if (point) method = "features";
  }
  if (!point) {
    point = await placeByArtist(subTheme, genre, artist, rng);
    if (point) method = "artist";
  }
  if (!point) point = placeRandom(subTheme, rng);

  const clamped = await clampToBounds(subTheme, point);
  return { themeId: subTheme.id, ...clamped, features, method };
}
