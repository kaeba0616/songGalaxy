import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GROUND_RADIUS, WALK_SPEED, surfaceNormal, walkStep } from "./planet-walk";

const UP = { x: 0, y: 1, z: 0 };
/** 화면 안쪽(-Z)을 보고 서 있는 상태 — three의 기본 카메라 방향 */
const LOOK = { x: 0, y: 0, z: -1 };
const NONE = { forward: false, back: false, left: false, right: false };
const near = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} !== ${b}`);

describe("walkStep", () => {
  it("아무 키도 안 눌렀으면 회전하지 않는다", () => {
    const r = walkStep(LOOK, UP, NONE, 0.016, WALK_SPEED, GROUND_RADIUS);
    assert.equal(r.angle, 0);
  });

  it("각도는 표면 이동거리를 반경으로 나눈 값이다", () => {
    // 표면에서 speed*dt만큼 걸으면 중심에서 본 각도는 그만큼을 반경으로 나눈 값이다
    const r = walkStep(LOOK, UP, { ...NONE, forward: true }, 0.5, 40, 300);
    near(r.angle, (40 * 0.5) / 300, "angle");
  });

  it("앞으로 걸으면 회전축이 시선·위쪽 모두에 수직이다", () => {
    const { axis } = walkStep(LOOK, UP, { ...NONE, forward: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    near(axis.x * LOOK.x + axis.y * LOOK.y + axis.z * LOOK.z, 0, "시선과 수직");
    near(axis.x * UP.x + axis.y * UP.y + axis.z * UP.z, 0, "위쪽과 수직");
    near(Math.hypot(axis.x, axis.y, axis.z), 1, "단위벡터");
  });

  it("-Z를 보고 앞으로 걸으면 축이 +X다", () => {
    // 이 축으로 행성을 양의 각도만큼 돌리면 발밑 지면이 +Z(내 뒤)로 흘러간다 —
    // 즉 내가 -Z(앞)로 걸어간 것처럼 보인다. 부호가 뒤집히면 뒤로 걷는다
    const { axis } = walkStep(LOOK, UP, { ...NONE, forward: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    near(axis.x, 1);
    near(axis.y, 0);
    near(axis.z, 0);
  });

  it("뒤로 걸으면 축이 정확히 반대다", () => {
    const f = walkStep(LOOK, UP, { ...NONE, forward: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    const b = walkStep(LOOK, UP, { ...NONE, back: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    near(b.axis.x, -f.axis.x);
    near(b.axis.z, -f.axis.z);
    near(b.angle, f.angle);
  });

  it("앞뒤를 같이 누르면 서로 상쇄되어 멈춘다", () => {
    const r = walkStep(LOOK, UP, { ...NONE, forward: true, back: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    assert.equal(r.angle, 0);
  });

  it("대각선으로 걸어도 속도가 빨라지지 않는다", () => {
    // 정규화하지 않으면 앞+옆이 √2배 빨라진다 — 게임에서 흔한 버그
    const straight = walkStep(LOOK, UP, { ...NONE, forward: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    const diagonal = walkStep(LOOK, UP, { ...NONE, forward: true, right: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    near(diagonal.angle, straight.angle, "대각선 각속도");
    near(Math.hypot(diagonal.axis.x, diagonal.axis.y, diagonal.axis.z), 1, "축은 여전히 단위벡터");
  });

  it("위아래를 보고 있어도 수평으로만 걷는다", () => {
    // 하늘을 올려다본 채 앞으로 걸으면, 시선의 수평 성분만 써야 한다.
    // 안 그러면 고개를 들수록 느려지고 똑바로 위를 보면 아예 못 걷는다
    const lookUp = { x: 0, y: 0.9, z: -0.436 };
    const r = walkStep(lookUp, UP, { ...NONE, forward: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    near(r.angle, (WALK_SPEED * 0.016) / GROUND_RADIUS, "고개를 들어도 같은 속도");
    near(r.axis.x, 1);
  });

  it("똑바로 위를 보고 있으면 앞이 정해지지 않아 멈춘다", () => {
    // 수평 성분이 0이라 방향을 만들 수 없다 — NaN을 만드는 대신 멈춘다
    const r = walkStep(UP, UP, { ...NONE, forward: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    assert.equal(r.angle, 0);
    assert.ok(Number.isFinite(r.axis.x) && Number.isFinite(r.axis.y) && Number.isFinite(r.axis.z));
  });

  it("좌우는 서로 반대이고 앞과도 수직이다", () => {
    const l = walkStep(LOOK, UP, { ...NONE, left: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    const r = walkStep(LOOK, UP, { ...NONE, right: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    near(l.axis.x, -r.axis.x);
    near(l.axis.z, -r.axis.z);
    const f = walkStep(LOOK, UP, { ...NONE, forward: true }, 0.016, WALK_SPEED, GROUND_RADIUS);
    near(f.axis.x * r.axis.x + f.axis.y * r.axis.y + f.axis.z * r.axis.z, 0, "앞과 옆의 축은 수직");
  });
});

describe("surfaceNormal", () => {
  it("중심에서 그 자리로 향하는 단위벡터다", () => {
    const n = surfaceNormal({ x: 0, y: 300, z: 0 });
    near(n.x, 0);
    near(n.y, 1);
    near(n.z, 0);
  });

  it("길이는 언제나 1이다", () => {
    const n = surfaceNormal({ x: 12, y: 280, z: -45 });
    near(Math.hypot(n.x, n.y, n.z), 1);
  });

  it("원점이면 위쪽을 준다 (0으로 나누지 않는다)", () => {
    // 정규화에서 NaN이 나오면 오브젝트가 화면에서 통째로 사라진다
    const n = surfaceNormal({ x: 0, y: 0, z: 0 });
    near(n.x, 0);
    near(n.y, 1);
    near(n.z, 0);
  });
});
