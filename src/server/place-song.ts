import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { GALAXY_RADIUS } from "@/config/constants";
import { hashString, mulberry32 } from "@/lib/layout-math";

export interface Placement {
  themeId: number;
  x: number;
  y: number;
  z: number;
}

/**
 * 오디오 특징이 없는 신규 곡의 좌표 산출 — 태그 기반 배치 (docs/SSOT.md).
 * 장르(세부 테마) 구역 안에 시드 랜덤(재현 가능) 좌표를 만들고,
 * 성단·은하 경계를 넘지 않게 클램프한다. 기존 별 좌표는 건드리지 않는다.
 * 즉석 편입(import-song)과 주간 신곡 파이프라인이 공용으로 사용한다.
 */
export async function placeInGenre(genre: string, seedKey: string): Promise<Placement | null> {
  const [subTheme] = await db
    .select()
    .from(schema.themes)
    .where(and(eq(schema.themes.level, 2), eq(schema.themes.name, genre)));
  if (!subTheme) return null;

  const rng = mulberry32(hashString(seedKey));
  const theta = rng() * Math.PI * 2;
  const phi = Math.acos(2 * rng() - 1);
  const r = (subTheme.radius ?? 40) * 0.85 * Math.cbrt(rng());
  let x = (subTheme.posX ?? 0) + r * Math.sin(phi) * Math.cos(theta);
  let y = (subTheme.posY ?? 0) + r * Math.sin(phi) * Math.sin(theta);
  let z = (subTheme.posZ ?? 0) + r * Math.cos(phi);

  // 성단(부모) 경계 클램프
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
  // 은하 전체 반지름 클램프
  const dist = Math.hypot(x, y, z);
  if (dist > GALAXY_RADIUS) {
    const s = GALAXY_RADIUS / dist;
    x *= s; y *= s; z *= s;
  }
  return { themeId: subTheme.id, x, y, z };
}
