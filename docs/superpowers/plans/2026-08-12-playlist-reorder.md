# 노래 목록 순서 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 노래 목록(`/lists/[id]`)에서 곡을 드래그로 끌어 재생 순서를 바꾸고, 목록에서 곡을 뺄 수 있게 한다.

**Architecture:** 순서 계산은 `src/lib/reorder.ts`의 순수 함수 세 개에 모으고(테스트 가능), 서버는 "전체 순서 배열"을 받아 `playlist_songs.position`을 0..n-1로 다시 쓰는 함수 하나를 얻는다. 목록 상세 페이지에서 곡 `<ul>`만 클라이언트 컴포넌트로 떼어내 포인터 이벤트로 드래그를 직접 구현하고, 재생 중인 큐는 `PlayerProvider`에 새로 넣는 두 함수로 동기화한다.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM + Postgres, Tailwind, `node:test` + tsx

## Global Constraints

- **새 npm 패키지를 설치하지 않는다.** 이 저장소에서 `npm install`이 멈춘다(2026-08-11 실측: 18분간 CPU 0.4%). 드래그는 포인터 이벤트로 직접 구현한다.
- **HTML5 `draggable`을 쓰지 않는다.** 터치에서 동작하지 않는다.
- 테스트는 `node:test` + tsx. 실행은 `npm test` (내부적으로 `tsx --test $(find src -name "*.test.ts")`). vitest 아님.
- 모든 UI 문구는 한국어.
- SSOT: 새 원본 정의를 만들면 `docs/SSOT.md`를 **같은 커밋**에 갱신한다.
- 커밋 메시지는 `.claude/skills/commit-with-prompts/SKILL.md` 형식을 따른다 — 본문 끝에 `[Prompts]` 섹션으로 이 작업을 만든 사용자 프롬프트 원문을 넣는다. 이 작업의 프롬프트는 두 개다:
  1. `내 노래 목록에서 노래를 드래그로 재생 순서를 정할수 있게 하고 곡 목록 즉 검색에서 나오는 노래들을 내 곡 목록에 추가할수 있는 버튼 추가, 유튜브 영상 나오는 거를 사이드 바에 나오도록 하는 건 어떨까, 행성 꾸미기 기능 추가, 이미지 를 넣으면 비슷한 3d 캐릭터 생성 기능 추가`
  2. `이대로 진행하자`
- 각 태스크 끝에서 `npx tsc --noEmit`가 깨끗해야 한다.
- 키보드 순서 변경(↑↓ 버튼)은 **이번 범위 밖이다.** 만들지 말 것.

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/lib/reorder.ts` (신규) | 순서 계산 순수 함수 — `moveItem`, `dropIndex`, `sameMembers` |
| `src/lib/reorder.test.ts` (신규) | 위 세 함수의 경계 검증 |
| `src/server/playlists.ts` (수정) | `reorderPlaylistSongs` 추가 |
| `src/app/api/playlists/[id]/songs/route.ts` (수정) | `PATCH` 핸들러 추가 |
| `src/player/player-context.tsx` (수정) | `PlayerQueue.playlistId` 필드 + `reorderQueue`/`removeFromQueue` |
| `src/components/PlaylistPlayButton.tsx` (수정) | 큐에 `playlistId`를 실어 보낸다 |
| `src/components/PlaylistEditor.tsx` (신규) | 드래그 정렬 + 곡 빼기 UI (클라이언트 컴포넌트) |
| `src/app/lists/[id]/page.tsx` (수정) | 곡 `<ul>`을 `PlaylistEditor`로 교체 |
| `docs/SSOT.md` (수정) | 순서 계산·순서 저장의 원본 위치 등록 |

---

### Task 1: 순서 계산 순수 함수

**Files:**
- Create: `src/lib/reorder.ts`
- Test: `src/lib/reorder.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `moveItem<T>(list: T[], from: number, to: number): T[]`
  - `dropIndex(from: number, deltaY: number, rowHeight: number, count: number): number`
  - `sameMembers(a: number[], b: number[]): boolean`

- [ ] **Step 1: Write the failing test**

