# 행성 꾸미기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인 행성에 오브젝트를 놓을 수 있게 한다 — 카탈로그에서 켜고 끄면 앱이 자리를 정해 놓고, 방문자에게도 주인이 꾸민 대로 보인다.

**Architecture:** 카탈로그(무엇이 있는가)와 자리 계산은 순수 TS로 `src/config/planet-decor.ts`에 두어 서버·UI·씬이 함께 읽고 단위 테스트한다. three.js로 실제 도형을 만드는 코드는 `src/galaxy/planet-decor-objects.ts`로 분리해 서버가 끌어오지 않게 한다. 저장은 `planet_decor` 테이블, 전달은 착륙할 때 이미 부르는 `/api/users/[id]/likes` 응답에 얹는다.

**Tech Stack:** Next.js 16 App Router, React 19, three.js r182, Drizzle ORM + Postgres, `node:test` + tsx

## Global Constraints

- **새 npm 패키지를 설치하지 않는다.** 이 저장소에서 `npm install`이 멈춘다(2026-08-11 실측: 18분간 CPU 0.4%).
- **`drizzle-kit push`를 실행하지 않는다.** 백업 테이블(`songs_backup_dedupe` 1,363행 등)을 지운다. 스키마 변경은 추가 전용 SQL을 로컬 Docker와 Neon 양쪽에 직접 적용한다.
- **해금·재화를 만들지 않는다.** 카탈로그 전부가 그냥 열려 있다.
- 테스트는 Node 20 내장 `node:test` + tsx (`npm test`). vitest 아님. DOM/React 하네스는 없고 추가할 수도 없다 — three.js·React 부분은 브라우저로 확인한다.
- 모든 주석·UI 문구는 한국어, why-first 하우스 스타일(주석은 "무엇"이 아니라 "왜", 막아주는 실패를 이름 붙여 적는다).
- `npx tsc --noEmit` 깨끗, `npx eslint`가 건드린 파일에 **새** 문제를 더하지 않음, `npm run build` 성공, `npm test` 전부 통과.
  - 참고: `src/player/player-context.tsx:258`과 `src/galaxy/GalaxyCanvas.tsx`(약 198·296행)에 **기존** `react-hooks/set-state-in-effect` 오류가 있다. 건드리지 말고, 전후 동일한지만 확인한다.
- SSOT: 새 원본이 생기면 `docs/SSOT.md`를 **같은 커밋**에 갱신한다.
- 커밋 메시지는 `.claude/skills/commit-with-prompts/SKILL.md` 형식. `[Prompts]` 섹션에 이 작업의 프롬프트 원문 둘을 넣는다:
  1. `이제 다음 기능을 추가해줘`
  2. `그렇게 진행해줘 우선 재화는필요없도록`

### 행성 씬의 기하 (Task 3이 여기에 얹힌다)

`enterSky`에서 서 있는 지점이 `C`, 위쪽이 `up = (0,1,0)`이다.

