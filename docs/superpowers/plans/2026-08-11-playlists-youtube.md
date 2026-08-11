# 노래 목록 + YouTube 전체 재생 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 이름 붙인 노래 목록을 여러 개 만들어 공유하고, 그 목록의 곡을 YouTube 공식 임베드 플레이어로 전곡 재생할 수 있게 한다.

**Architecture:** `playlists`/`playlist_songs` 두 테이블을 추가하고, 기존 `PlayerProvider`가 재생 엔진 두 개(`preview`=`<audio>`, `youtube`=IFrame Player)를 소유해 곡마다 하나만 켠다. 영상 ID는 곡을 목록에 담는 순간 기존 `getYoutubeVideoId`로 한 번만 조회해 `songs` 테이블에 영구 캐시한다.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM + Postgres, next-auth v5, YouTube IFrame Player API, node:test + tsx(순수 로직 전용)

## Global Constraints

- **ytdl·yt-dlp 류 스트림 추출 금지.** 재생은 YouTube IFrame Player API로만. `<audio>`에는 iTunes/Deezer `previewUrl` 외에 어떤 것도 넣지 않는다.
- **영상은 화면에 보여야 한다.** 숨기거나 축소해 소리만 내면 약관 위반. 따라서 **접기 = 일시정지**를 코드로 강제한다.
- **동시 재생 금지.** 엔진 전환 시 반대쪽을 반드시 정지시킨다.
- **쿼터.** YouTube Data API 검색은 하루 100회. 영상 ID 조회는 **곡을 목록에 담을 때만** 발생해야 한다. 탐색·재생 경로에서 검색을 호출하면 안 된다.
- **SSOT.** 새 원본 정의는 같은 커밋에서 `docs/SSOT.md`에 기록한다. 곡 개수 같은 계산 가능한 값은 컬럼으로 저장하지 않는다.
- **환경변수는 `src/config/env.ts`를 통해서만** 읽는다. `process.env` 직접 접근 금지.
- **스키마 변경 시 로컬 Docker와 Neon 양쪽에 `db push`** 가 필요하다.
- 커밋 메시지는 `.claude/skills/commit-with-prompts` 형식을 따른다(본문에 `[Prompts]` 섹션).

## 검증 방식에 대하여

이 저장소에는 테스트 프레임워크가 없고, 지금까지 `npx tsc --noEmit` + `npm run lint` + 브라우저 확인으로 검증해 왔다. 이 계획은 그 관행을 따르되, **외부 의존 없이 순수하게 판단할 수 있는 로직 3개**(공유 slug 생성, 재생 엔진 선택, 곡 순서 계산)에만 테스트를 붙인다. 이 셋은 잘못되면 조용히 틀리는 종류라 테스트 가치가 높다. 나머지(라우트·UI·외부 API)는 기존대로 타입 검사와 브라우저로 확인한다.

테스트 러너는 **Node 20 내장 `node:test`** 를 쓰고, 이미 devDependency인 `tsx`로 실행한다. 처음에는 vitest를 쓰려 했으나 이 환경에서 `npm install`이 재현 가능하게 행이 걸린다 — `npm view`는 즉시 응답하는데 install만 CPU 0.4%로 18분 이상 멈춘다. 내장 러너는 새 패키지가 필요 없어 이 문제를 통째로 피한다.

실행 형태에 제약이 있다. Node 20의 기본 테스트 파일 패턴은 `.ts`를 인식하지 못해서 `tsx --test src/`(디렉터리)는 0개를 찾고, 따옴표로 감싼 글로브도 통하지 않는다. 파일 경로를 명시해 넘겨야 하므로 `find`로 치환한다 — 실측으로 이 형태만 동작한다.

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `src/db/schema.ts` (수정) | `playlists`, `playlistSongs` 테이블 정의 |
| `src/lib/share-slug.ts` (신규) | 공유 slug 생성 — 순수 함수 |
| `src/player/engine.ts` (신규) | 곡 하나에 어떤 엔진을 쓸지 판단 — 순수 함수 |
| `src/server/playlists.ts` (신규) | 목록 CRUD + 소유자 검사. DB 접근은 여기로 모은다 |
| `src/app/api/playlists/route.ts` (신규) | GET 내 목록 / POST 목록 생성 |
| `src/app/api/playlists/[id]/route.ts` (신규) | PATCH 이름·공유 변경 / DELETE 목록 삭제 |
| `src/app/api/playlists/[id]/songs/route.ts` (신규) | POST 곡 담기(영상 ID 조회 포함) / DELETE 곡 빼기 |
| `src/player/YoutubeStage.tsx` (신규) | IFrame Player 래퍼. 그리기만 하고 제어권은 Provider에 넘긴다 |
| `src/player/player-context.tsx` (수정) | 엔진 두 개 소유, 전환·볼륨·자동진행 통합 |
| `src/player/AddToPlaylist.tsx` (신규) | 알약의 `+` 팝오버 |
| `src/player/MiniPlayer.tsx` (수정) | `+` 버튼, 영상 패널, 접기 버튼 |
| `src/app/lists/page.tsx` (신규) | 내 목록 관리 |
| `src/app/lists/[id]/page.tsx` (신규) | 목록 상세(소유자) |
| `src/app/list/[slug]/page.tsx` (신규) | 공유 열람 |
| `src/components/PlaylistPlayButton.tsx` (신규) | 목록 재생 시작 버튼(클라이언트) |
| `docs/SSOT.md` (수정) | 새 원본 등록 |

---

### Task 1: 스키마 + 순수 로직 유틸 + 테스트

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/lib/share-slug.ts`
- Create: `src/player/engine.ts`
- Create: `src/lib/share-slug.test.ts`
- Create: `src/player/engine.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `schema.playlists` — 컬럼 `id, userId, name, shareSlug, createdAt, updatedAt`
  - `schema.playlistSongs` — 컬럼 `playlistId, songId, position, addedAt`
  - `generateShareSlug(random?: () => number): string`
  - `nextPosition(existing: number[]): number`
  - `type Engine = "preview" | "youtube"`
  - `pickEngine(opts: { mode: "playlist" | "browse"; youtubeVideoId?: string | null; previewUrl?: string | null }): Engine | null`

- [ ] **Step 1: 새 패키지 설치 없음 — 확인만**

이 태스크는 의존성을 추가하지 않는다. `node:test`(Node 20 내장)와 `tsx`(이미 devDependency)만 쓴다.
`npm install`은 이 환경에서 행이 걸리므로 **절대 실행하지 말 것.**

Run: `node --version && npx tsx --version`
Expected: `v20.x` 이상, `tsx v4.x`

- [ ] **Step 2: 테스트 스크립트 추가**

`package.json`의 `scripts`에 추가:

```json
"test": "tsx --test $(find src -name \"*.test.ts\")"
```

`find`로 파일을 명시해 넘기는 이유: Node 20의 기본 테스트 파일 패턴이 `.ts`를 인식하지 못해
`tsx --test src/`는 0개를 찾고, 따옴표로 감싼 글로브도 통하지 않는다. 실측으로 이 형태만 동작한다.

- [ ] **Step 3: 실패하는 테스트 작성 — share-slug**

