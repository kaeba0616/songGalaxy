# 노래 목록 순서 편집 — 설계

작성: 2026-08-12
관련 원본: `docs/SSOT.md` (노래 목록, 미리듣기 재생 상태), `docs/superpowers/specs/2026-08-11-playlists-youtube-design.md`

## 무엇을 만드나

내 노래 목록(`/lists/[id]`)에서 곡을 **드래그로 끌어 재생 순서를 바꾸고**, 목록에서 **곡을 뺄 수 있게** 한다.

## 왜 지금 가능한가

- `playlist_songs.position`이 이미 재생 순서를 결정한다 (`getPlaylistById`가 position 순으로 정렬해 돌려주고, `PlaylistPlayButton`이 그 순서를 큐로 넘긴다). 저장할 자리가 이미 있다.
- 곡을 빼는 `removeSongFromPlaylist`와 `DELETE /api/playlists/[id]/songs`도 이미 있다. **UI만 없다.**

즉 이 작업은 대부분 UI와, 순서를 통째로 다시 쓰는 서버 함수 하나다.

## 제약

- **이 저장소에서는 `npm install`이 멈춘다** (2026-08-11 실측: 18분간 CPU 0.4%, `--loglevel=http` 출력 없음). dnd-kit 같은 드래그 라이브러리를 새로 들일 수 없다.
- HTML5 `draggable`은 터치에서 동작하지 않는다. 모바일에서 써야 하므로 어느 쪽이든 포인터 이벤트로 직접 만든다.
- 목록 상세는 겹쳐 띄우는 경로(`src/app/@modal/(.)lists/[id]`)로도 렌더링된다 — 편집 UI는 두 경로에서 똑같이 동작해야 한다(같은 컴포넌트를 쓰므로 자동으로 만족).

## 결정 사항

| 질문 | 결정 | 이유 |
| --- | --- | --- |
| 재생 중인 목록의 순서를 바꾸면? | 듣던 곡은 그대로 두고, 큐 순서만 즉시 갱신 | 재생을 끊지 않으면서 "다음 곡부터 새 순서"가 자연스럽다. 알약의 재생 목록도 바로 새 순서로 보인다 |
| 이동 수단 | 드래그만 (↑↓ 버튼 없음) | 화면을 깔끔하게. **키보드만 쓰는 사람은 순서를 바꿀 수 없다는 한계를 감수한다** |
| 곡 빼기 UI | 같이 넣는다 | 서버 API가 이미 있고, 편집 UI를 만드는 김에 붙이는 것이 자연스럽다 |

## 서버

`src/server/playlists.ts`에 추가:

```ts
export type ReorderResult = "ok" | "forbidden" | "mismatch";
export async function reorderPlaylistSongs(
  userId: number, playlistId: number, songIds: number[],
): Promise<ReorderResult>;
```

1. 소유권 확인 (`findMyPlaylist`) — 아니면 `"forbidden"`
2. 현재 담긴 곡 id 집합과 받은 `songIds`의 집합이 **정확히 같은지** 확인 — 다르면 `"mismatch"`
3. 한 트랜잭션에서 `position`을 배열 인덱스(0..n-1)로 재기록

부분 이동(`{songId, toIndex}`)이 아니라 **전체 순서 배열**을 받는다: 멱등적이고, 다른 탭에서 곡이 추가·삭제돼 클라이언트가 낡았을 때 조용히 어긋나는 대신 집합 비교로 잡힌다.

창구: `PATCH /api/playlists/[id]/songs`, body `{ songIds: number[] }`
→ `200 {ok:true}` / `403` / `409 {error:"mismatch"}` / `400`(형식 오류)

`position`을 0..n-1로 다시 쓰더라도 `nextPosition`(최대값+1)의 전제는 그대로 유지된다.

## 클라이언트 — `PlaylistEditor`

목록 상세 페이지에서 곡 `<ul>` 부분만 새 클라이언트 컴포넌트로 떼어낸다. 페이지 자체는 서버 컴포넌트로 남긴다 (소유권 검사·`retryMissingVideos`는 그대로 서버에서).