`src/lib/reorder.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dropIndex, moveItem, sameMembers } from "./reorder";

describe("moveItem", () => {
  it("아래로 옮긴다", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  });

  it("위로 옮긴다", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
  });

  it("제자리에 놓으면 그대로", () => {
    assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
  });

  it("맨 위·맨 아래 경계", () => {
    assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  });

  it("원본 배열을 건드리지 않는다", () => {
    // 낙관적 UI가 실패 시 원본으로 되돌리려면 원본이 살아 있어야 한다
    const original = ["a", "b", "c"];
    moveItem(original, 0, 2);
    assert.deepEqual(original, ["a", "b", "c"]);
  });

  it("범위 밖 인덱스는 그대로 돌려준다", () => {
    assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
    assert.deepEqual(moveItem(["a", "b"], 0, -1), ["a", "b"]);
  });
});

describe("dropIndex", () => {
  it("움직이지 않았으면 제자리", () => {
    assert.equal(dropIndex(2, 0, 60, 10), 2);
  });

  it("한 행 높이만큼 내리면 한 칸 아래", () => {
    assert.equal(dropIndex(2, 60, 60, 10), 3);
  });

  it("행 높이의 절반을 넘어야 한 칸 움직인다", () => {
    assert.equal(dropIndex(2, 29, 60, 10), 2);
    assert.equal(dropIndex(2, 31, 60, 10), 3);
  });

  it("위로도 같은 규칙", () => {
    assert.equal(dropIndex(5, -120, 60, 10), 3);
  });

  it("목록 밖으로는 나가지 않는다", () => {
    assert.equal(dropIndex(0, -600, 60, 4), 0);
    assert.equal(dropIndex(3, 600, 60, 4), 3);
  });

  it("행 높이를 못 잰 경우(0) 제자리를 준다", () => {
    // 0으로 나누면 NaN이 되어 목록이 통째로 뒤집힌다
    assert.equal(dropIndex(2, 100, 0, 10), 2);
  });
});

describe("sameMembers", () => {
  it("순서만 다르면 같은 집합", () => {
    assert.equal(sameMembers([1, 2, 3], [3, 1, 2]), true);
  });

  it("하나라도 다르면 다르다", () => {
    assert.equal(sameMembers([1, 2, 3], [1, 2, 4]), false);
  });

  it("길이가 다르면 다르다", () => {
    assert.equal(sameMembers([1, 2], [1, 2, 3]), false);
  });

  it("한쪽에 중복이 있으면 다르다", () => {
    // 길이가 같고 Set으로만 비교하면 [1,1,2]와 [1,2,2]가 같다고 나온다
    assert.equal(sameMembers([1, 1, 2], [1, 2, 2]), false);
  });

  it("빈 배열끼리는 같다", () => {
    assert.equal(sameMembers([], []), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './reorder'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/reorder.ts`:

```ts
/**
 * 목록 순서 편집의 계산 — SSOT (docs/SSOT.md).
 * 드래그 UI와 서버 검증이 같은 규칙을 써야 하므로 여기 한 곳에만 둔다.
 */

/** from 자리의 항목을 빼서 to 자리에 끼운 새 배열. 원본은 건드리지 않는다 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 드래그한 세로 이동량으로 놓일 자리를 구한다.
 * 행 높이가 균일하다는 전제 — 목록의 모든 행이 같은 패딩·글꼴을 쓴다.
 * rowHeight가 0이면(아직 못 잼) 제자리를 준다. 0으로 나누면 NaN이 되어
 * 목록이 통째로 어긋난다.
 */
export function dropIndex(
  from: number,
  deltaY: number,
  rowHeight: number,
  count: number,
): number {
  if (rowHeight <= 0 || count <= 0) return from;
  const moved = Math.round(deltaY / rowHeight);
  return Math.min(Math.max(from + moved, 0), count - 1);
}

/**
 * 두 배열이 순서를 무시하고 같은 원소를 같은 개수만큼 갖는지.
 * Set 비교로는 [1,1,2]와 [1,2,2]를 구분하지 못하므로 정렬해서 비교한다.
 */
export function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -10`
Expected: PASS — `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/lib/reorder.ts src/lib/reorder.test.ts
git commit -m "$(cat <<'EOF'
feat: 목록 순서 계산 순수 함수

드래그 UI와 서버 검증이 같은 규칙을 쓰도록 한 곳에 모은다.

[Prompts]
1. 내 노래 목록에서 노래를 드래그로 재생 순서를 정할수 있게 하고 곡 목록 즉 검색에서 나오는 노래들을 내 곡 목록에 추가할수 있는 버튼 추가, 유튜브 영상 나오는 거를 사이드 바에 나오도록 하는 건 어떨까, 행성 꾸미기 기능 추가, 이미지 를 넣으면 비슷한 3d 캐릭터 생성 기능 추가
2. 이대로 진행하자
EOF
)"
```