`src/lib/share-slug.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateShareSlug } from "./share-slug";

describe("generateShareSlug", () => {
  it("10자를 만든다", () => {
    assert.equal(generateShareSlug().length, 10);
  });

  it("헷갈리는 글자(0 O 1 l I)를 쓰지 않는다", () => {
    // 링크를 손으로 옮겨 적는 사람이 있으므로 혼동 문자를 뺀다
    for (let i = 0; i < 200; i++) {
      assert.doesNotMatch(generateShareSlug(), /[0O1lI]/);
    }
  });

  it("난수원이 같으면 같은 값이 나온다", () => {
    const fixed = () => 0;
    assert.equal(generateShareSlug(fixed), generateShareSlug(fixed));
  });

  it("난수원이 다르면 다른 값이 나온다", () => {
    let n = 0;
    const seq = () => (n++ % 7) / 7;
    const a = generateShareSlug(seq);
    const b = generateShareSlug(seq);
    assert.notEqual(a, b);
  });
});
```

- [ ] **Step 4: 실패하는 테스트 작성 — nextPosition / pickEngine**

`src/player/engine.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextPosition, pickEngine } from "./engine";

describe("nextPosition", () => {
  it("빈 목록이면 0", () => {
    assert.equal(nextPosition([]), 0);
  });

  it("가장 큰 값 다음을 준다", () => {
    assert.equal(nextPosition([0, 1, 2]), 3);
  });

  it("구멍이 있어도 최대값 기준으로 준다", () => {
    // 곡을 빼면 position에 구멍이 생긴다. 길이가 아니라 최대값을 봐야 충돌하지 않는다
    assert.equal(nextPosition([0, 5]), 6);
  });
});

describe("pickEngine", () => {
  it("목록 재생이고 영상이 있으면 youtube", () => {
    assert.equal(pickEngine({ mode: "playlist", youtubeVideoId: "abc", previewUrl: "p" }), "youtube");
  });

  it("목록 재생이어도 영상이 없으면 preview로 떨어진다", () => {
    assert.equal(pickEngine({ mode: "playlist", youtubeVideoId: null, previewUrl: "p" }), "preview");
  });

  it("탐색 중에는 영상이 있어도 preview를 쓴다", () => {
    // 쿼터와 UX 모두의 이유 — 은하 탐색은 30초 미리듣기로 가볍게 유지한다
    assert.equal(pickEngine({ mode: "browse", youtubeVideoId: "abc", previewUrl: "p" }), "preview");
  });

  it("둘 다 없으면 null (호출부가 다음 곡으로 건너뛴다)", () => {
    assert.equal(pickEngine({ mode: "playlist", youtubeVideoId: null, previewUrl: null }), null);
  });
});
```

- [ ] **Step 5: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './share-slug'`, `Cannot find module './engine'`

- [ ] **Step 6: share-slug 구현**

`src/lib/share-slug.ts`:

```ts
/**
 * 공유 링크용 slug 생성 — playlists.share_slug의 값 원본 (docs/SSOT.md).
 *
 * 0/O, 1/l/I처럼 눈으로 헷갈리는 글자는 뺐다. 링크를 손으로 옮겨 적는 경우가 있고,
 * 한 글자만 틀려도 404가 되기 때문이다.
 * 32글자 중 10자 → 약 1조 가지. 충돌은 DB의 unique 제약이 최종적으로 막는다.
 */
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const LENGTH = 10;

export function generateShareSlug(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}
```

- [ ] **Step 7: engine 구현**

`src/player/engine.ts`:

```ts
/**
 * 재생 엔진 선택 — PlayerProvider가 곡마다 이 판단으로 하나만 켠다 (docs/SSOT.md).
 *
 * 목록 재생일 때만 YouTube를 쓴다. 은하 탐색까지 영상으로 하면 화면이 무거워지고,
 * 무엇보다 영상 ID 조회가 쿼터(하루 100곡)를 태운다.
 */
export type Engine = "preview" | "youtube";

export function pickEngine(opts: {
  mode: "playlist" | "browse";
  youtubeVideoId?: string | null;
  previewUrl?: string | null;
}): Engine | null {
  if (opts.mode === "playlist" && opts.youtubeVideoId) return "youtube";
  if (opts.previewUrl) return "preview";
  return null;
}

/**
 * 목록에 곡을 새로 담을 때 줄 position.
 * 곡을 빼면 구멍이 생기므로 길이가 아니라 최대값 기준으로 매긴다.
 */
