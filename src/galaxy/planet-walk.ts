/**
 * 행성 위 걷기의 회전 수학 — SSOT (docs/SSOT.md).
 *
 * 카메라를 구 표면으로 옮기지 않고 **행성을 발밑에서 돌린다**. 하늘돔·곡 별·언덕이
 * 모두 서 있는 지점을 중심으로 붙어 있어서, 카메라를 옮기면 그것들을 전부 따라
 * 옮겨야 하기 때문이다. 화면에 보이는 결과는 같다.
 *
 * three를 import하지 않는다 — 이 파일은 `node:test`로 검증하는데, 테스트가
 * 3D 라이브러리의 브라우저 전제에 걸리면 안 된다. 호출부가 THREE.Vector3로 옮긴다.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WalkKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/** 표면 이동 속도(초당). 둘레 2π×300 = 1885이므로 한 바퀴 약 47초 */
export const WALK_SPEED = 40;
/**
 * 지면 구의 반경 — 유일한 원본(SSOT: docs/SSOT.md). GalaxyCanvas의 지면
 * SphereGeometry·착륙점 셰이더 유니폼(GLSL 템플릿 문자열에 보간해 써야 하며,
 * 정수 리터럴은 float 유니폼과 안 섞이므로 `GROUND_RADIUS.toFixed(1)`로 넣는다)과
 * planet-decor.ts(서버도 읽으므로 여기서 import — three는 안 들어온다)가 여기서 가져다 쓴다.
 */
export const GROUND_RADIUS = 300;
/** 서 있는 지점이 지면 표면보다 이만큼 위에 있다는 뜻(눈높이) */
const EYE_HEIGHT = 1.5;
/**
 * 지면 구의 중심이 서 있는 지점(피벗 원점)보다 얼마나 아래에 있는지.
 * GROUND_RADIUS에서 파생시킨다 — 반경을 바꿔도 두 값이 따로 놀지 않는다
 * (예전엔 298.5를 따로 손으로 적어야 해서, 반경만 바꾸고 이 값을 깜빡하면
 * 지면이 눈높이에서 어긋나 발이 땅에 파묻히거나 붕 뜬 채로 보였다).
 */
export const GROUND_CENTER_OFFSET = GROUND_RADIUS - EYE_HEIGHT;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
/** 길이가 0이면 정규화가 NaN을 만든다 — 그 값이 씬에 들어가면 오브젝트가 사라진다 */
const norm = (a: Vec3): Vec3 | null => {
  const l = len(a);
  if (l < 1e-9) return null;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** 멈춤을 나타내는 결과 — 축은 아무 단위벡터나 되지만 NaN이면 안 된다 */
const STILL = { axis: { x: 0, y: 1, z: 0 }, angle: 0 };

/**
 * 이번 프레임에 행성을 얼마나, 어느 축으로 돌릴지.
 *
 * 축은 `이동방향 × 위쪽`이다. 이 축으로 양의 각도만큼 돌리면 발밑 지면이
 * 이동방향의 **반대**로 흘러가고, 그래서 내가 그쪽으로 걸어간 것처럼 보인다.
 * 부호를 뒤집으면 키와 반대로 걷는다.
 */
export function walkStep(
  forward: Vec3,
  up: Vec3,
  keys: WalkKeys,
  dt: number,
  speed: number,
  radius: number,
): { axis: Vec3; angle: number } {
  const u = norm(up);
  if (!u) return STILL;
  // 시선의 수평 성분만 쓴다 — 고개를 들었다고 느려지면 안 되고,
  // 똑바로 위를 보면 앞이 정해지지 않으므로 그때는 멈춘다
  const flat = norm({
    x: forward.x - u.x * dot(forward, u),
    y: forward.y - u.y * dot(forward, u),
    z: forward.z - u.z * dot(forward, u),
  });
  if (!flat) return STILL;
  const right = norm(cross(flat, u));
  if (!right) return STILL;

  const f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const r = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  // 정규화하지 않으면 앞+옆이 √2배 빨라진다
  const move = norm({
    x: flat.x * f + right.x * r,
    y: flat.y * f + right.y * r,
    z: flat.z * f + right.z * r,
  });
  if (!move) return STILL;

  const axis = norm(cross(move, u));
  if (!axis) return STILL;
  return { axis, angle: (speed * dt) / radius };
}

/**
 * 그 자리의 지면 법선 — 피벗(구의 중심)이 원점이므로 로컬 좌표를 정규화하면 된다.
 * 꾸미기 오브젝트를 이 방향으로 세워야 행성이 돌 때 옆으로 넘어지지 않는다.
 */
export function surfaceNormal(localPos: Vec3): Vec3 {
  return norm(localPos) ?? { x: 0, y: 1, z: 0 };
}