| | 값 |
| --- | --- |
| 하늘 돔 | 반경 750 구, 중심 `C` |
| 지면 | 반경 300 구, 중심 `C - up*298.5` → 꼭대기 `C + up*1.5` |
| 언덕 능선 | 반경 620, 밑동 `C.y - 40`, 높이 `C.y + 10~40` |
| 좋아요 곡 별 | 반경 430 돔, 고도 14~84°, 골든앵글 방위 |

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/config/planet-decor.ts` (신규) | 카탈로그(slug·label·place)와 자리 계산 순수 함수 |
| `src/config/planet-decor.test.ts` (신규) | 자리 계산 검증 |
| `src/db/schema.ts` (수정) | `planetDecor` 테이블 정의 |
| `src/server/planet-decor.ts` (신규) | 읽기/토글 (DB 접근) |
| `src/app/api/users/[id]/likes/route.ts` (수정) | 응답에 `decor: string[]` 추가 |
| `src/app/me/actions.ts` (수정) | `setPlanetDecorAction` |
| `src/app/me/page.tsx` (수정) | "행성 꾸미기" 섹션 |
| `src/galaxy/planet-decor-objects.ts` (신규) | slug → `THREE.Object3D` (three.js 전용) |
| `src/galaxy/GalaxyCanvas.tsx` (수정) | 착륙 응답에서 decor를 받아 `enterSky`가 씬에 얹음 |
| `docs/SSOT.md` (수정) | 카탈로그·자리 계산·저장 위치 등록 |

---

### Task 1: 카탈로그 + 자리 계산 (순수 함수)

**Files:**
- Create: `src/config/planet-decor.ts`
- Test: `src/config/planet-decor.test.ts`

**Interfaces:**
- Consumes: `hashString`, `mulberry32` (`src/lib/layout-math.ts`, 기존)
- Produces:
  - `interface PlanetDecorItem { slug: string; label: string; place: "ground" | "sky" }`
  - `const PLANET_DECOR: PlanetDecorItem[]`
  - `function isDecorSlug(slug: string): boolean`
  - `function decorPlacement(userId: number, slug: string): { angle: number; distance: number; scale: number; elevation: number }`
  - `function groundHeightOffset(distance: number): number`

`decorPlacement`는 지면·하늘 항목 모두에 쓴다. 지면 항목은 `angle`·`distance`·`scale`을, 하늘 항목은 `angle`(방위)·`elevation`·`scale`을 쓴다.

- [ ] **Step 1: Write the failing test**

`src/config/planet-decor.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLANET_DECOR,
  decorPlacement,
  groundHeightOffset,
  isDecorSlug,
} from "./planet-decor";