export function nextPosition(existing: number[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing) + 1;
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 11 tests

- [ ] **Step 9: 스키마에 테이블 추가**

`src/db/schema.ts`의 `userStars` 정의 아래, `export type Theme = ...` 위에 추가:

```ts
/** 사용자가 만든 노래 목록. share_slug가 있으면 그 slug를 아는 누구나 열람 가능 */
export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  /** NULL이면 비공개. 값이 있으면 /list/[slug]로 열람 가능 */
  shareSlug: text("share_slug").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 목록에 담긴 곡. 곡 개수는 여기서 count로 구한다 — 컬럼으로 저장하지 않는다 (SSOT).
 * position은 구멍이 생길 수 있으므로 순서 비교용으로만 쓰고 인덱스로 쓰지 않는다.
 */
export const playlistSongs = pgTable(
  "playlist_songs",
  {
    playlistId: integer("playlist_id").notNull(),
    songId: integer("song_id").notNull(),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.playlistId, table.songId] })],
);
```

파일 맨 아래 타입 export 옆에 추가:

```ts
export type Playlist = typeof playlists.$inferSelect;
export type PlaylistSong = typeof playlistSongs.$inferSelect;
```

- [ ] **Step 10: 로컬 DB에 반영**

```bash
npm run db:up
npm run db:push
```

Expected: `playlists`, `playlist_songs` 두 테이블 생성됨

- [ ] **Step 11: 타입 검사 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 새 파일에서 오류 없음 (기존 파일의 기존 오류는 무시)

- [ ] **Step 12: 커밋**

```bash
git add package.json src/db/schema.ts src/lib/share-slug.ts src/lib/share-slug.test.ts src/player/engine.ts src/player/engine.test.ts
git commit -m "feat: 노래 목록 스키마 + 공유 slug·엔진 선택 유틸"
```

---

### Task 2: 목록 서버 함수 + API 라우트

**Files:**
- Create: `src/server/playlists.ts`
- Create: `src/app/api/playlists/route.ts`
- Create: `src/app/api/playlists/[id]/route.ts`

**Interfaces:**
- Consumes: `schema.playlists`, `schema.playlistSongs`, `generateShareSlug`, `getSessionUser` (기존 `src/auth.ts`)
- Produces:
  - `interface PlaylistSummary { id: number; name: string; shareSlug: string | null; songCount: number; updatedAt: string }`
  - `listMyPlaylists(userId: number): Promise<PlaylistSummary[]>`
  - `createPlaylist(userId: number, name: string): Promise<PlaylistSummary>`
  - `renamePlaylist(userId: number, id: number, name: string): Promise<boolean>`
  - `setPlaylistShared(userId: number, id: number, shared: boolean): Promise<string | null>`
  - `deletePlaylist(userId: number, id: number): Promise<boolean>`

- [ ] **Step 1: 서버 함수 작성**

`src/server/playlists.ts`:

```ts
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateShareSlug } from "@/lib/share-slug";

/** 목록 한 줄 요약 — 곡 개수는 저장하지 않고 매번 센다 (SSOT) */
export interface PlaylistSummary {
  id: number;
  name: string;
  shareSlug: string | null;
  songCount: number;
  updatedAt: string;
}

export const NAME_MAX = 40;

/** 이름 정리 — 앞뒤 공백 제거, 길이 제한. 빈 이름은 거부한다 */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, NAME_MAX);
  return name.length > 0 ? name : null;
}

export async function listMyPlaylists(userId: number): Promise<PlaylistSummary[]> {
  const rows = await db
    .select({
      id: schema.playlists.id,
      name: schema.playlists.name,
      shareSlug: schema.playlists.shareSlug,
      updatedAt: schema.playlists.updatedAt,
      songCount: sql<number>`(
        select count(*)::int from playlist_songs ps where ps.playlist_id = ${schema.playlists.id}
      )`,
    })
    .from(schema.playlists)
    .where(eq(schema.playlists.userId, userId))
    .orderBy(desc(schema.playlists.updatedAt));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function createPlaylist(userId: number, name: string): Promise<PlaylistSummary> {
  const [row] = await db
    .insert(schema.playlists)
    .values({ userId, name })
    .returning({
      id: schema.playlists.id,
      name: schema.playlists.name,
      shareSlug: schema.playlists.shareSlug,
      updatedAt: schema.playlists.updatedAt,
    });
  return { ...row, songCount: 0, updatedAt: row.updatedAt.toISOString() };
}

export async function renamePlaylist(userId: number, id: number, name: string): Promise<boolean> {
  const r = await db
    .update(schema.playlists)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
    .returning({ id: schema.playlists.id });
  return r.length > 0;
}

/**
 * 공유 켜기/끄기. 켜면 slug를 만들고, 끄면 NULL로 되돌린다 —
 * 끄는 순간 기존 링크는 죽는다(의도된 동작).
 * slug 충돌은 unique 제약이 막으므로 몇 번 다시 시도한다.
 */
export async function setPlaylistShared(
  userId: number,
  id: number,
  shared: boolean,
): Promise<string | null> {
  if (!shared) {
    await db
      .update(schema.playlists)
      .set({ shareSlug: null, updatedAt: new Date() })
      .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)));
    return null;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateShareSlug();
    try {
      const r = await db
        .update(schema.playlists)
        .set({ shareSlug: slug, updatedAt: new Date() })
        .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
        .returning({ shareSlug: schema.playlists.shareSlug });
      if (r.length === 0) return null; // 내 목록이 아님
      return r[0].shareSlug;
    } catch {
      // unique 충돌 — 다른 slug로 다시
    }
  }
  throw new Error("공유 링크를 만들지 못했습니다");
}

export async function deletePlaylist(userId: number, id: number): Promise<boolean> {
  const r = await db
    .delete(schema.playlists)
    .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
    .returning({ id: schema.playlists.id });
  if (r.length === 0) return false;
  // 목록이 사라지면 담긴 곡 행도 의미가 없다 (FK 제약을 두지 않았으므로 직접 지운다)
  await db.delete(schema.playlistSongs).where(eq(schema.playlistSongs.playlistId, id));
  return true;
}
```

- [ ] **Step 2: 목록 컬렉션 라우트 작성**

`src/app/api/playlists/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { createPlaylist, listMyPlaylists, normalizeName } from "@/server/playlists";

export const dynamic = "force-dynamic";

/** GET /api/playlists — 내 목록 (알약의 담기 팝오버가 쓴다) */
export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ authenticated: false, playlists: [] });
  return NextResponse.json({ authenticated: true, playlists: await listMyPlaylists(user.id) });
}

/** POST /api/playlists { name } — 목록 생성 */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = normalizeName(body?.name);
  if (!name) return NextResponse.json({ error: "목록 이름이 필요합니다" }, { status: 400 });
  return NextResponse.json({ playlist: await createPlaylist(user.id, name) });
}
```

- [ ] **Step 3: 개별 목록 라우트 작성**

`src/app/api/playlists/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { deletePlaylist, normalizeName, renamePlaylist, setPlaylistShared } from "@/server/playlists";

export const dynamic = "force-dynamic";

/** PATCH /api/playlists/[id] { name? , shared? } — 이름 변경 / 공유 켜고 끄기 */
export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; shared?: unknown }
    | null;

  if (body?.name !== undefined) {
    const name = normalizeName(body.name);
    if (!name) return NextResponse.json({ error: "목록 이름이 필요합니다" }, { status: 400 });
    if (!(await renamePlaylist(user.id, id, name))) {
      return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
    }
  }

  let shareSlug: string | null = null;
  if (body?.shared !== undefined) {
    shareSlug = await setPlaylistShared(user.id, id, Boolean(body.shared));
  }
  return NextResponse.json({ ok: true, shareSlug });
}

/** DELETE /api/playlists/[id] — 목록 삭제 */
export async function DELETE(
  _req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  if (!(await deletePlaylist(user.id, id))) {
    return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: 타입 검사 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 새 파일에서 오류 없음

- [ ] **Step 5: 로그인 없이 401이 나오는지 확인**

개발 서버를 띄운 뒤:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/playlists \
  -H 'content-type: application/json' -d '{"name":"테스트"}'
```

Expected: `401`

- [ ] **Step 6: 커밋**

```bash
git add src/server/playlists.ts src/app/api/playlists
git commit -m "feat: 노래 목록 CRUD API"
```

---

### Task 3: 곡 담기 API (영상 ID 조회 포함)

**Files:**
- Modify: `src/server/playlists.ts`
- Create: `src/app/api/playlists/[id]/songs/route.ts`

**Interfaces:**
- Consumes: `nextPosition` (Task 1), `getYoutubeVideoId` (기존 `src/server/youtube.ts`)
- Produces:
  - `addSongToPlaylist(userId: number, playlistId: number, songId: number): Promise<"added" | "already" | "forbidden">`
  - `removeSongFromPlaylist(userId: number, playlistId: number, songId: number): Promise<boolean>`
  - `interface PlaylistDetail { id: number; name: string; shareSlug: string | null; ownerId: number; songs: PlaylistTrack[] }`
  - `interface PlaylistTrack { id: number; title: string; artist: string; genre: string; youtubeVideoId: string | null }`
  - `getPlaylistById(id: number): Promise<PlaylistDetail | null>`
  - `getPlaylistBySlug(slug: string): Promise<PlaylistDetail | null>`

- [ ] **Step 1: 서버 함수 추가**

`src/server/playlists.ts` 맨 아래에 추가 (파일 상단 import에 `getYoutubeVideoId`, `nextPosition` 추가):

```ts
import { nextPosition } from "@/player/engine";
import { getYoutubeVideoId } from "@/server/youtube";

export interface PlaylistTrack {
  id: number;
  title: string;
  artist: string;
  genre: string;
  youtubeVideoId: string | null;
}

export interface PlaylistDetail {
  id: number;
  name: string;
  shareSlug: string | null;
  ownerId: number;
  songs: PlaylistTrack[];
}

/** 내 목록인지 확인 */
async function ownsPlaylist(userId: number, playlistId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.playlists.id })
    .from(schema.playlists)
    .where(and(eq(schema.playlists.id, playlistId), eq(schema.playlists.userId, userId)));
  return row != null;
}

/**
 * 목록에 곡을 담는다.
 *
 * 여기가 YouTube 영상 ID를 찾는 **유일한 지점**이다. 탐색·재생 경로에서 부르면
 * 하루 100회 검색 쿼터가 순식간에 마른다. getYoutubeVideoId는 이미 캐시를 보므로
 * 이미 찾아둔 곡이면 외부 호출이 나가지 않는다.
 * 조회에 실패해도 담기는 성공시킨다 — 그 곡만 미리듣기로 재생되고,
 * 영상은 다음에 다시 시도된다.
 */
export async function addSongToPlaylist(
  userId: number,
  playlistId: number,
  songId: number,
): Promise<"added" | "already" | "forbidden"> {
  if (!(await ownsPlaylist(userId, playlistId))) return "forbidden";

  const existing = await db
    .select({ songId: schema.playlistSongs.songId, position: schema.playlistSongs.position })
    .from(schema.playlistSongs)
    .where(eq(schema.playlistSongs.playlistId, playlistId));
  if (existing.some((e) => e.songId === songId)) return "already";

  await db.insert(schema.playlistSongs).values({
    playlistId,
    songId,
    position: nextPosition(existing.map((e) => e.position)),
  });
  await db
    .update(schema.playlists)
    .set({ updatedAt: new Date() })
    .where(eq(schema.playlists.id, playlistId));

  await getYoutubeVideoId(songId).catch(() => null);
  return "added";
}

export async function removeSongFromPlaylist(
  userId: number,
  playlistId: number,
  songId: number,
): Promise<boolean> {
  if (!(await ownsPlaylist(userId, playlistId))) return false;
  await db
    .delete(schema.playlistSongs)
    .where(
      and(
        eq(schema.playlistSongs.playlistId, playlistId),
        eq(schema.playlistSongs.songId, songId),
      ),
    );
  await db
    .update(schema.playlists)
    .set({ updatedAt: new Date() })
    .where(eq(schema.playlists.id, playlistId));
  return true;
}

/** 목록 + 담긴 곡 (position 순). 열람 권한 판단은 호출부가 한다 */
async function loadDetail(where: SQL): Promise<PlaylistDetail | null> {
  const [pl] = await db
    .select({
      id: schema.playlists.id,
      name: schema.playlists.name,
      shareSlug: schema.playlists.shareSlug,
      ownerId: schema.playlists.userId,
    })
    .from(schema.playlists)
    .where(where);
  if (!pl) return null;

  const songs = await db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.songs.artist,
      genre: schema.songs.genre,
      youtubeVideoId: schema.songs.youtubeVideoId,
    })
    .from(schema.playlistSongs)
    .innerJoin(schema.songs, eq(schema.songs.id, schema.playlistSongs.songId))
    .where(eq(schema.playlistSongs.playlistId, pl.id))
    .orderBy(schema.playlistSongs.position);

  return { ...pl, songs };
}

export function getPlaylistById(id: number): Promise<PlaylistDetail | null> {
  return loadDetail(eq(schema.playlists.id, id));
}

export function getPlaylistBySlug(slug: string): Promise<PlaylistDetail | null> {
  return loadDetail(eq(schema.playlists.shareSlug, slug));
}
```

- [ ] **Step 2: 곡 라우트 작성**

`src/app/api/playlists/[id]/songs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { addSongToPlaylist, removeSongFromPlaylist } from "@/server/playlists";

export const dynamic = "force-dynamic";

async function parse(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<{ playlistId: number; songId: number } | null> {
  const playlistId = Number((await props.params).id);
  const body = (await req.json().catch(() => null)) as { songId?: unknown } | null;
  const songId = Number(body?.songId);
  if (!Number.isInteger(playlistId) || !Number.isInteger(songId)) return null;
  return { playlistId, songId };
}

/** POST /api/playlists/[id]/songs { songId } — 곡 담기 */
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const p = await parse(req, props);
  if (!p) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  const result = await addSongToPlaylist(user.id, p.playlistId, p.songId);
  if (result === "forbidden") {
    return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, already: result === "already" });
}

/** DELETE /api/playlists/[id]/songs { songId } — 곡 빼기 */
export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const p = await parse(req, props);
  if (!p) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  if (!(await removeSongFromPlaylist(user.id, p.playlistId, p.songId))) {
    return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 타입 검사 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 4: 담기가 검색을 한 번만 부르는지 확인**

같은 곡을 두 번 담아본다. 두 번째는 `already: true`가 오고 `getYoutubeVideoId`가 호출되지 않아야 한다(이미 담긴 곡은 insert 전에 반환). 세 번째로 **다른** 곡을 담으면 `songs.youtube_checked_at`이 채워진다.

```bash
psql "$DATABASE_URL" -c "select id, title, youtube_video_id, youtube_checked_at from songs where youtube_checked_at is not null order by youtube_checked_at desc limit 5;"
```

- [ ] **Step 5: 커밋**

```bash
git add src/server/playlists.ts src/app/api/playlists
git commit -m "feat: 목록에 곡 담기·빼기 (담을 때 YouTube 영상 ID 조회)"
```

---

### Task 4: PlayerProvider 엔진 확장 + YouTube 무대

**Files:**
- Create: `src/player/YoutubeStage.tsx`
- Modify: `src/player/player-context.tsx`

**Interfaces:**
- Consumes: `pickEngine`, `Engine` (Task 1)
- Produces (`PlayerContextValue`에 추가되는 것):
  - `engine: Engine | null`
  - `videoExpanded: boolean`
  - `setVideoExpanded: (v: boolean) => void`
  - `playPlaylist(queue: PlayerQueue, songId: number): Promise<void>`
  - `registerYoutube(api: YoutubeApi | null): void`
  - `interface YoutubeApi { load(videoId: string): void; play(): void; pause(): void; stop(): void; setVolume(v0to1: number): void }`
  - `PlayerSong`에 `youtubeVideoId?: string | null` 추가
  - `PlayerQueue`에 `mode?: "playlist" | "browse"` 추가 (없으면 `"browse"`)

- [ ] **Step 1: YouTube 무대 컴포넌트 작성**

`src/player/YoutubeStage.tsx`:

```tsx
"use client";

/**
 * YouTube IFrame Player 래퍼.
 *
 * 이 컴포넌트는 "그리기"만 한다. 무엇을 언제 트는지는 PlayerProvider가 정한다 —
 * 그래야 페이지를 옮겨도 재생이 이어지는 기존 구조가 유지된다.
 * 마운트되면 registerYoutube로 제어 API를 넘기고, 언마운트되면 null로 지운다.
 *
 * 약관: 이 플레이어는 화면에 보여야 한다. 숨긴 채 소리만 내면 위반이므로
 * 호출부(MiniPlayer)가 "접기 = 일시정지"를 지킨다.
 */
import { useEffect, useRef } from "react";
import type { YoutubeApi } from "./player-context";

interface YT {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer;
  PlayerState: { ENDED: number };
}
interface YtPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(v: number): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** IFrame API 스크립트는 한 번만 읽는다 (여러 번 마운트돼도 재사용) */
let apiPromise: Promise<YT> | null = null;
function loadApi(): Promise<YT> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YT>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YT 없음"));
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => reject(new Error("IFrame API 로드 실패"));
    document.head.appendChild(s);
  });
  return apiPromise;
}