---

### Task 2: 서버 — 순서 저장

**Files:**
- Modify: `src/server/playlists.ts` (`removeSongFromPlaylist` 바로 아래에 추가)
- Modify: `docs/SSOT.md`

**Interfaces:**
- Consumes: `sameMembers` (Task 1)
- Produces: `reorderPlaylistSongs(userId: number, playlistId: number, songIds: number[]): Promise<"ok" | "forbidden" | "mismatch">`

- [ ] **Step 1: 함수 추가**

`src/server/playlists.ts` 맨 위 import에 다음을 더한다 (`nextPosition`과 같은 줄 아래):

```ts
import { sameMembers } from "@/lib/reorder";
```

파일 끝의 `removeSongFromPlaylist` 다음에 추가:

```ts
export type ReorderResult = "ok" | "forbidden" | "mismatch";

/**
 * 목록의 재생 순서를 통째로 다시 쓴다.
 *
 * 부분 이동(`{songId, toIndex}`)이 아니라 **전체 순서 배열**을 받는 이유:
 * 멱등적이고, 다른 탭에서 곡이 추가·삭제돼 클라이언트가 낡았을 때 조용히
 * 어긋나는 대신 집합 비교로 잡아 "mismatch"를 돌려줄 수 있다.
 *
 * position을 0..n-1로 다시 써도 `nextPosition`(최대값+1)의 전제는 유지된다.
 */
export async function reorderPlaylistSongs(
  userId: number,
  playlistId: number,
  songIds: number[],
): Promise<ReorderResult> {
  if (!(await ownsPlaylist(userId, playlistId))) return "forbidden";

  const current = await db
    .select({ songId: schema.playlistSongs.songId })
    .from(schema.playlistSongs)
    .where(eq(schema.playlistSongs.playlistId, playlistId));
  if (!sameMembers(current.map((c) => c.songId), songIds)) return "mismatch";

  // 한 트랜잭션 안에서 다시 쓴다 — 중간에 끊기면 순서가 섞인 채 남는다.
  // (playlist_id, song_id)가 기본키라 곡마다 한 행씩 확실히 짚힌다
  await db.transaction(async (tx) => {
    for (const [i, songId] of songIds.entries()) {
      await tx
        .update(schema.playlistSongs)
        .set({ position: i })
        .where(
          and(
            eq(schema.playlistSongs.playlistId, playlistId),
            eq(schema.playlistSongs.songId, songId),
          ),
        );
    }
    await tx
      .update(schema.playlists)
      .set({ updatedAt: new Date() })
      .where(eq(schema.playlists.id, playlistId));
  });
  return "ok";
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 3: SSOT 갱신**

`docs/SSOT.md`의 표에 두 행을 추가한다 (재생 엔진 선택 행 근처):

```markdown
| 목록 순서 계산 | `src/lib/reorder.ts` | `PlaylistEditor`의 드래그, `reorderPlaylistSongs`의 검증 | 드래그 UI와 서버가 같은 규칙을 써야 한다. `dropIndex`는 행 높이가 균일하다는 전제이고 rowHeight 0이면 제자리를 준다(0으로 나누면 NaN이 되어 목록이 통째로 어긋난다). 테스트: `src/lib/reorder.test.ts` |
| 목록 재생 순서 | `playlist_songs.position` | `getPlaylistById`/`getPlaylistBySlug`의 정렬, `PlaylistPlayButton`이 넘기는 큐 | 쓰는 창구는 둘뿐이다: 담을 때 `nextPosition`(최대값+1), 순서 편집 때 `reorderPlaylistSongs`(0..n-1 전체 재기록, 한 트랜잭션). 순서 편집은 **부분 이동이 아니라 전체 배열**을 받는다 — 멱등적이고, 다른 탭에서 곡이 바뀐 낡은 클라이언트를 집합 비교로 잡아낸다(`mismatch` → 409) |
```

- [ ] **Step 4: Commit**

```bash
git add src/server/playlists.ts docs/SSOT.md
git commit -m "$(cat <<'EOF'
feat: 목록 재생 순서 저장 함수

