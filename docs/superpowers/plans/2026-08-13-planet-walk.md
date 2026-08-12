# 행성 위 걸어다니기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인 행성(밤하늘)에서 방향키·조이스틱으로 걸어다닐 수 있게 한다 — 다가가면 지평선 너머에서 꾸미기 오브젝트가 올라오고, 지나가면 뒤로 사라진다.

**Architecture:** 카메라를 옮기지 않는다. 지면 구의 중심에 피벗 그룹을 두고 지면과 지면 꾸미기를 그 자식으로 옮긴 뒤, 걷기를 그 피벗의 회전으로 구현한다. 하늘돔·곡 별·언덕은 지금처럼 시점에 붙어 있어 한 줄도 바뀌지 않는다. 회전 수학은 three에 의존하지 않는 순수 함수로 떼어 `node:test`로 검증한다.

**Tech Stack:** Next.js 16, React 19, three.js r182, `node:test` + tsx

## Global Constraints

- **새 npm 패키지를 설치하지 않는다.** 이 저장소에서 `npm install`이 멈춘다(2026-08-11 실측: 18분간 CPU 0.4%).
- **DB 스키마를 건드리지 않는다.** 이번 작업은 저장하는 것이 없다 — 걸어간 위치도 저장하지 않는다.
- 테스트는 Node 20 내장 `node:test` + tsx (`npm test`, 현재 48개). DOM/WebGL 하네스는 없고 추가할 수도 없다 — three.js 부분은 브라우저로 확인한다.
- **순수 함수 모듈에 `three`를 import하지 않는다.** 테스트가 three의 브라우저 전제에 걸리지 않도록 평범한 `{x,y,z}` 객체로 계산한다. 호출부가 `THREE.Vector3`로 옮긴다.
- 모든 주석·UI 문구는 한국어, why-first 하우스 스타일(주석은 "무엇"이 아니라 "왜", 막아주는 실패를 이름 붙여 적는다).
- `npx tsc --noEmit` 깨끗, `npm run build` 성공, `npm test` 전부 통과.
  - `npx eslint`는 건드린 파일에 **새** 문제를 더하지 않으면 된다. `src/galaxy/GalaxyCanvas.tsx`에는 **기존** 문제 9건이 있다(`react-hooks/set-state-in-effect` 등). 고치지 말고 전후 개수가 같은지만 확인한다(`git stash` 후 비교가 좋다).
- SSOT: 새 원본이 생기면 `docs/SSOT.md`를 **같은 커밋**에 갱신한다.
- 커밋 메시지는 `.claude/skills/commit-with-prompts/SKILL.md` 형식. `[Prompts]` 섹션에 이 작업의 프롬프트 원문 셋을 넣는다:
  1. `자리 직접 고르게 하고 구형태의 행성에서 설치할수 있도록 행성을 축소시킨다음 위치를 지정할수 있게 만들어줘`
  2. `동물의 숲처럼 움직이면서 행성들을 구경할수 있게 하는 것을 원했어`
  3. `그렇게 진행하자`

### 지금 밤하늘 씬의 구조 (Task 2가 여기에 손댄다)

`GalaxyCanvas`의 `enterSky`에서 서 있는 지점이 `C`, 위쪽이 `up = (0,1,0)`이다. 만드는 순서:

| # | 무엇 | 어디에 |
| --- | --- | --- |
| 1 | 하늘돔 (반경 750) | `C` 중심 |
| 2 | 지면 구 (반경 300) | `C - up*298.5` 중심. 셰이더가 `uCenter`(= `C`)에서 배어나오는 별빛 글로우를 그린다 |
| 2-1 | 언덕 능선 (620) | `C` 중심 |
| 2-2 | 꾸미기 오브젝트 | `buildDecor(slug, userId, C, planet)`가 월드 좌표로 돌려준다 |
| 3 | 잔별 900 | `C` 중심 |
| 4 | 곡 별 (430 돔) + 라벨 | `C` 중심 |
| 5 | 유성 | |