export default function YoutubeStage({
  register,
  onEnded,
  onError,
}: {
  register: (api: YoutubeApi | null) => void;
  onEnded: () => void;
  onError: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // 콜백을 ref로 잡아둔다 — 플레이어를 다시 만들지 않고 최신 핸들러를 부르기 위해
  const endedRef = useRef(onEnded);
  const errorRef = useRef(onError);
  endedRef.current = onEnded;
  errorRef.current = onError;

  useEffect(() => {
    let player: YtPlayer | null = null;
    let cancelled = false;

    void loadApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        player = new YT.Player(hostRef.current, {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onStateChange: (e: { data: number }) => {
              if (e.data === YT.PlayerState.ENDED) endedRef.current();
            },
            onError: () => errorRef.current(),
          },
        });
        register({
          load: (videoId) => player?.loadVideoById(videoId),
          play: () => player?.playVideo(),
          pause: () => player?.pauseVideo(),
          stop: () => player?.stopVideo(),
          setVolume: (v) => player?.setVolume(Math.round(v * 100)),
        });
      })
      .catch(() => errorRef.current());

    return () => {
      cancelled = true;
      register(null);
      player?.destroy();
    };
  }, [register]);

  // 볼륨은 이 컴포넌트가 관리하지 않는다 — PlayerProvider의 changeVolume이
  // registerYoutube로 받은 손잡이에 직접 setVolume을 건다 (단일 원본).

  return <div ref={hostRef} className="h-full w-full" />;
}
```

- [ ] **Step 2: PlayerProvider에 엔진 상태 추가**

`src/player/player-context.tsx`에서:

`PlayerSong`에 필드 추가:

```ts
export interface PlayerSong {
  id: number;
  title: string;
  artist: string;
  index?: number;
  popularity?: number;
  /** 목록 재생에서 YouTube 전곡 재생에 쓴다. 없으면 미리듣기로 떨어진다 */
  youtubeVideoId?: string | null;
}
```

`PlayerQueue`에 필드 추가:

```ts
export interface PlayerQueue {
  title: string;
  subtitle?: string;
  color?: string;
  /** playlist면 YouTube 전곡 재생을 시도한다. 없으면 browse(30초 미리듣기) */
  mode?: "playlist" | "browse";
  songs: PlayerSong[];
}
```

파일 상단 import에 추가:

```ts
import { pickEngine, type Engine } from "./engine";
```

`YoutubeApi` 타입을 export:

```ts
/** YoutubeStage가 넘겨주는 제어 손잡이. 제어권은 Provider가 갖는다 */
export interface YoutubeApi {
  load(videoId: string): void;
  play(): void;
  pause(): void;
  stop(): void;
  setVolume(v0to1: number): void;
}
```

`PlayerContextValue`에 추가:

```ts
  engine: Engine | null;
  /** 영상 패널이 펼쳐져 있는지. 접으면 재생도 멈춘다 (약관: 영상은 보여야 한다) */
  videoExpanded: boolean;
  setVideoExpanded: (v: boolean) => void;
  /** 목록 재생 시작 — YouTube 전곡 재생을 시도한다 */
  playPlaylist: (queue: PlayerQueue, songId: number) => Promise<void>;
  registerYoutube: (api: YoutubeApi | null) => void;
