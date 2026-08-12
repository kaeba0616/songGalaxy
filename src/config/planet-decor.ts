/**
 * 행성 꾸미기 카탈로그와 자리 계산 — SSOT (docs/SSOT.md).
 *
 * 여기에는 three.js를 들이지 않는다. 이 파일은 서버(토글 검증·API)와 /me UI도
 * 함께 읽는데, three를 import하면 서버 번들이 3D 라이브러리를 통째로 끌어온다.
 * 실제 도형을 만드는 코드는 `src/galaxy/planet-decor-objects.ts`에 있고,
 * 둘을 잇는 것은 slug다.
 */
import { hashString, mulberry32 } from "@/lib/layout-math";

export interface PlanetDecorItem {
  slug: string;
  label: string;
  /** ground면 지면 위, sky면 하늘 돔 위에 놓인다 */
  place: "ground" | "sky";
}

/** 카탈로그. 항목을 빼도 저장된 slug는 지우지 않는다 — 되돌리면 다시 보이는 편이 낫다 */
export const PLANET_DECOR: PlanetDecorItem[] = [
  { slug: "moon", label: "달", place: "sky" },
  { slug: "trees", label: "나무", place: "ground" },
  { slug: "rocks", label: "바위", place: "ground" },
  { slug: "obelisk", label: "오벨리스크", place: "ground" },
  { slug: "lighthouse", label: "등대", place: "ground" },
  { slug: "lake", label: "호수", place: "ground" },
];

/** 카탈로그에 있는 slug인지 — 서버가 저장 전에 거르는 유일한 관문이다 */
export function isDecorSlug(slug: string): boolean {
  return PLANET_DECOR.some((d) => d.slug === slug);
}

/** 지면 구의 반경과 중심 깊이 — enterSky가 만드는 지면과 같은 값이어야 한다 */
const GROUND_RADIUS = 300;
const GROUND_CENTER_BELOW = 298.5;

/**
 * 오브젝트가 놓일 자리. 좌표를 저장하지 않고 매번 여기서 다시 만든다 —
 * 언덕 실루엣이 `hashString("hill:" + userId)`로 정해지는 것과 같은 방식이다.
 * 항목마다 시드를 달리해 한 사람의 오브젝트들이 겹쳐 쌓이지 않게 한다.
 */
export function decorPlacement(
  userId: number,
  slug: string,
): { angle: number; distance: number; scale: number; elevation: number } {
  const rng = mulberry32(hashString(`decor:${userId}:${slug}`));
  return {
    angle: rng() * Math.PI * 2,
    // 60 미만은 시야를 가리고, 240을 넘으면 지면 구가 급히 꺼진다
    distance: 60 + rng() * 180,
    scale: 0.8 + rng() * 0.45,
    // 하늘 항목용 고도(도). 곡 별이 14~84°에 있으므로 그 아래쪽에 둔다
    elevation: 25 + rng() * 15,
  };
}

/**
 * 그 거리에서 지면 표면이 `C`보다 얼마나 위/아래인지.
 * 지면은 평면이 아니라 반경 300 구여서, 멀수록 눈에 띄게 내려간다.
 * 300을 넘으면 sqrt가 NaN이 되어 오브젝트가 화면에서 사라지므로 가장자리로 묶는다.
 */
export function groundHeightOffset(distance: number): number {
  if (distance >= GROUND_RADIUS) return -GROUND_CENTER_BELOW;
  return Math.sqrt(GROUND_RADIUS * GROUND_RADIUS - distance * distance) - GROUND_CENTER_BELOW;
}