전체 순서 배열을 받아 position을 0..n-1로 다시 쓴다. 멤버 집합이
다르면 mismatch — 다른 탭에서 곡이 바뀐 낡은 클라이언트를 잡는다.

[Prompts]
1. 내 노래 목록에서 노래를 드래그로 재생 순서를 정할수 있게 하고 곡 목록 즉 검색에서 나오는 노래들을 내 곡 목록에 추가할수 있는 버튼 추가, 유튜브 영상 나오는 거를 사이드 바에 나오도록 하는 건 어떨까, 행성 꾸미기 기능 추가, 이미지 를 넣으면 비슷한 3d 캐릭터 생성 기능 추가
2. 이대로 진행하자
EOF
)"
```

---

### Task 3: API — PATCH 창구

**Files:**
- Modify: `src/app/api/playlists/[id]/songs/route.ts`

**Interfaces:**
- Consumes: `reorderPlaylistSongs` (Task 2)
- Produces: `PATCH /api/playlists/[id]/songs` — body `{ songIds: number[] }` → `200 {ok:true}` / `400` / `401` / `403` / `409 {error:"mismatch"}`

- [ ] **Step 1: 핸들러 추가**

import 줄을 바꾼다:

```ts
import { addSongToPlaylist, removeSongFromPlaylist, reorderPlaylistSongs } from "@/server/playlists";
```

파일 끝(`DELETE` 다음)에 추가:

```ts
/**
 * PATCH /api/playlists/[id]/songs { songIds } — 재생 순서 바꾸기.
 *
 * 목록에 담긴 곡 **전체**를 원하는 순서로 보낸다. 일부만 보내면 mismatch다 —
 * 이 창구는 순서만 바꾸며, 곡을 담거나 빼지 않는다(그건 POST/DELETE의 일).
 */