```

- [ ] **Step 3: Provider 본문에 엔진 구현**

`PlayerProvider` 안, `const [uiHosted, setUiHosted] = useState(false);` 아래에 추가:

```ts
  const [engine, setEngineState] = useState<Engine | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [videoExpanded, setVideoExpandedState] = useState(false);
  const ytRef = useRef<YoutubeApi | null>(null);

  const setEngine = useCallback((e: Engine | null) => {
    engineRef.current = e;
    setEngineState(e);
  }, []);

  const registerYoutube = useCallback((api: YoutubeApi | null) => {
    ytRef.current = api;
    if (api) api.setVolume(volumeRef.current);
  }, []);

  /** 지금 켜져 있지 않은 엔진을 확실히 끈다 — 두 곳에서 동시에 소리가 나면 안 된다 */
  const silenceOther = useCallback((keep: Engine) => {
    if (keep === "youtube") audioRef.current?.pause();
    else ytRef.current?.stop();
  }, []);
```

`playSong`을 엔진 인지형으로 교체:

```ts
  const playSong = useCallback(
    (song: PlayerSong, previewUrl: string | null, mode: "playlist" | "browse"): Promise<void> => {
      const chosen = pickEngine({
        mode,
        youtubeVideoId: song.youtubeVideoId,
        previewUrl,
      });
      if (!chosen) return Promise.reject(new Error("no-source"));

      silenceOther(chosen);
      setEngine(chosen);
      setPlayingId(song.id);
      setIsPaused(false);

      if (chosen === "youtube") {
        // 영상을 트려면 패널이 보여야 한다
        setVideoExpandedState(true);
        const yt = ytRef.current;
        if (!yt) return Promise.reject(new Error("yt-not-ready"));
        yt.setVolume(volumeRef.current);
        yt.load(song.youtubeVideoId as string);
        yt.play();
        return Promise.resolve();
      }

      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      audio.volume = volumeRef.current;
      audio.src = previewUrl as string;
      audio.onended = () => void advanceRef.current(song.id);
      return audio.play();
    },
    [setEngine, setPlayingId, silenceOther],
  );
```

- [ ] **Step 4: 볼륨·토글·정지를 엔진에 위임**

`changeVolume` 본문에서 `if (audioRef.current) audioRef.current.volume = v;` 다음 줄에 추가:

```ts
    ytRef.current?.setVolume(v);