전부 `skyGroup`에 들어가고, `exitSky`가 `skyGroup.traverse`로 geometry·material을 dispose한다.

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/galaxy/planet-walk.ts` (신규) | 걷기 회전 수학 (three 비의존 순수 함수) |
| `src/galaxy/planet-walk.test.ts` (신규) | 위 함수 검증 |
| `src/galaxy/GalaxyCanvas.tsx` (수정) | 행성 피벗 도입, 곡률 정렬, 키 입력, 프레임 루프 적용, 조이스틱 배치 |
| `src/galaxy/WalkStick.tsx` (신규) | 모바일 가상 조이스틱 (표시와 입력만, 씬을 모른다) |
| `docs/SSOT.md` (수정) | 걷기 수학의 원본 위치 등록 |

---

### Task 1: 걷기 회전 수학 (순수 함수)

**Files:**
- Create: `src/galaxy/planet-walk.ts`
- Test: `src/galaxy/planet-walk.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interface Vec3 { x: number; y: number; z: number }`
  - `interface WalkKeys { forward: boolean; back: boolean; left: boolean; right: boolean }`
  - `function walkStep(forward: Vec3, up: Vec3, keys: WalkKeys, dt: number, speed: number, radius: number): { axis: Vec3; angle: number }`
  - `function surfaceNormal(localPos: Vec3): Vec3`
  - `const WALK_SPEED = 40`
  - `const GROUND_RADIUS = 300`

- [ ] **Step 1: Write the failing test**

`src/galaxy/planet-walk.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './planet-walk'`

- [ ] **Step 3: Write minimal implementation**

`src/galaxy/planet-walk.ts`:

```ts
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
/** 지면 구의 반경 — enterSky가 만드는 지면과 같은 값이어야 한다 */
export const GROUND_RADIUS = 300;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -10`
Expected: `# fail 0`

- [ ] **Step 5: SSOT 갱신**

`docs/SSOT.md` 표에 한 행을 추가한다 (행성 꾸미기 행들 근처):

```markdown
| 행성 위 걷기 수학 | `src/galaxy/planet-walk.ts` | `GalaxyCanvas`의 프레임 루프 | 카메라를 옮기지 않고 **행성 피벗을 돌린다** — 하늘돔·곡 별·언덕이 모두 서 있는 지점에 붙어 있어 카메라를 옮기면 씬을 통째로 다시 짜야 한다. 회전축은 `이동방향 × 위쪽`이고 각도는 `속도×dt/반경`. `GROUND_RADIUS`는 `enterSky`가 만드는 지면 구와 같은 값이어야 한다. three를 import하지 않는다(`node:test`가 브라우저 전제에 걸리면 안 된다) — 호출부가 THREE.Vector3로 옮긴다. 테스트: `src/galaxy/planet-walk.test.ts` |
```

- [ ] **Step 6: Commit**

```bash
git add src/galaxy/planet-walk.ts src/galaxy/planet-walk.test.ts docs/SSOT.md
git commit -m "$(cat <<'EOF'
feat: 행성 위 걷기 회전 수학

카메라를 옮기지 않고 행성을 발밑에서 돌린다. 회전축은 이동방향 × 위쪽,
각도는 속도×dt/반경. three를 쓰지 않아 node:test로 검증한다.

[Prompts]
1. 자리 직접 고르게 하고 구형태의 행성에서 설치할수 있도록 행성을 축소시킨다음 위치를 지정할수 있게 만들어줘
2. 동물의 숲처럼 움직이면서 행성들을 구경할수 있게 하는 것을 원했어
3. 그렇게 진행하자
EOF
)"
```

---

### Task 2: 행성 피벗 + 곡률 정렬 (아직 움직이지 않는다)

**Files:**
- Modify: `src/galaxy/GalaxyCanvas.tsx`