export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const playlistId = Number((await props.params).id);
  const body = (await req.json().catch(() => null)) as { songIds?: unknown } | null;
  const songIds = body?.songIds;
  if (
    !Number.isInteger(playlistId) ||
    !Array.isArray(songIds) ||
    !songIds.every((v) => Number.isInteger(v))
  ) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const result = await reorderPlaylistSongs(user.id, playlistId, songIds as number[]);
  if (result === "forbidden") {
    return NextResponse.json({ error: "내 목록이 아닙니다" }, { status: 403 });
  }
  if (result === "mismatch") {
    // 409 — 클라이언트가 낡았다. 호출부는 화면을 새로 받아와야 한다
    return NextResponse.json({ error: "mismatch" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 타입 검사·빌드**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "Compiled successfully|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/playlists/[id]/songs/route.ts"
git commit -m "$(cat <<'EOF'
feat: 목록 순서 변경 PATCH 창구

[Prompts]
1. 내 노래 목록에서 노래를 드래그로 재생 순서를 정할수 있게 하고 곡 목록 즉 검색에서 나오는 노래들을 내 곡 목록에 추가할수 있는 버튼 추가, 유튜브 영상 나오는 거를 사이드 바에 나오도록 하는 건 어떨까, 행성 꾸미기 기능 추가, 이미지 를 넣으면 비슷한 3d 캐릭터 생성 기능 추가
2. 이대로 진행하자
EOF
)"
```

---

### Task 4: 플레이어 큐 동기화

**Files:**
- Modify: `src/player/player-context.tsx`
- Modify: `src/components/PlaylistPlayButton.tsx`

**Interfaces:**
- Consumes: `moveItem`는 쓰지 않는다 (여기서는 id 순서를 그대로 받아 재배열한다)
- Produces:
  - `PlayerQueue.playlistId?: number`
  - `reorderQueue(playlistId: number, songIds: number[]): void`
  - `removeFromQueue(playlistId: number, songId: number): void`

- [ ] **Step 1: `PlayerQueue`에 `playlistId` 추가**

`src/player/player-context.tsx`의 `PlayerQueue` 인터페이스에 필드를 더한다 (`mode` 바로 위):

```ts
  /**
   * 이 큐가 어느 노래 목록에서 왔는지. 목록 화면에서 순서를 바꾸거나 곡을 뺐을 때
   * "지금 듣고 있는 큐가 그 목록인지" 알아야 해서 둔다 — title만으로는 알 수 없다
   * (이름이 같은 목록이 여럿일 수 있고, 이름은 바뀐다)
   */
  playlistId?: number;
```

- [ ] **Step 2: 컨텍스트 타입에 두 함수 선언**

`PlayerContextValue`의 `playPlaylist` 선언 아래에 추가:

```ts
  /** 그 목록이 지금 큐일 때만 곡 순서를 새 순서로 맞춘다. 재생 중인 곡은 건드리지 않는다 */
  reorderQueue: (playlistId: number, songIds: number[]) => void;
  /** 그 목록이 지금 큐일 때 곡을 뺀다. 빼는 곡이 재생 중이면 다음 곡으로 넘어간다 */
  removeFromQueue: (playlistId: number, songId: number) => void;
```

- [ ] **Step 3: 구현**

`playInQueue` 정의 바로 아래에 추가한다 (`playStep`이 이미 정의되어 있어야 하므로 `playStep` 뒤여야 한다 — `playInQueue`는 `stop` 다음에 있으니 그 자리면 조건을 만족한다):

```ts
  /**
   * 목록 화면에서 순서를 바꿨을 때 지금 듣는 큐도 같은 순서로 맞춘다.
   *
   * playingId·오디오·영상은 건드리지 않는다 — 듣던 곡은 그대로 흐르고,
   * 자동 진행(`advanceRef` → `findPlayable`)이 새 배열에서 현재 곡 다음을 찾는다.
   * 곡 객체를 그대로 재배열한다(새로 만들지 않는다) — youtubeVideoId 같은
   * 큐에서만 갱신된 값(영상 실패로 지워진 ID 등)을 잃지 않기 위해서다.
   */
  const reorderQueue = useCallback(
    (playlistId: number, songIds: number[]): void => {
      const q = queueRef.current;
      if (!q || q.playlistId !== playlistId) return;
      const byId = new Map(q.songs.map((s) => [s.id, s]));
      const songs = songIds.map((id) => byId.get(id)).filter((s): s is PlayerSong => s != null);
      // 큐에 없는 곡이 섞여 있으면(다른 탭에서 담긴 곡) 재배열을 포기한다 —
      // 반쪽짜리 큐를 만들면 듣던 곡이 사라질 수 있다
      if (songs.length !== q.songs.length) return;
      const next = { ...q, songs };
      queueRef.current = next;
      setQueueState(next);
    },
    [],
  );

  /**
   * 목록에서 뺀 곡을 지금 듣는 큐에서도 뺀다.
   *
   * 빼는 곡이 재생 중이면 ⏭를 누른 것과 같게 다음 곡으로 넘긴다 — 그러지 않으면
   * 큐에 없는 곡이 끝났을 때 `advanceRef`가 `idx < 0`으로 재생을 끝내버린다.
   *
   * `playStep(1)`을 그냥 부르면 안 된다: 이미 큐에서 빠진 곡을 찾지 못해(idx < 0)
   * 목록의 **첫 곡**부터 다시 트는데, 우리가 원하는 것은 뺀 자리의 다음 곡이다.
   * 그래서 넘길 곡을 빼기 전에 직접 정한다.
   */
  const removeFromQueue = useCallback(
    (playlistId: number, songId: number): void => {
      const q = queueRef.current;
      if (!q || q.playlistId !== playlistId) return;
      const wasPlaying = playingIdRef.current === songId;
      const at = q.songs.findIndex((s) => s.id === songId);
      const songs = q.songs.filter((s) => s.id !== songId);
      const next = { ...q, songs };
      queueRef.current = next;
      setQueueState(next);
      if (!wasPlaying) return;
      // 뺀 자리로 밀려 올라온 곡이 다음 곡이다. 마지막 곡을 뺐으면 첫 곡으로 돌아간다
      // (목록 재생은 끝↔처음 루프이므로 자동 진행과 같은 규칙)
      if (songs.length === 0) {
        setPlayingId(null);
        return;
      }
      const nextSong = songs[at % songs.length];
      // playInQueue는 이 큐의 mode를 지킨다 — 목록 재생이면 영상으로 이어진다.
      // 재생할 수 없는 곡이면 findPlayable이 그 다음으로 알아서 넘어간다
      void playInQueue(next, nextSong.id).catch(() => undefined);
    },
    [playInQueue, setPlayingId],
  );
```

`value`의 객체 리터럴과 의존성 배열 **둘 다**에 `reorderQueue,`와 `removeFromQueue,`를 넣는다 (`playPlaylist` 옆).

- [ ] **Step 4: `PlaylistPlayButton`이 `playlistId`를 싣게 한다**

`src/components/PlaylistPlayButton.tsx`:

props에 `id`를 더하고 —

```tsx
export default function PlaylistPlayButton({
  id,
  name,
  songs,
}: {
  id: number;
  name: string;
  songs: PlayerSong[];
}) {
```

큐를 만들 때 실어 보낸다:

```tsx
    playPlaylist({ playlistId: id, title: name, songs }, songs[0].id).catch((e: unknown) => {
```

부르는 곳 두 군데를 고친다:
- `src/app/lists/[id]/page.tsx`: `<PlaylistPlayButton id={pl.id} name={pl.name} songs={pl.songs} />`
- `src/app/list/[slug]/page.tsx`: `<PlaylistPlayButton id={pl.id} name={pl.name} songs={pl.songs} />`

- [ ] **Step 5: 타입 검사·빌드**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "Compiled successfully|Error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 6: Commit**

```bash
git add src/player/player-context.tsx src/components/PlaylistPlayButton.tsx "src/app/lists/[id]/page.tsx" "src/app/list/[slug]/page.tsx"
git commit -m "$(cat <<'EOF'
feat: 목록 편집을 재생 중인 큐에 반영하는 통로

큐에 playlistId를 실어 "지금 듣는 큐가 그 목록인지" 알 수 있게 하고,
순서 재배열·곡 제거를 재생을 끊지 않고 반영한다. 재생 중인 곡을 빼면
⏭를 누른 것과 같게 다음 곡으로 넘어간다.

[Prompts]
1. 내 노래 목록에서 노래를 드래그로 재생 순서를 정할수 있게 하고 곡 목록 즉 검색에서 나오는 노래들을 내 곡 목록에 추가할수 있는 버튼 추가, 유튜브 영상 나오는 거를 사이드 바에 나오도록 하는 건 어떨까, 행성 꾸미기 기능 추가, 이미지 를 넣으면 비슷한 3d 캐릭터 생성 기능 추가
2. 이대로 진행하자
EOF
)"
```

---

### Task 5: 드래그 정렬 + 곡 빼기 UI

**Files:**
- Create: `src/components/PlaylistEditor.tsx`
- Modify: `src/app/lists/[id]/page.tsx`

**Interfaces:**
- Consumes: `dropIndex`, `moveItem` (Task 1) / `PATCH`·`DELETE /api/playlists/[id]/songs` (Task 3, 기존) / `reorderQueue`, `removeFromQueue` (Task 4) / `PlaylistTrack` (`src/server/playlists.ts`, 기존: `{id, title, artist, genre, youtubeVideoId}`)
- Produces: `<PlaylistEditor playlistId={number} songs={PlaylistTrack[]} />`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/PlaylistEditor.tsx`:

```tsx
"use client";

/**
 * 목록 상세의 곡 목록 — 드래그로 재생 순서 바꾸기 + 곡 빼기.
 *
 * 드래그 라이브러리를 쓰지 않는다: 이 저장소는 npm install이 멈춰 새 패키지를 들일 수
 * 없고(2026-08-11 실측), HTML5 draggable은 터치에서 아예 동작하지 않는다. 포인터
 * 이벤트는 마우스·터치·펜을 한 코드로 덮으므로 직접 구현하는 편이 낫다.
 *
 * 순서 계산은 하지 않는다 — `src/lib/reorder.ts`가 원본이다 (docs/SSOT.md).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { dropIndex, moveItem } from "@/lib/reorder";
import { usePlayer } from "@/player/player-context";
import type { PlaylistTrack } from "@/server/playlists";

/** 드래그 중인 행의 상태 — 어디서 잡았고 지금 어디까지 왔나 */
interface Drag {
  from: number;
  /** 잡은 순간의 포인터 Y (뷰포트 기준) */
  startY: number;
  /** 지금까지의 이동량 px */
  deltaY: number;
  /** 지금 놓으면 들어갈 자리 */
  to: number;
}

export default function PlaylistEditor({
  playlistId,
  songs: initial,
}: {
  playlistId: number;
  songs: PlaylistTrack[];
}) {
  const router = useRouter();
  const { reorderQueue, removeFromQueue } = usePlayer();
  const [songs, setSongs] = useState(initial);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** 요청이 겹치지 않게 — 저장 중에는 새 드래그를 받지 않는다 */
  const busyRef = useRef(false);

  /** 행 높이를 그때그때 잰다 — 글꼴·화면 폭에 따라 달라진다 */
  const rowHeight = (): number =>
    (listRef.current?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (busyRef.current || songs.length < 2) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setError(null);
    setDrag({ from: index, startY: e.clientY, deltaY: 0, to: index });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    setDrag((d) => {
      if (!d) return d;
      const deltaY = e.clientY - d.startY;
      return { ...d, deltaY, to: dropIndex(d.from, deltaY, rowHeight(), songs.length) };
    });
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    // 캡처 해제를 제자리 놓기 검사보다 먼저 한다 — 뒤에 두면 제자리에 놓았을 때
    // 캡처가 걸린 채 남아 다음 드래그가 시작되지 않는다
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d.to === d.from) return;

    const before = songs;
    const next = moveItem(songs, d.from, d.to);
    setSongs(next); // 낙관적 — 손을 떼는 즉시 새 순서로 보인다
    busyRef.current = true;
    try {
      const r = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songIds: next.map((s) => s.id) }),
      });
      if (r.status === 409) {
        setSongs(before);
        setError("목록이 바뀌었어요 — 새로 불러옵니다");
        router.refresh();
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // 지금 이 목록을 듣고 있으면 큐 순서도 맞춘다 (재생은 끊기지 않는다)
      reorderQueue(playlistId, next.map((s) => s.id));
    } catch {
      setSongs(before);
      setError("순서를 저장하지 못했어요");
    } finally {
      busyRef.current = false;
    }
  };

  const remove = async (songId: number) => {
    if (busyRef.current) return;
    const before = songs;
    setSongs(before.filter((s) => s.id !== songId));
    setError(null);
    busyRef.current = true;
    try {
      const r = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      removeFromQueue(playlistId, songId);
    } catch {
      setSongs(before);
      setError("곡을 빼지 못했어요");
    } finally {
      busyRef.current = false;
    }
  };

  /**
   * 드래그 중 각 행을 얼마나 밀어 보여줄지.
   * 잡은 행은 손가락을 따라오고, 사이에 낀 행들은 한 칸씩 비켜선다.
   */
  const shift = (index: number): number => {
    if (!drag) return 0;
    const h = rowHeight();
    if (index === drag.from) return drag.deltaY;
    if (drag.to > drag.from && index > drag.from && index <= drag.to) return -h;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return h;
    return 0;
  };

  return (
    <>
      {error && <p className="mb-2 text-center text-xs text-rose-300">{error}</p>}
      <ul ref={listRef} className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
        {songs.map((s, i) => (
          <li
            key={s.id}
            style={{
              transform: `translateY(${shift(i)}px)`,
              // 잡은 행만 손가락을 즉시 따라오게 하고, 비켜서는 행은 부드럽게
              transition: drag?.from === i ? "none" : "transform 150ms ease-out",
              zIndex: drag?.from === i ? 1 : undefined,
              position: "relative",
            }}
            className={`flex items-center gap-3 px-4 py-3 ${
              drag?.from === i ? "bg-white/10 shadow-lg" : ""
            }`}
          >
            {songs.length > 1 && (
              <button
                type="button"
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => void onPointerUp(e)}
                onPointerCancel={() => setDrag(null)}
                aria-label={`${s.title} 순서 바꾸기 — 끌어서 옮기세요`}
                title="끌어서 순서 바꾸기"
                /* touch-none: 없으면 브라우저가 세로 스크롤로 가로채 드래그가 시작되지 않는다 */
                className="shrink-0 cursor-grab touch-none px-1 text-white/30 transition hover:text-white/70 active:cursor-grabbing"
              >
                ⠿
              </button>
            )}
            <span className="w-6 shrink-0 text-xs text-white/30">{i + 1}</span>
            <a href={`/songs/${s.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm">{s.title}</span>
              <span className="block truncate text-xs text-white/45">{s.artist}</span>
            </a>
            {!s.youtubeVideoId && (
              <span
                className="shrink-0 text-xs text-white/30"
                title="영상을 아직 찾지 못해 30초 미리듣기로 재생됩니다"
              >
                미리듣기
              </span>
            )}
            <button
              type="button"
              onClick={() => void remove(s.id)}
              aria-label={`${s.title} 목록에서 빼기`}
              title="목록에서 빼기"
              className="shrink-0 cursor-pointer rounded-full px-2 py-1 text-sm text-white/30 transition hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </li>
        ))}
        {songs.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-white/40">
            아직 담은 곡이 없어요 — 곡을 들으면서 알약의 + 를 눌러보세요
          </li>
        )}
      </ul>
    </>
  );
}
```

**주의:** 곡 제목 링크에 `next/link`가 아니라 `<a>`를 쓴다. 드래그 중 포인터가 링크 위를 지나갈 때 `Link`의 프리페치·클릭 처리와 엉키는 것을 피하기 위함이다.

- [ ] **Step 2: 페이지에서 갈아끼우기**

`src/app/lists/[id]/page.tsx`에서 `<ul>...</ul>` 블록 전체를 다음으로 바꾼다:

```tsx
        <PlaylistEditor playlistId={pl.id} songs={pl.songs} />