describe("PLANET_DECOR", () => {
  it("slug가 겹치지 않는다", () => {
    const slugs = PLANET_DECOR.map((d) => d.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("모든 항목이 label과 place를 갖는다", () => {
    for (const d of PLANET_DECOR) {
      assert.ok(d.label.length > 0, `${d.slug}에 label이 없다`);
      assert.ok(d.place === "ground" || d.place === "sky", `${d.slug}의 place가 이상하다`);
    }
  });

  it("isDecorSlug는 카탈로그에 있는 것만 통과시킨다", () => {
    assert.equal(isDecorSlug(PLANET_DECOR[0].slug), true);
    assert.equal(isDecorSlug("no-such-thing"), false);
    // 저장된 slug를 그대로 SQL/씬에 넘기지 않는다 — 이 검사가 유일한 관문이다
    assert.equal(isDecorSlug(""), false);
  });
});

describe("decorPlacement", () => {
  it("같은 사람의 같은 항목은 늘 같은 자리다", () => {
    // 좌표를 저장하지 않고 해시로 다시 만든다 — 재현되지 않으면 오브젝트가 매번 순간이동한다
    assert.deepEqual(decorPlacement(7, "trees"), decorPlacement(7, "trees"));
  });

  it("사람이 다르면 자리도 다르다", () => {
    assert.notDeepEqual(decorPlacement(7, "trees"), decorPlacement(8, "trees"));
  });

  it("같은 사람이라도 항목이 다르면 자리가 다르다 — 겹쳐 놓이면 안 된다", () => {
    assert.notDeepEqual(decorPlacement(7, "trees"), decorPlacement(7, "rocks"));
  });

  it("거리는 60~240 안이다", () => {
    // 지면은 반경 300 구라 300에 가까우면 표면이 급히 꺼지고 넘으면 지면이 없다
    for (let userId = 1; userId <= 50; userId++) {
      for (const d of PLANET_DECOR) {
        const p = decorPlacement(userId, d.slug);
        assert.ok(p.distance >= 60 && p.distance <= 240, `${userId}/${d.slug} → ${p.distance}`);
      }
    }
  });

  it("방위는 0~2π, 고도는 25~40°, 배율은 0.8~1.25 안이다", () => {
    for (let userId = 1; userId <= 50; userId++) {
      for (const d of PLANET_DECOR) {
        const p = decorPlacement(userId, d.slug);
        assert.ok(p.angle >= 0 && p.angle < Math.PI * 2, `angle ${p.angle}`);
        assert.ok(p.elevation >= 25 && p.elevation <= 40, `elevation ${p.elevation}`);
        assert.ok(p.scale >= 0.8 && p.scale <= 1.25, `scale ${p.scale}`);
      }
    }
  });
});

describe("groundHeightOffset", () => {
  it("발밑(거리 0)에서는 지면 꼭대기가 +1.5다", () => {
    assert.equal(Math.round(groundHeightOffset(0) * 10) / 10, 1.5);
  });

  it("멀어질수록 내려간다", () => {
    assert.ok(groundHeightOffset(240) < groundHeightOffset(60));
    assert.ok(groundHeightOffset(60) < groundHeightOffset(0));
  });

  it("거리 60·240에서의 값 (구면 공식)", () => {
    assert.equal(Math.round(groundHeightOffset(60) * 10) / 10, -4.6);
    assert.equal(groundHeightOffset(240), -118.5);
  });

  it("지면 밖(300 이상)이면 지면 가장자리 높이로 묶는다", () => {
    // sqrt(음수) = NaN이 되어 오브젝트가 화면에서 사라진다
    assert.equal(groundHeightOffset(300), -298.5);
    assert.equal(groundHeightOffset(9999), -298.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './planet-decor'`

- [ ] **Step 3: Write minimal implementation**

`src/config/planet-decor.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -10`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/config/planet-decor.ts src/config/planet-decor.test.ts
git commit -m "$(cat <<'EOF'
feat: 행성 꾸미기 카탈로그와 자리 계산

좌표를 저장하지 않고 userId+slug 해시로 매번 다시 만든다 — 언덕 실루엣이
정해지는 방식과 같다. three.js는 여기 들이지 않는다(서버도 읽는 파일이다).

[Prompts]
1. 이제 다음 기능을 추가해줘
2. 그렇게 진행해줘 우선 재화는필요없도록
EOF
)"
```

---

### Task 2: 저장 + 전달 (DB·서버·API)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/server/planet-decor.ts`
- Modify: `src/app/api/users/[id]/likes/route.ts`
- Modify: `docs/SSOT.md`

**Interfaces:**
- Consumes: `isDecorSlug` (Task 1)
- Produces:
  - `schema.planetDecor` (Drizzle 테이블)
  - `listPlanetDecor(userId: number): Promise<string[]>`
  - `setPlanetDecor(userId: number, slug: string, on: boolean): Promise<void>` — 원하는 상태를 받는다(뒤집지 않는다)
  - `GET /api/users/[id]/likes` 응답에 `decor: string[]`

- [ ] **Step 1: 스키마 추가**

`src/db/schema.ts`에서 `playlistSongs` 정의 바로 아래에 넣는다 (import에 이미 `pgTable`, `integer`, `text`, `timestamp`, `primaryKey`가 있다):

```ts
/**
 * 행성에 놓은 꾸미기 오브젝트. 좌표는 저장하지 않는다 —
 * 자리는 언제나 userId+slug 해시에서 다시 나온다 (src/config/planet-decor.ts).
 */
export const planetDecor = pgTable(
  "planet_decor",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    addedAt: timestamp("added_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.slug] })],
);
```

파일 끝의 타입 내보내기 근처에 추가:

```ts
export type PlanetDecor = typeof planetDecor.$inferSelect;
```

- [ ] **Step 2: 서버 함수**

`src/server/planet-decor.ts`:

```ts
/**
 * 행성 꾸미기 저장 — 켜고 끄는 것뿐이다.
 * 무엇이 있는지(카탈로그)와 어디에 놓이는지(자리)는 src/config/planet-decor.ts가 원본이다.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isDecorSlug } from "@/config/planet-decor";

/** 그 사람이 켜 둔 slug들 (카탈로그에 없는 것은 걸러 낸다) */
export async function listPlanetDecor(userId: number): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.planetDecor.slug })
    .from(schema.planetDecor)
    .where(eq(schema.planetDecor.userId, userId));
  // 카탈로그에서 뺀 항목이 저장에 남아 있을 수 있다 — 지우지 않고 읽을 때만 거른다
  return rows.map((r) => r.slug).filter(isDecorSlug);
}

/**
 * 꾸미기를 켜거나 끈다. "뒤집기"가 아니라 **원하는 상태를 받는다** —
 * 뒤집기로 만들면 칩을 빠르게 두 번 누를 때 먼저 도착한 요청이 지우고
 * 나중 요청이 "없으니 넣자"로 되살려, 끄려던 것이 켜진 채 남는다.
 * 같은 요청이 몇 번 가도 결과가 같아야 한다.
 */
export async function setPlanetDecor(userId: number, slug: string, on: boolean): Promise<void> {
  if (!isDecorSlug(slug)) return;
  if (on) {
    await db
      .insert(schema.planetDecor)
      .values({ userId, slug })
      .onConflictDoNothing({ target: [schema.planetDecor.userId, schema.planetDecor.slug] });
    return;
  }
  await db
    .delete(schema.planetDecor)
    .where(and(eq(schema.planetDecor.userId, userId), eq(schema.planetDecor.slug, slug)));
}
```

- [ ] **Step 3: API 응답에 얹기**

`src/app/api/users/[id]/likes/route.ts`:

import를 더한다:

```ts
import { listPlanetDecor } from "@/server/planet-decor";
```

`Promise.all([...])`의 마지막 항목 뒤에 `listPlanetDecor(userId)`를 추가하고, 구조분해도 함께 늘린다 (`const [rows, clusterRows, [owner], decor] = await Promise.all([...])`). 응답 객체에 한 줄 추가:

```ts
      // 방문자에게도 주인이 꾸민 대로 보인다 (테마와 같은 방침)
      decor,
```

- [ ] **Step 4: 타입 검사·빌드**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "Compiled successfully|Error"`
Expected: 타입 출력 없음, `✓ Compiled successfully`

DB에는 아직 테이블이 없다. 만드는 것은 컨트롤러가 Step 6에서 한다 — **직접 DB에 접속하지 말 것.**

- [ ] **Step 5: SSOT 갱신**

`docs/SSOT.md` 표에 두 행을 추가한다 (행성 테마 팔레트 행 근처):

```markdown
| 행성 꾸미기 카탈로그·자리 | `src/config/planet-decor.ts` | `/me`의 꾸미기 칩, `setPlanetDecorAction`의 검증, `GalaxyCanvas`의 씬 배치 | 무엇이 있는지와 어디에 놓이는지가 여기 하나에 있다. 좌표는 저장하지 않고 `decorPlacement(userId, slug)`가 해시로 매번 다시 만든다 — 언덕 실루엣과 같은 방식. `groundHeightOffset`은 지면이 반경 300 구라는 사실(=`enterSky`가 만드는 지면)을 담고 있으므로 둘 중 하나를 바꾸면 같이 바꿔야 한다. three.js를 import하지 않는다(서버도 읽는다) — 도형 생성은 `src/galaxy/planet-decor-objects.ts` |
| 행성 꾸미기 저장 | `planet_decor` 테이블 | `/api/users/[id]/likes`의 `decor`, `/me`의 칩 상태 | 켜고 끈 것만 저장하고 좌표·순서는 두지 않는다. 창구는 `src/server/planet-decor.ts` 둘뿐(`listPlanetDecor`·`setPlanetDecor`). `setPlanetDecor`는 뒤집지 않고 **원하는 상태를 받는다** — 뒤집기는 칩 연타에 뒤집힌다. 카탈로그에서 뺀 slug는 지우지 않고 **읽을 때** 거른다 — 항목이 돌아오면 다시 보이는 편이 낫다 |
```

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/server/planet-decor.ts "src/app/api/users/[id]/likes/route.ts" docs/SSOT.md
git commit -m "$(cat <<'EOF'
feat: 행성 꾸미기 저장과 전달

planet_decor 테이블(추가 전용)에 켜고 끈 것만 담고, 착륙할 때 이미 부르는
/api/users/[id]/likes 응답에 decor를 얹어 방문자에게도 같이 보이게 한다.

[Prompts]
1. 이제 다음 기능을 추가해줘
2. 그렇게 진행해줘 우선 재화는필요없도록
EOF
)"
```

---

### Task 3: 씬에 오브젝트 얹기

**Files:**
- Create: `src/galaxy/planet-decor-objects.ts`
- Modify: `src/galaxy/GalaxyCanvas.tsx`

**Interfaces:**
- Consumes: `PLANET_DECOR`, `decorPlacement`, `groundHeightOffset` (Task 1); `/api/users/[id]/likes`의 `decor` (Task 2); `PlanetTheme` (`src/config/planet-themes.ts`, 기존)
- Produces: `buildDecor(slug: string, userId: number, C: THREE.Vector3, theme: PlanetTheme): THREE.Object3D | null`

- [ ] **Step 1: 도형 만들기**

`src/galaxy/planet-decor-objects.ts`:

```ts
/**
 * 꾸미기 오브젝트의 실제 도형. three 기본 도형만 쓴다 —
 * 모델 파일을 받아오지 않는 이유는 저장소도 로더도 늘리지 않기 위해서고,
 * 지금 행성이 전부 이 방식(언덕은 sin 합성, 별은 Points)이라 톤도 맞는다.
 *
 * 무엇이 있는지(카탈로그)와 어디에 놓이는지(자리)는 src/config/planet-decor.ts가 원본이다.
 * 여기는 "그 slug가 어떻게 생겼나"만 안다.
 */
import * as THREE from "three";
import { decorPlacement, groundHeightOffset } from "@/config/planet-decor";
import type { PlanetTheme } from "@/config/planet-themes";

/** 하늘 돔 위 오브젝트가 놓이는 반경 — 곡 별과 같다 */
const SKY_RADIUS = 430;

function ground(theme: PlanetTheme, mul: number): THREE.MeshBasicMaterial {
  // 조명이 없는 씬이라 MeshBasic을 쓴다. 테마 지면색을 밝기만 달리해 실루엣을 만든다
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.ground).multiplyScalar(mul) });
}

function trees(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const trunkMat = ground(theme, 0.7);
  const leafMat = ground(theme, 1.6);
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const h = 8 + rng() * 6;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, h * 0.45, 6), trunkMat);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(h * 0.32, h * 0.7, 7), leafMat);
    t.position.y = h * 0.225;
    leaf.position.y = h * 0.6;
    const one = new THREE.Group();
    one.add(t, leaf);
    one.position.set((rng() - 0.5) * 26, 0, (rng() - 0.5) * 26);
    g.add(one);
  }
  return g;
}

function rocks(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = ground(theme, 1.35);
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 3 + rng() * 3;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    m.position.set((rng() - 0.5) * 18, r * 0.4, (rng() - 0.5) * 18);
    m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(m);
  }
  return g;
}

function obelisk(theme: PlanetTheme): THREE.Object3D {
  // 반드시 Group으로 감싸 돌려준다 — buildDecor가 반환값의 position을 통째로 덮어쓰므로,
  // 메시를 그대로 돌려주면 아래에서 준 y 오프셋이 사라져 오브젝트가 지면에 반쯤 묻힌다
  const g = new THREE.Group();
  const h = 24;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 2.4, h, 4),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glow).multiplyScalar(0.75) }),
  );
  m.position.y = h / 2;
  m.rotation.y = Math.PI / 4;
  g.add(m);
  return g;
}

function lighthouse(theme: PlanetTheme): THREE.Object3D {
  const g = new THREE.Group();
  const h = 28;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.2, h, 10), ground(theme, 1.5));
  tower.position.y = h / 2;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glow) }),
  );
  lamp.position.y = h + 1.5;
  // 천천히 도는 빛줄기 — 애니메이션은 GalaxyCanvas의 프레임 루프가 돌린다
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 40, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.glow),
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(20, h + 1.5, 0);
  const spin = new THREE.Group();
  spin.add(beam);
  spin.name = "decor-spin"; // 프레임 루프가 이 이름으로 찾아 돌린다
  g.add(tower, lamp, spin);
  return g;
}

function lake(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  // obelisk와 같은 이유로 Group으로 감싼다 (buildDecor가 position을 덮어쓴다)
  const g = new THREE.Group();
  const r = 25 + rng() * 15;
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.glow).multiplyScalar(0.5),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.2; // 지면과 z-파이팅하지 않게 살짝 띄운다
  g.add(m);
  return g;
}

function moon(theme: PlanetTheme): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(16, 24, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#f4ecd8") }),
  );
  // 은은한 달무리 — 하늘 색과 섞이도록 더하기 블렌딩
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(26, 20, 14),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.glow),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  g.add(body, halo);
  return g;
}

/**
 * slug 하나를 그 사람의 행성 위 제자리에 놓인 오브젝트로 만든다.
 * 카탈로그에 없는 slug면 null (호출부가 조용히 건너뛴다).
 * 반환된 객체는 반드시 `skyGroup`에 넣어야 한다 — 그래야 행성을 나갈 때 함께 dispose된다.
 */
export function buildDecor(
  slug: string,
  userId: number,
  C: THREE.Vector3,
  theme: PlanetTheme,
): THREE.Object3D | null {
  const place = decorPlacement(userId, slug);
  // 도형 안에서 쓰는 흔들림도 같은 자리 값에서 파생시켜 재현성을 지킨다
  let t = place.angle * 1000 + place.distance;
  const rng = () => {
    t = (t * 9301 + 49297) % 233280;
    return t / 233280;
  };

  let obj: THREE.Object3D | null = null;
  let sky = false;
  switch (slug) {
    case "trees": obj = trees(theme, rng); break;
    case "rocks": obj = rocks(theme, rng); break;
    case "obelisk": obj = obelisk(theme); break;
    case "lighthouse": obj = lighthouse(theme); break;
    case "lake": obj = lake(theme, rng); break;
    case "moon": obj = moon(theme); sky = true; break;
    default: return null;
  }

  obj.scale.setScalar(place.scale);
  if (sky) {
    const el = (place.elevation * Math.PI) / 180;
    obj.position.set(
      C.x + SKY_RADIUS * Math.cos(el) * Math.cos(place.angle),
      C.y + SKY_RADIUS * Math.sin(el),
      C.z + SKY_RADIUS * Math.cos(el) * Math.sin(place.angle),
    );
  } else {
    obj.position.set(
      C.x + place.distance * Math.cos(place.angle),
      C.y + groundHeightOffset(place.distance),
      C.z + place.distance * Math.sin(place.angle),
    );
  }
  return obj;
}
```

- [ ] **Step 2: 착륙 응답에서 decor 받기**

`src/galaxy/GalaxyCanvas.tsx`:

1. import를 더한다: `import { buildDecor } from "./planet-decor-objects";`
2. `pendingSky`의 타입을 늘린다:

```ts
    let pendingSky: { entry: StarEntry; songIds: number[] | null; decor: string[] } | null = null;
```

3. `landOnStar`의 `pendingSky = { entry, songIds: null };`를 `pendingSky = { entry, songIds: null, decor: [] };`로 바꾼다.
4. 같은 함수의 `.then((d: {...}) => {...})`에서 타입에 `decor?: string[];`를 더하고, `pendingSky.songIds = songIds;` 바로 아래에 `pendingSky.decor = d.decor ?? [];`를 넣는다.
5. `applySkyIfReady`가 `enterSky`에 넘기도록 바꾼다:

```ts
    const applySkyIfReady = () => {
      if (pendingSky && flightDone && pendingSky.songIds != null) {
        const { entry, songIds, decor } = pendingSky;
        pendingSky = null;
        flightDone = false;
        enterSky(entry, songIds, decor);
        window.setTimeout(() => setFlash(false), 250);
      }
    };
```

6. `enterSky`의 시그니처를 바꾼다: `const enterSky = (entry: StarEntry, songIds: number[], decor: string[]) => {`

- [ ] **Step 3: 씬에 넣기**

`enterSky` 안, 언덕 실루엣 블록(`// 2-1) 지평선 언덕 실루엣` 이 끝나는 `}` 다음)에 넣는다. 곡 별 배치(`// 4)`)보다 **앞**이어야 한다 — 하늘 오브젝트가 별보다 먼저 들어가야 겹칠 때 별이 위에 오고, 라벨을 가리지 않는다:

```ts
      // 2-2) 주인이 놓은 꾸미기 오브젝트 (SSOT: src/config/planet-decor.ts).
      // skyGroup에 넣어야 행성을 나갈 때 아래 dispose 경로를 함께 탄다
      for (const slug of decor) {
        const obj = buildDecor(slug, entry.data.userId, C, planet);
        if (obj) skyGroup.add(obj);
      }
```

- [ ] **Step 4: 등대 빛줄기 돌리기**

프레임 루프에서 `skyGroup`이 있을 때 회전시킨다. `skyRingMat.uniforms.uTime` 같은 것을 갱신하는 자리를 찾아 그 옆에 넣는다 (`grep -n "uTime.value" src/galaxy/GalaxyCanvas.tsx`로 찾을 것):

```ts
      // 등대 빛줄기 — 이름으로 찾아 돌린다. 오브젝트마다 갱신 함수를 들고 다니게 하면
      // 씬 그래프와 별개인 목록을 하나 더 관리해야 하고, 정리에서 새기 쉽다
      if (skyGroup) {
        for (const o of skyGroup.children) {
          const spin = o.getObjectByName("decor-spin");
          if (spin) spin.rotation.y += 0.004;
        }
      }
```

- [ ] **Step 5: 검증**

Run: `npx tsc --noEmit && npx eslint src/galaxy/planet-decor-objects.ts && npm run build 2>&1 | grep -E "Compiled successfully|Error" && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: 타입·린트 출력 없음, `✓ Compiled successfully`, `# fail 0`

`GalaxyCanvas.tsx`의 eslint는 **기존** 문제 9건이 그대로인지만 확인한다(새로 늘지 않았으면 통과).

- [ ] **Step 6: Commit**

```bash
git add src/galaxy/planet-decor-objects.ts src/galaxy/GalaxyCanvas.tsx
git commit -m "$(cat <<'EOF'
feat: 행성에 꾸미기 오브젝트 그리기

three 기본 도형으로 만든다 — 모델 파일도 로더도 늘리지 않고, 지금 행성이
전부 절차적이라 톤이 맞는다. skyGroup에 넣어 행성을 나갈 때 함께 정리된다.

[Prompts]
1. 이제 다음 기능을 추가해줘
2. 그렇게 진행해줘 우선 재화는필요없도록
EOF
)"
```

---

### Task 4: 고르는 화면

**Files:**
- Modify: `src/app/me/actions.ts`
- Modify: `src/app/me/page.tsx`

**Interfaces:**
- Consumes: `PLANET_DECOR` (Task 1), `listPlanetDecor`·`setPlanetDecor` (Task 2)
- Produces: `setPlanetDecorAction(formData: FormData): Promise<void>`

- [ ] **Step 1: 서버 액션**

`src/app/me/actions.ts` 끝에 추가 (import에 `setPlanetDecor`를 더한다):

```ts
/**
 * 꾸미기 오브젝트 켜고 끄기.
 * 대상 유저는 세션에서만 가져온다 — 폼에서 user id를 받으면 남의 행성을 꾸밀 수 있다.
 * 폼이 "뒤집어라"가 아니라 **원하는 상태**를 보낸다 — 뒤집기로 만들면 칩을 빠르게
 * 두 번 누를 때 먼저 온 요청이 지우고 나중 요청이 되살려 끄려던 것이 켜진 채 남는다.
 */
export async function setPlanetDecorAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  await setPlanetDecor(user.id, String(formData.get("slug") ?? ""), formData.get("on") === "1");
  revalidatePath("/me");
}
```

- [ ] **Step 2: 화면**

`src/app/me/page.tsx`:

1. import를 더한다:

```ts
import { PLANET_DECOR } from "@/config/planet-decor";
import { listPlanetDecor } from "@/server/planet-decor";
import { setPlanetDecorAction, setPlanetThemeAction } from "./actions";
```

(기존 `setPlanetThemeAction` import 줄을 위 형태로 합친다.)

2. `Promise.all([...])`에 `listPlanetDecor(user.id)`를 더하고 구조분해를 늘린다:
   `const [likedSongs, [star], clusterDist, [me], decor] = await Promise.all([...])`
3. 그 아래에 `const decorOn = new Set(decor);`를 둔다.
4. 행성 테마 섹션(`{star && (<section className="mb-8"> … 내 행성 테마 … </section>)}`)이 끝난 **직후**에 넣는다:

```tsx
        {/* 꾸미기 — 테마와 같이 별이 있을 때만 보인다 (별이 없으면 행성 자체가 없다) */}
        {star && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-white/60">
              행성 꾸미기 <span className="text-white/35">— 놓을 자리는 알아서 정해집니다</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {PLANET_DECOR.map((d) => {
                const on = decorOn.has(d.slug);
                return (
                  <form key={d.slug} action={setPlanetDecorAction}>
                    <input type="hidden" name="slug" value={d.slug} />
                    {/* 지금 상태의 반대를 "원하는 상태"로 보낸다 — 서버가 뒤집지 않으므로
                        같은 요청이 두 번 가도 결과가 같다 */}
                    <input type="hidden" name="on" value={on ? "0" : "1"} />
                    <button
                      type="submit"
                      aria-pressed={on}
                      className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition ${
                        on
                          ? "border-amber-200/60 bg-amber-100/15 text-amber-100"
                          : "border-white/15 bg-white/[0.03] text-white/70 hover:bg-white/10"
                      }`}
                    >
                      {on ? "✦ " : ""}
                      {d.label}
                    </button>
                  </form>
                );
              })}
            </div>
          </section>
        )}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npx eslint src/app/me/page.tsx src/app/me/actions.ts && npm run build 2>&1 | grep -E "Compiled successfully|Error"`
Expected: 타입·린트 출력 없음, `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add src/app/me/page.tsx src/app/me/actions.ts
git commit -m "$(cat <<'EOF'
feat: 내 취향 페이지에 행성 꾸미기 고르기

테마 고르기와 같은 서버 액션 패턴. 대상 유저는 세션에서만 가져온다 —
폼에서 user id를 받으면 남의 행성을 꾸밀 수 있다.

[Prompts]
1. 이제 다음 기능을 추가해줘
2. 그렇게 진행해줘 우선 재화는필요없도록
EOF
)"
```

---

## 컨트롤러가 하는 일 (구현자가 하지 않는다)

- **DB 테이블 만들기** — 로컬 Docker와 Neon 양쪽에 같은 SQL을 직접 적용한다. `drizzle-kit push`는 쓰지 않는다:

```sql
CREATE TABLE IF NOT EXISTS planet_decor (
  user_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug     text    NOT NULL,
  added_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slug)
);
```

- **브라우저 확인** (프로덕션 DB에 붙인 로컬 dev + 로그인 쿠키):
  - `/me`에서 칩을 켜면 눌린 상태로 남고, 새로고침해도 유지된다
  - 내 별에 착륙하면 켠 오브젝트가 보인다 — 나무·바위는 지면 위, 달은 하늘에
  - 껐다 다시 착륙하면 사라진다
  - 행성→행성 이동에서 앞 사람 오브젝트가 남지 않는다
  - 오브젝트가 곡 별·제목 라벨을 가리지 않는다
  - 등대 빛줄기가 돈다
  - 방문자(다른 계정·비로그인)로 그 행성에 들어가도 같은 오브젝트가 보인다

## 하지 않는 것 (스펙의 "하지 않는 것" 그대로)

- 드래그 자유 배치
- 해금·재화
- 오브젝트별 색·크기 지정 UI
- 오브젝트가 지면 곡률을 따라 기우는 처리
- 이미지→3D 캐릭터 (다음 기능)