```

`toggle`을 교체:

```ts
  const toggle = useCallback(() => {
    if (playingIdRef.current === null) return;
    if (engineRef.current === "youtube") {
      const yt = ytRef.current;
      if (!yt) return;
      if (isPausedRef.current) {
        setVideoExpandedState(true); // 접힌 채로 재생되면 안 된다
        yt.play();
        setIsPaused(false);
      } else {
        yt.pause();
        setIsPaused(true);
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) {
      setIsPaused(false);
      audio.play().catch(() => setPlayingId(null));
    } else {
      audio.pause();
      setIsPaused(true);
    }
  }, [setPlayingId]);
```

`isPaused`의 ref가 필요하다. `const [isPaused, setIsPaused] = useState(false);` 아래에 추가하고, `setIsPaused` 호출부가 많으므로 래퍼를 만든다:

```ts
  const isPausedRef = useRef(false);
  const setPaused = useCallback((v: boolean) => {
    isPausedRef.current = v;
    setIsPaused(v);
  }, []);
```

이 태스크에서 `setIsPaused(...)` 호출을 모두 `setPaused(...)`로 바꾼다.

`stop`을 교체:

```ts
  const stop = useCallback(() => {
    audioRef.current?.pause();
    ytRef.current?.stop();
    setEngine(null);
    setVideoExpandedState(false);
    setPlayingId(null);
    setPaused(false);
    queueRef.current = null;
    setQueueState(null);
  }, [setEngine, setPaused, setPlayingId]);
```

- [ ] **Step 5: 접기 = 일시정지 연결**

```ts
  /**
   * 영상 패널 접기/펼치기.
   * 접으면 반드시 멈춘다 — 영상을 숨긴 채 소리만 내는 것은 YouTube 약관 위반이다.
   */
  const setVideoExpanded = useCallback(
    (v: boolean) => {
      setVideoExpandedState(v);
      if (!v && engineRef.current === "youtube") {
        ytRef.current?.pause();
        setPaused(true);
      }
    },
    [setPaused],
  );
```

- [ ] **Step 6: 목록 재생 진입점 추가**

```ts
  /** 목록 재생 시작 — 큐에 mode: "playlist"를 박아 YouTube 전곡 재생을 시도한다 */
  const playPlaylist = useCallback(
    async (q: PlayerQueue, songId: number): Promise<void> => {
      const withMode: PlayerQueue = { ...q, mode: "playlist" };
      queueRef.current = withMode;
      setQueueState(withMode);
      const song = withMode.songs.find((s) => s.id === songId);
      if (!song) throw new Error("곡이 목록에 없습니다");
      let m = mediaRef.current[songId];
      if (!m && !song.youtubeVideoId) {
        await fetchMedia([songId]);
        m = mediaRef.current[songId];
      }
      await playSong(song, m?.previewUrl ?? null, "playlist");
    },
    [fetchMedia, playSong],
  );
```

- [ ] **Step 7: advanceRef / playStep / playFrom / restore를 새 playSong 시그니처에 맞추기**

`playSong(song.id, m.previewUrl)` 형태의 호출을 모두 `playSong(song, m?.previewUrl ?? null, q.mode ?? "browse")`로 바꾼다. `advanceRef`의 곡 탐색 루프에서 "재생 가능한 곡" 판정도 바뀐다 — 미리듣기만 보던 것을 엔진 기준으로 바꾼다:

```ts
        const usable = pickEngine({
          mode: q.mode ?? "browse",
          youtubeVideoId: song.youtubeVideoId,
          previewUrl: m?.previewUrl,
        });
        if (usable) {
          playSong(song, m?.previewUrl ?? null, q.mode ?? "browse").catch(() =>
            setPlayingId(null),
          );
          return;
        }
```

같은 교체를 `playStep`의 루프에도 적용한다. `playFrom`은 탐색용이므로 `"browse"`를 넘긴다. `restore`는 스냅샷의 큐 `mode`를 따른다.

- [ ] **Step 8: value에 새 항목 추가**

`useMemo`의 객체와 의존성 배열에 `engine`, `videoExpanded`, `setVideoExpanded`, `playPlaylist`, `registerYoutube`를 추가한다.

- [ ] **Step 9: 타입 검사 + 린트 + 단위 테스트**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 오류 없음, 테스트 11개 통과

- [ ] **Step 10: 커밋**

```bash
git add src/player/player-context.tsx src/player/YoutubeStage.tsx
git commit -m "feat: 플레이어가 미리듣기·YouTube 두 엔진을 소유"
```

---

### Task 5: 알약에 영상 패널과 담기 버튼

**Files:**
- Create: `src/player/AddToPlaylist.tsx`
- Modify: `src/player/MiniPlayer.tsx`

**Interfaces:**
- Consumes: `usePlayer()`의 `engine`, `videoExpanded`, `setVideoExpanded`, `registerYoutube`, `playStep`, `volume`; `/api/playlists`, `/api/playlists/[id]/songs`
- Produces: 없음 (화면 끝단)

- [ ] **Step 1: 담기 팝오버 작성**

`src/player/AddToPlaylist.tsx`:

```tsx
"use client";

/**
 * 지금 듣는 곡을 목록에 담는 팝오버.
 * 목록이 하나도 없으면 그 자리에서 이름을 입력해 만든다 —
 * 목록을 만들러 다른 페이지로 보내면 담으려던 곡을 놓친다.
 */
import { useEffect, useState } from "react";

interface Item {
  id: number;
  name: string;
  songCount: number;
}

export default function AddToPlaylist({
  songId,
  onClose,
}: {
  songId: number;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [authed, setAuthed] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/playlists");
      const j = (await r.json()) as { authenticated: boolean; playlists: Item[] };
      setAuthed(j.authenticated);
      setItems(j.playlists);
    })();
  }, []);

  const add = async (playlistId: number, label: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId }),
      });
      const j = (await r.json()) as { ok?: boolean; already?: boolean };
      setDone(j.already ? `이미 «${label}»에 있어요` : `«${label}»에 담았어요`);
      setTimeout(onClose, 1200);
    } catch {
      setDone("담지 못했어요");
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const j = (await r.json()) as { playlist?: Item };
    if (j.playlist) await add(j.playlist.id, j.playlist.name);
    else {
      setDone("목록을 만들지 못했어요");
      setBusy(false);
    }
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 w-full rounded-2xl border border-white/15 bg-black/90 p-3 text-sm shadow-xl backdrop-blur">
      {done ? (
        <p className="py-2 text-center text-white/70">{done}</p>
      ) : !authed ? (
        <a href="/api/auth/signin" className="block py-2 text-center underline">
          로그인하고 목록에 담기
        </a>
      ) : (
        <>
          {items && items.length > 0 && (
            <ul className="mb-2 max-h-40 overflow-y-auto">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void add(p.id, p.name)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-white/35">{p.songCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAndAdd();
              }}
              placeholder="새 목록 이름"
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => void createAndAdd()}
              className="shrink-0 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 transition hover:bg-white/20 disabled:opacity-40"
            >
              담기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 알약에 영상 패널 붙이기**

`src/player/MiniPlayer.tsx`의 `{/* 알약 본체 */}` 바로 위에 추가:

```tsx
      {/* 목록 재생 중에는 영상이 보여야 한다 (약관). 접으면 재생도 멈춘다 */}
      {engine === "youtube" && videoExpanded && (
        <div className="mb-2 w-full overflow-hidden rounded-2xl border border-white/15 bg-black shadow-xl">
          <div className="aspect-video w-full">
            <YoutubeStage
              register={registerYoutube}
              onEnded={() => void playStep(1)}
              onError={() => void playStep(1)}
            />
          </div>
          <button
            type="button"
            onClick={() => setVideoExpanded(false)}
            className="w-full py-1.5 text-xs text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            영상 접기 (재생이 멈춥니다)
          </button>
        </div>
      )}
```

파일 상단 import에 추가:

```tsx
import YoutubeStage from "./YoutubeStage";
import AddToPlaylist from "./AddToPlaylist";
```

`usePlayer()` 구조분해에 `engine, videoExpanded, setVideoExpanded, registerYoutube`를 추가한다.

- [ ] **Step 3: 접힌 상태에서 다시 펼치는 버튼**

같은 위치에, 접혔을 때만 보이는 버튼을 추가:

```tsx
      {engine === "youtube" && !videoExpanded && (
        <button
          type="button"
          onClick={() => {
            setVideoExpanded(true);
            toggle();
          }}
          className="mb-2 w-full rounded-full border border-white/15 bg-black/80 py-1.5 text-xs text-white/70 backdrop-blur transition hover:bg-white/10"
        >
          영상 펼치고 이어 듣기
        </button>
      )}
```

- [ ] **Step 4: 담기 버튼 추가**

♥ 버튼(`aria-label`이 "좋아요"인 것) 바로 다음에 추가:

```tsx
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-white/20 bg-white/10 text-sm text-white/70 transition hover:bg-white/20"
            aria-label="목록에 담기"
            title="목록에 담기"
          >
            +
          </button>
```

컴포넌트 상단에 상태를 추가하고, 팝오버를 알약 본체 바깥(`{/* 알약 본체 */}` 위)에 렌더한다:

```tsx
  const [addOpen, setAddOpen] = useState(false);
```

```tsx
      {addOpen && playingId !== null && (
        <AddToPlaylist songId={playingId} onClose={() => setAddOpen(false)} />
      )}
```

- [ ] **Step 5: 타입 검사 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/player/MiniPlayer.tsx src/player/AddToPlaylist.tsx
git commit -m "feat: 알약에 목록 담기 버튼과 YouTube 영상 패널"
```

---

### Task 6: 목록 화면 (관리 · 상세 · 공유)

**Files:**
- Create: `src/components/PlaylistPlayButton.tsx`
- Create: `src/app/lists/page.tsx`
- Create: `src/app/lists/[id]/page.tsx`
- Create: `src/app/list/[slug]/page.tsx`
- Create: `src/app/lists/PlaylistManager.tsx`

**Interfaces:**
- Consumes: `listMyPlaylists`, `getPlaylistById`, `getPlaylistBySlug`, `PlaylistDetail`, `PlaylistTrack` (Task 2·3), `usePlayer().playPlaylist` (Task 4)
- Produces: 없음 (화면 끝단)

- [ ] **Step 1: 재생 버튼 작성**

`src/components/PlaylistPlayButton.tsx`:

```tsx
"use client";

/** 목록 재생 시작 — 서버 컴포넌트에서 넘겨준 곡들을 큐로 만들어 전곡 재생을 건다 */
import { usePlayer, type PlayerSong } from "@/player/player-context";

export default function PlaylistPlayButton({
  name,
  songs,
}: {
  name: string;
  songs: PlayerSong[];
}) {
  const { playPlaylist } = usePlayer();
  if (songs.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => void playPlaylist({ title: name, songs }, songs[0].id)}
      className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm transition hover:bg-white/20"
    >
      ▶ 목록 재생
    </button>
  );
}
```

- [ ] **Step 2: 목록 관리 클라이언트 컴포넌트 작성**

`src/app/lists/PlaylistManager.tsx`:

```tsx
"use client";

/** 내 목록 관리 — 만들기·이름 변경·삭제·공유 링크 */
import Link from "next/link";
import { useState } from "react";
import type { PlaylistSummary } from "@/server/playlists";

export default function PlaylistManager({ initial }: { initial: PlaylistSummary[] }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const r = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const j = (await r.json()) as { playlist?: PlaylistSummary };
    if (j.playlist) {
      setItems((p) => [j.playlist as PlaylistSummary, ...p]);
      setName("");
    }
  };

  const toggleShare = async (p: PlaylistSummary) => {
    const r = await fetch(`/api/playlists/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: p.shareSlug === null }),
    });
    const j = (await r.json()) as { shareSlug: string | null };
    setItems((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, shareSlug: j.shareSlug } : x)),
    );
  };

  const remove = async (id: number) => {
    await fetch(`/api/playlists/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <>
      <div className="mb-5 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="새 목록 이름"
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void create()}
          className="shrink-0 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20"
        >
          만들기
        </button>
      </div>

      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <Link href={`/lists/${p.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-white/40">{p.songCount}곡</span>
            </Link>
            {p.shareSlug && (
              <Link
                href={`/list/${p.shareSlug}`}
                className="shrink-0 text-xs text-amber-200/80 underline"
              >
                공유 링크
              </Link>
            )}
            <button
              type="button"
              onClick={() => void toggleShare(p)}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs transition hover:bg-white/10"
            >
              {p.shareSlug ? "공유 끄기" : "공유 켜기"}
            </button>
            <button
              type="button"
              onClick={() => void remove(p.id)}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-white/50 transition hover:bg-white/10"
            >
              삭제
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-white/40">
            아직 목록이 없어요 — 위에서 하나 만들어보세요
          </li>
        )}
      </ul>
    </>
  );
}
```

- [ ] **Step 3: /lists 페이지 작성**

`src/app/lists/page.tsx`:

```tsx
import Link from "next/link";
import { getSessionUser } from "@/auth";
import DataCredits from "@/components/DataCredits";
import { listMyPlaylists } from "@/server/playlists";
import PlaylistManager from "./PlaylistManager";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const user = await getSessionUser();
  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/50 transition hover:text-white">
          ← 은하로 돌아가기
        </Link>
        <h1 className="mt-6 mb-1 text-2xl font-semibold">내 노래 목록</h1>
        <p className="mb-5 text-sm text-white/50">
          목록의 곡은 YouTube로 전곡 재생됩니다.
        </p>
        {user ? (
          <PlaylistManager initial={await listMyPlaylists(user.id)} />
        ) : (
          <p className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/50">
            <a href="/api/auth/signin" className="underline">
              로그인
            </a>
            하면 목록을 만들 수 있어요.
          </p>
        )}
        <DataCredits />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: 목록 상세 페이지 작성**

`src/app/lists/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/auth";
import DataCredits from "@/components/DataCredits";
import PlaylistPlayButton from "@/components/PlaylistPlayButton";
import { getPlaylistById } from "@/server/playlists";

export const dynamic = "force-dynamic";

export default async function PlaylistDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) notFound();
  const user = await getSessionUser();
  const pl = await getPlaylistById(id);
  if (!pl || !user || pl.ownerId !== user.id) notFound();

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/lists" className="text-sm text-white/50 transition hover:text-white">
          ← 내 목록
        </Link>
        <div className="mt-6 mb-5 flex items-center justify-between gap-4">
          <h1 className="min-w-0 truncate text-2xl font-semibold">{pl.name}</h1>
          <PlaylistPlayButton name={pl.name} songs={pl.songs} />
        </div>
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
          {pl.songs.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 shrink-0 text-xs text-white/30">{i + 1}</span>
              <Link href={`/songs/${s.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm">{s.title}</span>
                <span className="block truncate text-xs text-white/45">{s.artist}</span>
              </Link>
              {!s.youtubeVideoId && (
                <span className="shrink-0 text-xs text-white/30" title="영상을 아직 찾지 못해 30초 미리듣기로 재생됩니다">
                  미리듣기
                </span>
              )}
            </li>
          ))}
          {pl.songs.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-white/40">
              아직 담은 곡이 없어요 — 곡을 들으면서 알약의 + 를 눌러보세요
            </li>
          )}
        </ul>
        <DataCredits />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: 공유 열람 페이지 작성**

`src/app/list/[slug]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import DataCredits from "@/components/DataCredits";
import PlaylistPlayButton from "@/components/PlaylistPlayButton";
import { getPlaylistBySlug } from "@/server/playlists";

export const dynamic = "force-dynamic";

/**
 * 공유 링크 열람 — slug를 아는 누구나 볼 수 있다(로그인 불필요).
 * 소유자 확인을 하지 않는 대신 편집 UI가 전혀 없다.
 */
export default async function SharedListPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const pl = await getPlaylistBySlug(slug);
  if (!pl) notFound();

  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/50 transition hover:text-white">
          ← 은하로 돌아가기
        </Link>
        <div className="mt-6 mb-5 flex items-center justify-between gap-4">
          <h1 className="min-w-0 truncate text-2xl font-semibold">{pl.name}</h1>
          <PlaylistPlayButton name={pl.name} songs={pl.songs} />
        </div>
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
          {pl.songs.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 shrink-0 text-xs text-white/30">{i + 1}</span>
              <Link href={`/songs/${s.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm">{s.title}</span>
                <span className="block truncate text-xs text-white/45">{s.artist}</span>
              </Link>
            </li>
          ))}
        </ul>
        <DataCredits />
      </div>
    </main>
  );
}
```

- [ ] **Step 6: 타입 검사 + 린트 + 빌드**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 오류 없음, `/lists`·`/lists/[id]`·`/list/[slug]` 라우트가 빌드 출력에 나타남

- [ ] **Step 7: 커밋**

```bash
git add src/app/lists src/app/list src/components/PlaylistPlayButton.tsx
git commit -m "feat: 목록 관리·상세·공유 열람 화면"
```

---

### Task 7: 브라우저 검증 + SSOT + 배포

**Files:**
- Modify: `docs/SSOT.md`

**Interfaces:**
- Consumes: 앞의 모든 태스크
- Produces: 없음

- [ ] **Step 1: 로컬에서 전 흐름 확인**

개발 서버에서 순서대로 확인한다. 각 항목이 통과해야 다음으로 간다.

1. `/lists`에서 목록을 만든다 → 목록이 즉시 보인다
2. 은하에서 곡을 재생하고 알약의 `+` → 방금 만든 목록에 담긴다
3. `/lists/[id]`에서 담은 곡이 보인다
4. `▶ 목록 재생` → 알약 위에 영상이 뜨고 소리가 난다
5. `영상 접기` → **소리가 완전히 멎는다** (약관 요건)
6. `영상 펼치고 이어 듣기` → 다시 재생된다
7. 은하로 이동해 별을 눌러 미리듣기 → 영상 소리가 멎고 미리듣기만 난다 (동시 재생 없음)
8. `공유 켜기` → `/list/[slug]`가 로그인 없이(시크릿 창) 열린다
9. `공유 끄기` → 같은 링크가 404가 된다

- [ ] **Step 2: 쿼터 소모 확인**

담기 직후에만 검색이 나가는지 본다. 이미 담긴 곡을 다시 담아도 `youtube_checked_at`이 갱신되지 않아야 한다.

```bash
psql "$DATABASE_URL" -c "select count(*) from songs where youtube_checked_at is not null;"
```

목록 재생을 여러 번 반복한 뒤 같은 쿼리를 다시 돌려 숫자가 **변하지 않는지** 확인한다.

- [ ] **Step 3: SSOT 문서 갱신**

`docs/SSOT.md` 표에 추가:

```markdown
| 노래 목록 | `playlists` / `playlist_songs` 테이블 (`src/server/playlists.ts`가 유일한 접근 창구) | `/lists`, `/lists/[id]`, `/list/[slug]`, 알약 담기 팝오버 | 곡 개수는 저장하지 않고 `count(*)`로 구한다. 공유는 `share_slug` 하나로 표현 — NULL이면 비공개, 끄면 기존 링크가 죽는다. 편집은 `user_id` 소유자만 |
| 공유 링크 slug | `src/lib/share-slug.ts` | `playlists.share_slug` | 혼동 문자(0 O 1 l I) 제외한 32자 알파벳 10자리. 충돌은 DB unique 제약이 최종 방어 |
| 재생 엔진 선택 | `src/player/engine.ts`의 `pickEngine` | `PlayerProvider`의 엔진 전환 | 목록 재생 + 영상 ID가 있을 때만 `youtube`, 아니면 `preview`. **탐색 경로에서 YouTube를 쓰면 안 된다** (쿼터·UX) |
| YouTube 전곡 재생 | YouTube IFrame Player API (`src/player/YoutubeStage.tsx`가 그리고 `PlayerProvider`가 제어) | 알약의 영상 패널 | **ytdl 류 스트림 추출 금지** — 약관 위반 + 기술적 보호조치 우회. 영상은 화면에 보여야 하므로 **접기 = 일시정지**를 코드로 강제. 설계: `docs/superpowers/specs/2026-08-11-playlists-youtube-design.md` |
```

`앨범아트·미리듣기` 행 아래의 YouTube 영상 ID 행 비고에 추가: `영상 ID를 새로 찾는 곳은 목록에 곡을 담을 때(addSongToPlaylist) 한 곳뿐이다 — 다른 데서 부르면 하루 100회 쿼터가 마른다.`

- [ ] **Step 4: 프로덕션 DB에 스키마 반영**

```bash
npx vercel env pull /tmp/prod.env --environment=production
DATABASE_URL=$(grep '^DATABASE_URL=' /tmp/prod.env | cut -d= -f2- | tr -d '"') npm run db:push
rm -f /tmp/prod.env
```

Expected: `playlists`, `playlist_songs` 생성됨. **로컬과 Neon 양쪽에 반영되어야 한다.**

- [ ] **Step 5: 커밋 + 배포**

```bash
git add docs/SSOT.md
git commit -m "docs: 노래 목록·재생 엔진 SSOT 등록"
npm run build && git push origin HEAD:master
```

- [ ] **Step 6: 프로덕션에서 재확인**

배포 후 Step 1의 1~9번을 프로덕션에서 다시 한 번 확인한다. 특히 5번(접기 = 정지)과 7번(동시 재생 없음)은 약관 준수 요건이므로 반드시 통과해야 한다.

---

## 자체 검토 결과

**스펙 커버리지**

| 스펙 항목 | 태스크 |
| --- | --- |
| `playlists`/`playlist_songs` 모델 | Task 1 |
| 곡 개수는 count로 | Task 2 (`listMyPlaylists`) |
| 공유 slug, 끄면 링크 죽음 | Task 2 (`setPlaylistShared`) |
| 담을 때만 영상 ID 조회 | Task 3 (`addSongToPlaylist`) |
| 엔진 두 개, 동시 재생 금지 | Task 4 (`silenceOther`) |
| 접기 = 일시정지 | Task 4 (`setVideoExpanded`) + Task 5 (버튼) |
| 볼륨 단위 통합 | Task 4 (`changeVolume`) |
| 자동 다음 곡 (ENDED) | Task 4 (`advanceRef`) + Task 5 (`onEnded`) |
| 임베드 거부 폴백 | Task 5 (`onError` → `playStep(1)`) |
| 영상 없는 곡 미리듣기 폴백 | Task 4 (`pickEngine`이 null이 아니면 preview) |
| 비로그인 담기 → 로그인 유도 | Task 5 (`AddToPlaylist`) |
| 남의 목록 편집 403 | Task 2·3 (`ownsPlaylist`) |
| `/lists`, `/lists/[id]`, `/list/[slug]` | Task 6 |
| 검증 항목 5가지 | Task 7 Step 1·2 |

**남은 간극 하나 (의도된 것)**

스펙의 "임베드 거부 시 `youtube_video_id`만 지우고 `youtube_checked_at`은 남긴다"는 서버 쓰기가 필요한데, Task 5의 `onError`는 클라이언트에서 `playStep(1)`로 넘기기만 한다. 즉 **폴백은 되지만 DB 정리는 안 된다.** 검색에 `videoEmbeddable=true`가 걸려 있어 드문 경우이고, 정리를 안 해도 매번 미리듣기로 폴백되어 동작에는 문제가 없다. 실제로 이 상황이 관측되면 그때 `/api/playlists/.../songs`에 정리용 엔드포인트를 추가한다. 이 판단을 여기 적어두는 이유는, 나중에 스펙과 코드가 어긋나 보일 때 실수가 아니라 결정이었음을 알 수 있게 하기 위함이다.