- 행 좌측 `⠿` 손잡이에서 `pointerdown` → `setPointerCapture` → 이동량으로 목표 인덱스 계산 → 나머지 행을 `translateY`로 미리 밀어 보여주고 → `pointerup`에서 확정
- 행 높이가 균일하므로 목표 인덱스는 `dropIndex(from, deltaY, rowHeight, count)` 한 줄로 나온다
- 같은 코드가 마우스·터치 모두에서 동작한다 (포인터 이벤트)
- 놓는 즉시 화면에 반영하고 PATCH를 보낸다(낙관적). 실패하면 원래 순서로 되돌리고 한 줄 안내
- 행 우측 `✕` = 곡 빼기. 낙관적 제거 + DELETE, 실패 시 복구
- 곡이 1개 이하면 손잡이를 숨긴다
- 손잡이는 `<button>`으로 두어 스크린리더에 읽히게 한다 (순서 변경 자체는 드래그 전용)

## 재생 중인 목록과의 동기화

`PlayerQueue`에 `playlistId?: number`를 추가한다 — 지금은 `title`뿐이라 "이 큐가 그 목록인지" 알 방법이 없다. `PlaylistPlayButton`이 채운다.

`PlayerProvider`에 추가:

```ts
/** 그 목록이 지금 큐일 때만 곡 순서를 새 순서로 맞춘다. 재생 중인 곡은 건드리지 않는다 */
reorderQueue(playlistId: number, songIds: number[]): void;
/** 그 목록이 지금 큐일 때 곡을 뺀다. 빼는 곡이 재생 중이면 다음 곡으로 넘어간다 */
removeFromQueue(playlistId: number, songId: number): void;
```

- `reorderQueue`: `queueRef.current?.playlistId`가 같을 때만 `songs`를 새 순서로 재배열한다. `playingId`·오디오·영상은 건드리지 않는다 → 듣던 곡은 그대로, 자동 진행이 `findPlayable`로 새 배열에서 현재 곡 다음을 찾는다.
- `removeFromQueue`: 큐에서 뺀다. **빼는 곡이 지금 재생 중이면 ⏭를 누른 것과 같게 다음 곡으로 넘긴다** — 그러지 않으면 큐에 없는 곡이 끝났을 때 `advanceRef`가 `idx < 0`으로 재생을 끝내버린다.

## 순수 함수 + 테스트

`src/lib/reorder.ts` (SSOT: 순서 계산은 여기 한 곳):

```ts
export function moveItem<T>(list: T[], from: number, to: number): T[];
export function dropIndex(from: number, deltaY: number, rowHeight: number, count: number): number;
export function sameMembers(a: number[], b: number[]): boolean;
```

`src/lib/reorder.test.ts` (`node:test`)로 검증:

- `moveItem`: 아래로 이동, 위로 이동, 제자리(같은 배열 내용), 맨 위/맨 아래 경계, 범위 밖 인덱스
- `dropIndex`: 0으로 클램프, `count-1`로 클램프, 반올림 경계(행 높이의 절반)
- `sameMembers`: 순서만 다르면 true, 하나라도 다르면 false, 길이 다르면 false, 중복 id가 있어도 오판하지 않음

## 실패·경계

| 상황 | 처리 |
| --- | --- |
| 409 (다른 탭에서 곡이 추가·삭제됨) | "목록이 바뀌었어요" 안내 + `router.refresh()` |
| PATCH/DELETE 실패 | 원래 순서·원래 목록으로 되돌리고 한 줄 안내 |
| 드래그 도중 언마운트/라우트 이동 | 포인터 캡처 해제, 진행 중 상태 폐기 |
| 곡 0~1개 | 손잡이 숨김 (`✕`는 유지) |

## 하지 않는 것

- 키보드 순서 변경 (↑↓ 버튼) — 위 결정대로 이번 범위 밖
- 공유 열람 화면(`/list/[slug]`)의 편집 — 편집 UI가 없는 것이 그 화면의 안전장치다
- 여러 곡 선택 후 한 번에 이동
- 되돌리기(undo)