```

import를 더한다:

```tsx
import PlaylistEditor from "@/components/PlaylistEditor";
```

`Link`가 이 파일에서 여전히 쓰이는지 확인한다 (`← 내 목록`에서 쓰므로 남는다).

- [ ] **Step 3: 타입 검사·린트·빌드**

Run: `npx tsc --noEmit && npx eslint src/components/PlaylistEditor.tsx "src/app/lists/[id]/page.tsx" && npm run build 2>&1 | grep -E "Compiled successfully|Error"`
Expected: 타입·린트 출력 없음, `✓ Compiled successfully`

- [ ] **Step 4: 브라우저로 확인**

프로덕션 DB로 dev 서버를 띄우고(`DATABASE_URL`을 `vercel env pull`로 받은 값으로 덮어쓴 뒤 `npx next dev -p 3100`), 로그인 쿠키를 심어 `/lists/1`을 연다. 확인할 것:

1. 곡을 아래로 한 칸 끌어 놓으면 순서가 바뀌고, 새로고침해도 유지된다
2. 목록 재생 중에 순서를 바꿔도 **지금 곡이 끊기지 않고**, 알약의 재생 목록(≡)이 새 순서로 보인다
3. `✕`로 곡을 빼면 목록에서 사라지고 새로고침해도 유지된다
4. **재생 중인 곡**을 `✕`로 빼면 다음 곡으로 넘어간다
5. 겹쳐 띄운 경로(은하 → 계정 메뉴 → 내 노래 목록 → 목록)에서도 1~4가 같다

- [ ] **Step 5: Commit**

```bash
git add src/components/PlaylistEditor.tsx "src/app/lists/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat: 노래 목록 드래그 정렬 + 곡 빼기