**Interfaces:**
- Consumes: `surfaceNormal` (Task 1), `PLANET_DECOR` (`src/config/planet-decor.ts`, 기존), `buildDecor` (`src/galaxy/planet-decor-objects.ts`, 기존)
- Produces: 클로저 변수 `planetPivot: THREE.Group | null` — Task 3이 이걸 돌린다

이 태스크는 구조만 바꾼다 — 아직 아무것도 움직이지 않는다.

다만 **화면이 완전히 똑같지는 않다**: 곡률 정렬 때문에 멀리 있는 오브젝트가 자기 자리의 법선으로 기운다. 반경 300에 거리 25~75이므로 최대 `asin(75/300) ≈ 14.5°`다. 이건 의도한 것이다 — 작은 행성 위에 선 물체는 원래 그렇게 기울고, 정렬하지 않으면 행성이 도는 순간 전부 옆으로 넘어진 것처럼 보인다.

- [ ] **Step 1: 피벗 만들고 지면을 그 안으로**

`enterSky`의 지면 블록(`skyGroundMat = groundMat;` 부터 `skyGroup.add(ground);` 까지)을 다음으로 바꾼다:

```ts
      skyGroundMat = groundMat;
      // 행성 피벗 — 지면과 지면 꾸미기가 여기 들어가고, 걷기는 이걸 돌리는 것이다.
      // 자식을 반드시 **로컬 좌표**로 넣어야 한다: rotateOnWorldAxis는 객체의 원점을
      // 지나는 축으로 도는데, 그 원점이 곧 이 피벗의 위치(=구의 중심)이기 때문이다
      planetPivot = new THREE.Group();
      planetPivot.position.copy(C).addScaledVector(up, -298.5); // 꼭대기가 발밑 ~1.5 아래
      const ground = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), groundMat);
      planetPivot.add(ground); // 로컬 (0,0,0) = 구의 중심
      skyGroup.add(planetPivot);
```

파일 위쪽, `let skyGroup: THREE.Group | null = null;` 근처에 선언을 더한다:

```ts
    let planetPivot: THREE.Group | null = null;
```

그리고 `exitSky`에서 `skyGroup = null;`을 하는 자리 옆에 `planetPivot = null;`을 더한다 — 피벗은 `skyGroup`의 자식이라 dispose는 이미 되지만, 참조가 남으면 Task 3의 프레임 루프가 사라진 행성을 계속 돌린다.

- [ ] **Step 2: 별빛 글로우를 행성에 붙인다**

지면 셰이더의 글로우는 지금 **월드 좌표**로 계산한다(`vWorld`, `uCenter = C`). 그대로 두면 행성이 돌아도 글로우는 발밑에 붙박여, 걸어도 내 별을 떠나지 못한다. 로컬 좌표 기준으로 바꾼다.

`groundMat`의 uniforms에서 `uCenter`를 지우고, vertexShader·fragmentShader를 다음으로 바꾼다:

```ts
        vertexShader: /* glsl */ `
          varying vec3 vLocal;
          void main() {
            // 월드가 아니라 로컬 — 행성이 돌면 글로우도 함께 돌아야 한다
            vLocal = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uGround;
          uniform vec3 uStarGlow;
          uniform float uTime;
          varying vec3 vLocal;
          void main() {
            // 착륙 지점은 구의 꼭대기 — 로컬 (0, 300, 0)
            float d = distance(vLocal, vec3(0.0, 300.0, 0.0));
            float pulse = 0.85 + 0.15 * sin(uTime * 1.4);
            // 발밑(별의 심장)에서 배어나오는 별빛 — 멀어질수록 잦아든다
            vec3 col = uGround + uStarGlow * exp(-d / 60.0) * 0.85 * pulse;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
```

- [ ] **Step 3: 지면 꾸미기를 피벗으로 옮기고 곡률에 맞춰 세운다**

꾸미기 루프(`// 2-2)` 블록)를 다음으로 바꾼다:

```ts
      // 2-2) 주인이 놓은 꾸미기 오브젝트 (SSOT: src/config/planet-decor.ts).
      // 지면 항목은 행성 피벗에 넣어 함께 돈다 — 걸어가면 지평선 너머로 넘어간다.
      // 하늘 항목(달)은 skyGroup에 그대로 둔다: 하늘은 무한히 멀어 걸어도 안 움직인다
      for (const slug of decor) {
        const obj = buildDecor(slug, entry.data.userId, C, planet);
        if (!obj) continue;
        const item = PLANET_DECOR.find((d) => d.slug === slug);
        if (item?.place === "sky") {
          skyGroup.add(obj);
          continue;
        }
        // 월드 → 피벗 로컬. 그리고 자기 자리의 법선으로 세운다 — 안 세우면
        // 행성이 돌 때 정수리 기준 +Y로 서 있던 것들이 옆으로 넘어져 보인다
        obj.position.sub(planetPivot.position);
        const n = surfaceNormal(obj.position);
        obj.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(n.x, n.y, n.z),
        );
        planetPivot.add(obj);
      }
```

import를 더한다:

```ts
import { PLANET_DECOR } from "@/config/planet-decor";
import { surfaceNormal } from "./planet-walk";
```

(`PLANET_DECOR`가 이미 import되어 있으면 중복해서 넣지 않는다.)

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "Compiled successfully|Error" && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: 타입 출력 없음, `✓ Compiled successfully`, `# fail 0`

`src/galaxy/GalaxyCanvas.tsx`의 eslint는 **기존** 9건이 그대로인지만 확인한다.

- [ ] **Step 5: Commit**

```bash
git add src/galaxy/GalaxyCanvas.tsx
git commit -m "$(cat <<'EOF'
refactor: 지면과 지면 꾸미기를 행성 피벗으로 모으고 곡률에 맞춰 세우기

걷기를 붙일 자리를 만든다. 자식은 로컬 좌표로 넣어야 rotateOnWorldAxis가
구의 중심을 지나는 축으로 돈다. 별빛 글로우도 월드가 아니라 로컬 기준으로
바꿔, 걸어가면 내 별의 심장이 뒤로 멀어지게 한다. 화면은 아직 그대로다.

[Prompts]
1. 자리 직접 고르게 하고 구형태의 행성에서 설치할수 있도록 행성을 축소시킨다음 위치를 지정할수 있게 만들어줘
2. 동물의 숲처럼 움직이면서 행성들을 구경할수 있게 하는 것을 원했어
3. 그렇게 진행하자
EOF
)"
```

---

### Task 3: 방향키로 걷기

**Files:**
- Modify: `src/galaxy/GalaxyCanvas.tsx`

**Interfaces:**
- Consumes: `walkStep`, `WALK_SPEED`, `GROUND_RADIUS` (Task 1), `planetPivot` (Task 2)
- Produces: 클로저 변수 `walkKeys` (Task 4의 조이스틱이 같은 값을 채운다)

- [ ] **Step 1: 눌린 키를 들고 있는다**

먼저 컴포넌트 본문(다른 `useRef`들 옆)에 이동 입력을 둔다 — 키보드와 (다음 태스크의) 조이스틱이 같은 곳에 쓴다:

```ts
  /** 이동 입력 — 키보드(three 이펙트)와 조이스틱(React)이 같은 객체에 쓴다 */
  const walkKeysRef = useRef({ forward: false, back: false, left: false, right: false });
```

그다음 three 이펙트 안, **`enterSky` 정의보다 위**에 넣는다 (아래 `lastWalkAt`을 `enterSky`가 읽으므로 선언이 먼저여야 한다):

```ts
    // 눌려 있는 이동 키. 프레임 루프가 매 프레임 읽는다 — keydown 반복 이벤트로
    // 움직이면 OS의 키 반복 속도에 따라 걸음이 달라진다.
    // ref에 두는 이유: 다음 태스크의 모바일 조이스틱은 React 쪽에서 같은 값을
    // 채워야 하는데, 이펙트 안의 지역 객체면 닿을 수가 없다
    const walkKeys = walkKeysRef.current;
    const WALK_KEY: Record<string, keyof typeof walkKeys> = {
      ArrowUp: "forward", KeyW: "forward",
      ArrowDown: "back", KeyS: "back",
      ArrowLeft: "left", KeyA: "left",
      ArrowRight: "right", KeyD: "right",
    };
    /** 글자를 치는 중이면 방향키를 뺏지 않는다 — 프로필 편집 입력칸이 먹통이 된다 */
    const typing = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null;
      const tag = t?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable === true;
    };
    const onWalkKey = (e: KeyboardEvent, down: boolean) => {
      if (!skyActive || typing(e.target)) return;
      const k = WALK_KEY[e.code];
      if (!k) return;
      e.preventDefault(); // 방향키로 페이지가 스크롤되지 않게
      walkKeys[k] = down;
    };
    const onKeyDown = (e: KeyboardEvent) => onWalkKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => onWalkKey(e, false);
    /** 창을 벗어나면 누른 채로 굳는다 — 돌아왔을 때 혼자 걸어가지 않게 비운다 */
    const onBlur = () => {
      walkKeys.forward = walkKeys.back = walkKeys.left = walkKeys.right = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
```

이펙트의 정리(cleanup) 함수에 세 리스너 제거를 더한다 (`window.removeEventListener("resize", resize)`를 하는 곳 근처):

```ts
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
```

- [ ] **Step 2: 프레임 루프에서 행성을 돌린다**

`animate` 안, 밤하늘 블록(`if (skyActive) {`) 안의 등대 빛줄기 처리 옆에 넣는다:

```ts
        // 걷기 — 카메라가 아니라 행성이 발밑에서 돈다 (SSOT: src/galaxy/planet-walk.ts).
        // dt를 0.05로 자른다: 탭을 한참 떠났다 돌아오면 한 프레임에 몇 초어치가
        // 몰려 행성이 순간이동한다
        if (planetPivot) {
          const dt = Math.min((now - lastWalkAt) / 1000, 0.05);
          lastWalkAt = now;
          const dir = camera.getWorldDirection(walkDir);
          const step = walkStep(
            { x: dir.x, y: dir.y, z: dir.z },
            { x: 0, y: 1, z: 0 },
            walkKeys,
            dt,
            WALK_SPEED,
            GROUND_RADIUS,
          );
          if (step.angle > 0) {
            walkAxis.set(step.axis.x, step.axis.y, step.axis.z);
            planetPivot.rotateOnWorldAxis(walkAxis, step.angle);
          }
        }
```

프레임 루프 밖, **`enterSky` 정의보다 위**에 보조 변수를 둔다 — 매 프레임 새 벡터를 만들면 GC가 튀고, `enterSky`가 `lastWalkAt`을 쓰므로 선언이 먼저여야 한다:

```ts
    let lastWalkAt = performance.now();
    const walkDir = new THREE.Vector3();
    const walkAxis = new THREE.Vector3();
```

`lastWalkAt`은 착륙할 때 다시 맞춰야 한다. `enterSky` 안, `skyActive = true;` 바로 아래에 넣는다:

```ts
      lastWalkAt = performance.now(); // 은하에 있던 시간이 첫 프레임에 몰리지 않게
```

import를 더한다:

```ts
import { GROUND_RADIUS, WALK_SPEED, surfaceNormal, walkStep } from "./planet-walk";
```

(Task 2에서 `surfaceNormal`만 import했다면 한 줄로 합친다.)

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "Compiled successfully|Error" && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: 타입 출력 없음, `✓ Compiled successfully`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add src/galaxy/GalaxyCanvas.tsx
git commit -m "$(cat <<'EOF'
feat: 방향키로 행성 위를 걸어다니기

눌린 키를 들고 프레임마다 반영한다 — keydown 반복에 기대면 OS 키 반복
속도에 따라 걸음이 달라진다. 입력칸에 포커스가 있으면 방향키를 뺏지 않고,
창을 벗어나면 눌린 상태를 비워 혼자 걸어가지 않게 한다.

[Prompts]
1. 자리 직접 고르게 하고 구형태의 행성에서 설치할수 있도록 행성을 축소시킨다음 위치를 지정할수 있게 만들어줘
2. 동물의 숲처럼 움직이면서 행성들을 구경할수 있게 하는 것을 원했어
3. 그렇게 진행하자
EOF
)"
```

---

### Task 4: 모바일 가상 조이스틱

**Files:**
- Create: `src/galaxy/WalkStick.tsx`
- Modify: `src/galaxy/GalaxyCanvas.tsx`

**Interfaces:**
- Consumes: 없음 (씬을 모른다)
- Produces: `<WalkStick onChange={(v: { forward: boolean; back: boolean; left: boolean; right: boolean }) => void} />`

- [ ] **Step 1: 조이스틱 컴포넌트**

`src/galaxy/WalkStick.tsx`:

```tsx
"use client";

/**
 * 모바일 가상 조이스틱 — 밤하늘에서 걸어다닐 때만 쓴다.
 *
 * 씬을 모른다. 어느 방향이 눌린 상태인지만 알려주고, 그걸 행성 회전으로
 * 옮기는 일은 GalaxyCanvas의 프레임 루프가 한다 (SSOT: src/galaxy/planet-walk.ts).
 * 방향을 각도가 아니라 네 개의 불리언으로 넘기는 이유는 키보드와 같은 통로를
 * 쓰기 위해서다 — 둘을 따로 두면 이동 규칙이 두 벌이 된다.
 */
import { useRef, useState } from "react";

export interface StickValue {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

const NONE: StickValue = { forward: false, back: false, left: false, right: false };
/** 이만큼 밀어야 걷기 시작한다 — 손가락을 얹기만 해도 걸어가면 안 된다 */
const DEAD_ZONE = 12;
/** 손잡이가 밖으로 나가지 않는 반경 */
const MAX_PULL = 44;

export default function WalkStick({ onChange }: { onChange: (v: StickValue) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const send = (v: StickValue) => onChange(v);

  const update = (clientX: number, clientY: number) => {
    const o = originRef.current;
    if (!o) return;
    let dx = clientX - o.x;
    let dy = clientY - o.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_PULL) {
      dx = (dx / d) * MAX_PULL;
      dy = (dy / d) * MAX_PULL;
    }
    setKnob({ x: dx, y: dy });
    if (d < DEAD_ZONE) {
      send(NONE);
      return;
    }
    // 화면 위쪽이 앞이다 (dy가 음수)
    send({
      forward: dy < -DEAD_ZONE / 2,
      back: dy > DEAD_ZONE / 2,
      left: dx < -DEAD_ZONE / 2,
      right: dx > DEAD_ZONE / 2,
    });
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = baseRef.current?.getBoundingClientRect();
    if (!r) return;
    originRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!originRef.current) return;
    update(e.clientX, e.clientY);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!originRef.current) return;
    originRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setKnob({ x: 0, y: 0 });
    // 손을 떼면 반드시 멈춘다 — 안 비우면 마지막 방향으로 계속 걸어간다
    send(NONE);
  };

  return (
    <div
      ref={baseRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="행성 위 이동"
      /* touch-none: 없으면 브라우저가 스크롤 제스처로 가져가 조작이 끊긴다 */
      className="absolute bottom-4 left-4 z-10 grid h-28 w-28 touch-none place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur sm:hidden"
    >
      <div
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        className="h-12 w-12 rounded-full border border-white/25 bg-white/20"
      />
    </div>
  );
}
```

- [ ] **Step 2: 밤하늘에서만 띄운다**

`GalaxyCanvas.tsx`에 import를 더한다:

```ts
import WalkStick from "./WalkStick";
```

`walkKeysRef`는 앞 태스크에서 이미 컴포넌트 본문에 있다 — 조이스틱은 거기에 쓰기만 하면 키보드와 같은 통로를 탄다.

렌더 부분, 카드 캐러셀 블록 근처에 넣는다 (밤하늘일 때만, 모바일에서만):

```tsx
      {/* 밤하늘에서만, 좁은 화면에서만 — PC는 방향키로 걷는다.
          좌하단은 밤하늘에서 미니맵이 숨겨져 비어 있는 자리다 */}
      {skyInfo && (
        <WalkStick
          onChange={(v) => {
            walkKeysRef.current.forward = v.forward;
            walkKeysRef.current.back = v.back;
            walkKeysRef.current.left = v.left;
            walkKeysRef.current.right = v.right;
          }}
        />
      )}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npx eslint src/galaxy/WalkStick.tsx && npm run build 2>&1 | grep -E "Compiled successfully|Error" && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: 타입·린트 출력 없음, `✓ Compiled successfully`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add src/galaxy/WalkStick.tsx src/galaxy/GalaxyCanvas.tsx
git commit -m "$(cat <<'EOF'
feat: 폰에서 걸어다니는 가상 조이스틱

방향을 각도가 아니라 키보드와 같은 네 불리언으로 넘긴다 — 따로 두면
이동 규칙이 두 벌이 된다. 손을 떼면 반드시 멈추고, touch-none으로
브라우저가 스크롤 제스처로 가져가지 못하게 한다.

[Prompts]
1. 자리 직접 고르게 하고 구형태의 행성에서 설치할수 있도록 행성을 축소시킨다음 위치를 지정할수 있게 만들어줘
2. 동물의 숲처럼 움직이면서 행성들을 구경할수 있게 하는 것을 원했어
3. 그렇게 진행하자
EOF
)"
```

---

## 컨트롤러가 하는 일 (구현자가 하지 않는다)

브라우저 확인 (프로덕션 DB에 붙인 로컬 dev + 로그인 쿠키). 꾸미기를 몇 개 켜둔 뒤 `/planet/1`에서:

- 방향키를 누르면 앞으로 걸어가고, 떼면 즉시 멈춘다
- **키와 걷는 방향이 맞다** (앞키가 앞으로 — 부호가 뒤집히면 뒤로 간다)
- 대각선이 직진보다 빠르지 않다
- 계속 걸으면 꾸미기가 지평선 너머에서 올라오고 지나가면 사라진다
- 오브젝트가 멀어질수록 옆으로 기운다 (곡률에 맞춰 섰다)
- 발밑 별빛 글로우가 걸어가면 뒤로 멀어진다
- 하늘의 곡 별과 달은 걸어도 제자리에 있다
- 한 바퀴(약 47초) 돌면 출발점의 오브젝트가 다시 나타난다
- 프로필 편집 드로어의 입력칸에서 방향키가 정상 동작한다 (걷지 않는다)
- 폰 폭(390)에서 조이스틱이 뜨고, 밀면 걷고 떼면 멈춘다. PC 폭에서는 안 보인다
- **조이스틱이 하단 곡 캐러셀의 좌측 화살표·카드를 가리지 않는지** — 겹치면 조이스틱을 캐러셀 위로 올린다
- 행성을 나갔다 다시 들어오면 출발점에서 시작한다
- 행성→행성 이동에서 앞 행성이 남지 않는다

## 하지 않는 것 (스펙의 "하지 않는 것" 그대로)

- 자리 직접 지정 (다음 작업)
- 3인칭·캐릭터 모델
- 달리기·점프·충돌
- 걸어간 위치 저장
- 은하(행성 밖)에서의 이동 방식 변경
