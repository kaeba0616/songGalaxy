/**
 * 특징 공간 최근접 이웃 배치 — 좌표 산출의 공용 수학 (SSOT).
 *
 * 배치 스크립트가 쓴 PCA 축은 저장돼 있지 않지만, 기존 곡들이 오디오 특징과
 * 좌표를 둘 다 갖고 있으므로 "가까운 이웃의 자리를 빌리면" 같은 성질을 얻는다.
 * 곡 하나씩 넣는 경로(src/server/place-song.ts)와 대량 적재 스크립트가
 * 반드시 같은 규칙을 써야 하므로 여기 한 곳에만 둔다.
 */
import { AUDIO_FEATURE_KEYS, GALAXY_RADIUS, PLACEMENT_NEIGHBORS } from "@/config/constants";

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface NeighborPool {
  /** 좌표와 정규화된 특징 벡터를 함께 가진 기존 곡들 */
  items: { p: Point3; vec: number[] }[];
  mean: number[];
  std: number[];
}

/** 원 특징 → 정규화 벡터 */
function toVec(features: Record<string, number> | null, mean: number[], std: number[]): number[] {
  return AUDIO_FEATURE_KEYS.map((key, j) => (Number(features?.[key] ?? 0) - mean[j]) / std[j]);
}

/**
 * 같은 장르 기존 곡들로 비교용 풀을 만든다.
 * 특징 스케일이 제각각(tempo는 세 자리, valence는 0~1)이라 장르 안에서 z-score로 맞춘다.
 */
export function buildNeighborPool(
  rows: { x: number; y: number; z: number; features: Record<string, number> | null }[],
): NeighborPool | null {
  if (rows.length < PLACEMENT_NEIGHBORS) return null;
  const mean: number[] = [];
  const std: number[] = [];
  AUDIO_FEATURE_KEYS.forEach((key, j) => {
    const vals = rows.map((r) => Number(r.features?.[key] ?? 0));
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
    mean[j] = m;
    std[j] = Math.sqrt(v) || 1;
  });
  return {
    items: rows.map((r) => ({ p: { x: r.x, y: r.y, z: r.z }, vec: toVec(r.features, mean, std) })),
    mean,
    std,
  };
}

/**
 * 특징이 가장 가까운 이웃들의 좌표를 거리 가중 평균한 자리.
 * 이웃과 완전히 겹치지 않도록 아주 작은 흔들림만 더한다.
 */
export function pointFromNeighbors(
  pool: NeighborPool,
  features: Record<string, number>,
  rng: () => number,
  jitter: number,
): Point3 {
  const target = toVec(features, pool.mean, pool.std);
  const scored = pool.items
    .map((item) => {
      let d2 = 0;
      for (let j = 0; j < target.length; j++) d2 += (item.vec[j] - target[j]) ** 2;
      return { p: item.p, d: Math.sqrt(d2) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, PLACEMENT_NEIGHBORS);

  let sx = 0, sy = 0, sz = 0, sw = 0;
  for (const { p, d } of scored) {
    const w = 1 / (d + 0.1); // 가까운 이웃일수록 크게 반영
    sx += p.x * w;
    sy += p.y * w;
    sz += p.z * w;
    sw += w;
  }
  return {
    x: sx / sw + (rng() * 2 - 1) * jitter,
    y: sy / sw + (rng() * 2 - 1) * jitter,
    z: sz / sw + (rng() * 2 - 1) * jitter,
  };
}

/** 성단·은하 경계 밖으로 나가지 않게 안쪽으로 당긴다 */
export function clampPoint(
  p: Point3,
  parent: { posX: number | null; posY: number | null; posZ: number | null; radius: number | null } | null,
): Point3 {
  let { x, y, z } = p;
  if (parent?.radius != null) {
    const dx = x - (parent.posX ?? 0);
    const dy = y - (parent.posY ?? 0);
    const dz = z - (parent.posZ ?? 0);
    const d = Math.hypot(dx, dy, dz);
    const maxD = parent.radius * 0.98;
    if (d > maxD) {
      const s = maxD / d;
      x = (parent.posX ?? 0) + dx * s;
      y = (parent.posY ?? 0) + dy * s;
      z = (parent.posZ ?? 0) + dz * s;
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