목록 상세의 곡 목록을 클라이언트 컴포넌트로 떼어내 포인터 이벤트로
드래그를 직접 구현한다. 라이브러리를 쓰지 않는 이유는 이 저장소에서
npm install이 멈추기 때문이고, HTML5 draggable은 터치에서 안 먹는다.

[Prompts]
1. 내 노래 목록에서 노래를 드래그로 재생 순서를 정할수 있게 하고 곡 목록 즉 검색에서 나오는 노래들을 내 곡 목록에 추가할수 있는 버튼 추가, 유튜브 영상 나오는 거를 사이드 바에 나오도록 하는 건 어떨까, 행성 꾸미기 기능 추가, 이미지 를 넣으면 비슷한 3d 캐릭터 생성 기능 추가
2. 이대로 진행하자
EOF
)"
```

---

## 검증 (전체)

- [ ] `npm test` — `# fail 0`
- [ ] `npx tsc --noEmit` — 출력 없음
- [ ] `npm run build` — `✓ Compiled successfully`
- [ ] Task 5 Step 4의 브라우저 시나리오 1~5 통과
- [ ] `git status` 깨끗함 (진단용 임시 파일·`.playwright-mcp` 정리)

## 하지 않는 것 (스펙의 "하지 않는 것" 그대로)

- 키보드 순서 변경(↑↓ 버튼)
- 공유 열람 화면(`/list/[slug]`)의 편집 — 편집 UI가 없는 것이 그 화면의 안전장치다
- 여러 곡 선택 후 한 번에 이동
- 되돌리기(undo)
