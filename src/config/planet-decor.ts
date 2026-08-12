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
  /**
   * 높이가 없는 납작한 오브젝트(호수)만 true. 지면 오브젝트는 원래 높이 덕에
   * 지평선(약 30) 밖에서도 꼭대기가 넘어와 보이지만, 납작한 것은 그림자도 높이도
   * 없어 넘어올 것이 없다 — decorPlacement가 이 값으로 더 가까운 거리 밴드를 고른다
   */
  flat?: true;
}

/** 카탈로그. 항목을 빼도 저장된 slug는 지우지 않는다 — 되돌리면 다시 보이는 편이 낫다 */
export const PLANET_DECOR: PlanetDecorItem[] = [
  { slug: "moon", label: "달", place: "sky" },
  { slug: "trees", label: "나무", place: "ground" },
  { slug: "rocks", label: "바위", place: "ground" },
  { slug: "obelisk", label: "오벨리스크", place: "ground" },
  { slug: "lighthouse", label: "등대", place: "ground" },
  { slug: "lake", label: "호수", place: "ground", flat: true },
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
  // 뽑는 순서는 angle → distance → scale → elevation로 고정한다 — 순서를 바꾸면
  // 이미 서비스 중인 모든 사용자의 자리가 한꺼번에 흔들린다. distance의 산식만
  // 항목이 flat인지에 따라 갈라진다(둘 다 이 자리의 rng() 한 번만 쓴다)
  const angle = rng() * Math.PI * 2;
  const distanceRoll = rng();
  const scale = 0.8 + rng() * 0.45;
  // 하늘 항목용 고도(도). 곡 별이 14~84°에 있으므로 그 아래쪽에 둔다
  const elevation = 25 + rng() * 15;

  const flat = PLANET_DECOR.find((d) => d.slug === slug)?.flat === true;
  const distance = flat
    ? // 10~30: 호수처럼 높이가 없는 오브젝트는 지평선을 넘어올 높이가 없어 땅 오브젝트의
      // 밴드(25~75)를 그대로 쓰면 원반의 근쪽 절반은 솟아오르는 지면에, 먼쪽 절반은
      // 지평선 너머로 가라앉아 실측 2000명 중 15명은 아예 아무것도 안 보였다(예: d≈73.9).
      // 같은 방식으로 측정하면 10~30에서는 평균 83% 보이고 0명이 완전히 안 보인다.
      // 근쪽 가장자리도 카메라에서 6 이상 떨어져 있어 카메라가 원반 안에 서지 않는다
      10 + distanceRoll * 20
    : // 25~75: 이 행성은 반경 300짜리 작은 구여서 눈높이(약 1.5)에서 지평선이 겨우 30밖에
      // 안 된다. 그보다 멀리 두면 행성이 스스로 가려 아무것도 안 보인다 — 실측으로 거리
      // 204·240에 놓인 나무와 등대가 시야 안에 들어와 있는데도 화면에 전혀 그려지지 않았다.
      // 가장 낮은 바위(높이 3)가 지평선 위로 올라오는 한계가 약 73이라 상한을 75로 잡는다
      25 + distanceRoll * 50;

  return { angle, distance, scale, elevation };
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
