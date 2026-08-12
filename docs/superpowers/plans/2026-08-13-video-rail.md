# 영상 우측 레일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목록 재생 중 뜨는 영상을 화면 오른쪽 전체 높이 레일로 바꾸고 그 안에 재생 목록을 넣으며, 콘텐츠 페이지 본문이 레일에 가려지지 않게 자리를 비운다.

**Architecture:** 재생 목록 UI를 `MiniPlayer`에서 `QueueList`로 꺼내 알약과 레일이 같은 컴포넌트를 쓰게 한다. `VideoStage`는 마운트 위치·조건을 그대로 둔 채(iframe 재부모화 금지) 반응형 클래스로만 레일 모양이 되고, 자기 크기를 `ResizeObserver`로 재서 CSS 변수로 내보낸다. `globals.css`의 `main` 규칙 하나가 그 변수를 읽어 콘텐츠 페이지만 자리를 비운다 — 은하는 `<main>`을 쓰지 않아 규칙에 걸리지 않는다.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, `node:test` + tsx

## Global Constraints

- **새 npm 패키지를 설치하지 않는다.** 이 저장소에서 `npm install`이 멈춘다(2026-08-11 실측: 18분간 CPU 0.4%).
- **iframe을 DOM에서 옮기지 않는다.** 부모가 바뀌면 브라우저가 문서를 새로 로드해 재생이 처음부터 다시 시작된다. 모양 전환은 CSS(반응형 클래스·`hidden`)로만 한다.
- **접힘은 언마운트가 아니라 `hidden`이다.** 내리면 제어 손잡이가 사라져 이어 들을 수 없다.
- 영상 세로는 `VIDEO_MIN_PX`(200, `src/config/constants.ts`) 아래로 내려갈 수 없다 — YouTube 개발자 정책.
- 모든 주석·UI 문구는 한국어, why-first 하우스 스타일.
- `npx tsc --noEmit` 깨끗, `npx eslint`가 건드린 파일에 새 오류 없음, `npm run build` 성공, `npm test` 전부 통과.
  - 참고: `src/player/player-context.tsx:258`(볼륨 복원 이펙트)에 **기존** eslint 오류가 하나 있다. 건드리지 말 것.
- SSOT: 새 원본이 생기면 `docs/SSOT.md`를 **같은 커밋**에 갱신한다.
- 커밋 메시지는 `.claude/skills/commit-with-prompts/SKILL.md` 형식. `[Prompts]` 섹션에 이 작업의 프롬프트 원문 두 개를 넣는다:
  1. `한줄 정리 -> 푸시 배포, 그리고 영상 사이드바 도크 가림 문제까지 해결하자`
  2. `우선 이렇게 진행해보고 별로인부분들을 수정해보자`

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/player/QueueList.tsx` (신규) | 지금 큐의 곡 목록 — 알약과 레일이 공용으로 쓴다 |
| `src/player/MiniPlayer.tsx` (수정) | 목록 JSX를 `QueueList`로 교체, 관련 효과 제거 |
| `src/player/VideoStage.tsx` (수정) | 레일 모양 + 재생 목록 + 크기를 CSS 변수로 내보내기 |
| `src/app/globals.css` (수정) | `main`이 변수를 읽어 자리를 비우는 규칙 |
| `docs/SSOT.md` (수정) | 무대의 자리 행 갱신 + 재생 목록 UI 원본 등록 |

---

### Task 1: 재생 목록을 공용 컴포넌트로 꺼내기

**Files:**
- Create: `src/player/QueueList.tsx`
- Modify: `src/player/MiniPlayer.tsx`

**Interfaces:**
- Consumes: `usePlayer()` (기존), `Marquee` (`src/player/Marquee.tsx`, 기존), `ENRICH_BATCH` (`src/config/constants.ts`, 기존)
- Produces: `<QueueList className?: string />` — 큐의 곡 목록 전체(헤더 + `<ul>`). 붙는 자리는 `className`으로 부르는 쪽이 정한다. 큐가 비었으면 `null`.

- [ ] **Step 1: `QueueList` 작성**

`src/player/QueueList.tsx`:

```tsx
"use client";

/**
 * 지금 재생 중인 큐의 곡 목록.
 *
 * 알약(`MiniPlayer`)의 ≡ 패널과 영상 레일(`VideoStage`)이 **같은 이 컴포넌트**를 쓴다.
 * 두 벌로 두면 반드시 어긋난다 — 곡을 고르는 규칙(`playInQueue`가 큐의 mode를 지킨다)이
 * 한쪽에만 반영되는 식으로 갈라진다.
 *
 * 필요한 것은 스스로 `usePlayer()`에서 읽는다. 부르는 쪽이 정하는 것은 붙는 자리뿐이다.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { ENRICH_BATCH } from "@/config/constants";
import Marquee from "./Marquee";
import { usePlayer } from "./player-context";

export default function QueueList({ className = "" }: { className?: string }) {
  const { queue, playingId, isPaused, media, fetchMedia, playInQueue, toggle } = usePlayer();
  const listRef = useRef<HTMLUListElement>(null);
  const songs = queue?.songs ?? [];
  const currentIndex = songs.findIndex((s) => s.id === playingId);

  // 보이는 동안 현재 곡 주변의 앨범아트를 보강한다 — 목록 재생은 영상 ID가 있으면
  // /api/enrich를 건너뛰므로 그냥 두면 ✦ 자리표시자만 늘어선다
  useEffect(() => {
    if (songs.length === 0) return;
    const start = Math.max(0, currentIndex - 2);
    void fetchMedia(songs.slice(start, start + ENRICH_BATCH).map((s) => s.id));
  }, [currentIndex, songs, fetchMedia]);

  // 열리면 지금 곡이 보이도록 스크롤 (긴 목록에서 어디를 듣고 있는지 잃지 않게)
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "center" });
  }, []);

  if (songs.length === 0) return null;

  return (
    <div className={className}>
      <div className="border-b border-white/10 px-4 py-2.5">
        <p className="text-[11px] tracking-widest text-white/40">재생 목록</p>
        <p className="truncate text-sm font-medium">{queue?.title ?? "재생 중"}</p>
        <p className="mt-0.5 text-xs text-white/45">
          {songs.length}곡{currentIndex >= 0 && ` · ${currentIndex + 1}번째 재생 중`}
        </p>
      </div>
      {/* overscroll-contain: 끝까지 스크롤해도 뒤 페이지로 넘어가지 않게.
          touchAction: 알약 안에서는 바깥이 드래그용으로 none이라 여기서 세로 스크롤을 되살린다 */}
      <ul
        ref={listRef}
        style={{ touchAction: "pan-y" }}
        className="flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {songs.map((s, i) => {
          const isCurrent = s.id === playingId;
          const art = media[s.id]?.artworkUrl;
          return (
            <li key={s.id}>
              <button
                type="button"
                data-current={isCurrent}
                onClick={() => {
                  // playInQueue는 이 큐의 mode를 지킨다 — 목록 재생 중에 곡을 고르면
                  // 30초 미리듣기로 강등되지 않고 그대로 영상으로 이어진다
                  if (isCurrent) toggle();
                  else if (queue) void playInQueue(queue, s.id).catch(() => undefined);
                }}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition hover:bg-white/10 ${
                  isCurrent ? "bg-white/10" : ""
                }`}
              >
                <span className="w-5 shrink-0 text-center text-[11px] text-white/35">
                  {isCurrent ? (isPaused ? "❚❚" : "♪") : i + 1}
                </span>
                {art ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
                  <img
                    src={art}
                    alt=""
                    draggable={false}
                    className="h-8 w-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-white/10 text-xs text-amber-100/70">
                    ✦
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <Marquee
                    text={s.title}
                    className={`text-sm ${isCurrent ? "font-medium text-amber-100" : ""}`}
                  />
                  <Marquee text={s.artist} className="text-xs text-white/45" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: `MiniPlayer`에서 갈아끼우기**

`src/player/MiniPlayer.tsx`에서:

1. import 추가: `import QueueList from "./QueueList";`
2. `expanded &&` 블록의 내용(헤더 `<div>` + `<ul>` 전체)을 `<QueueList className="flex max-h-[45vh] flex-col" />` 한 줄로 바꾼다. 바깥의 `<div data-playlist className={...openUp...}>`는 **그대로 둔다** — 알약 폭에 맞춰 위/아래로 펼치는 자리 계산은 알약의 일이다.
3. 더 이상 쓰이지 않는 것을 지운다: `listRef`, 목록 보강용 `useEffect`(현재 곡 주변 `fetchMedia`), 스크롤용 `useLayoutEffect`, `currentIndex`, `useLayoutEffect` import. **`playingId` 하나만 보강하는 `useEffect`(원반 앨범아트용)는 남긴다** — 그건 알약 자신의 원반이 쓴다.
4. `media`, `playInQueue`, `isPaused`, `fetchMedia` 등이 알약의 다른 곳에서도 쓰이는지 확인하고, 안 쓰이면 `usePlayer()` 구조분해에서 뺀다. `isPaused`는 원반 회전과 재생 버튼이 쓰므로 남는다.

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npx eslint src/player/QueueList.tsx src/player/MiniPlayer.tsx && npm run build 2>&1 | grep -E "Compiled successfully|Error"`
Expected: 타입·린트 출력 없음, `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add src/player/QueueList.tsx src/player/MiniPlayer.tsx
git commit -m "$(cat <<'EOF'
refactor: 재생 목록을 QueueList로 꺼내 공용화

알약과 (다음 커밋의) 영상 레일이 같은 목록 UI를 쓰게 한다.
두 벌로 두면 곡 고르기 규칙이 한쪽에만 반영되며 갈라진다.

[Prompts]
1. 한줄 정리 -> 푸시 배포, 그리고 영상 사이드바 도크 가림 문제까지 해결하자
2. 우선 이렇게 진행해보고 별로인부분들을 수정해보자
EOF
)"
```

---

### Task 2: 레일 모양 + 콘텐츠 자리 비우기

**Files:**
- Modify: `src/player/VideoStage.tsx`
- Modify: `src/app/globals.css`
- Modify: `docs/SSOT.md`

**Interfaces:**
- Consumes: `QueueList` (Task 1), `stageVideoId`/`videoExpanded`/`engine`/`setVideoExpanded`/`registerYoutube`/`reportYoutubeError`/`toggle`/`playStep` (기존 `usePlayer()`), `VIDEO_MIN_PX` (`src/config/constants.ts`)
- Produces: CSS 변수 `--video-rail-w`, `--video-rail-h` (`document.documentElement`), `globals.css`의 `main` 규칙

- [ ] **Step 1: `VideoStage`를 레일로**

`src/player/VideoStage.tsx`의 바깥 래퍼와 본문을 다음으로 바꾼다. 마운트 조건(`if (stageVideoId === null) return null;`)과 `YoutubeStage` 호출부는 **그대로 둔다**.

```tsx
  return (
    <div
      ref={wrapRef}
      /* sm 이상: 오른쪽 전체 높이 레일. 미만: 지금처럼 우측 상단에 떠 있는 카드
         (폰에는 세로 레일을 둘 폭이 없다). 모양 전환은 CSS만으로 한다 —
         iframe은 DOM에서 부모가 바뀌면 문서를 새로 로드해 재생이 처음부터 다시 시작된다 */
      className="fixed right-4 top-20 z-40 w-[min(92vw,420px)] sm:inset-y-0 sm:right-0 sm:top-0 sm:flex sm:w-[360px] sm:flex-col sm:border-l sm:border-white/10 sm:bg-black/85 sm:backdrop-blur"
    >
      <div
        className={
          videoExpanded
            ? "overflow-hidden rounded-2xl border border-white/15 bg-black shadow-xl sm:rounded-none sm:border-0 sm:shadow-none"
            : "hidden"
        }
      >
        <div className="aspect-video w-full" style={{ minHeight: VIDEO_MIN_PX }}>
          <YoutubeStage
            videoId={stageVideoId}
            register={registerYoutube}
            onEnded={() => void playStep(1)}
            onError={reportYoutubeError}
          />
        </div>
        <button
          type="button"
          onClick={() => setVideoExpanded(false)}
          className="w-full cursor-pointer py-1.5 text-xs text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          영상 접기 (재생이 멈춥니다)
        </button>
      </div>

      {engine === "youtube" && !videoExpanded && (
        <button
          type="button"
          onClick={toggle}
          className="w-full cursor-pointer rounded-full border border-white/15 bg-black/80 py-1.5 text-xs text-white/70 backdrop-blur transition hover:bg-white/10 sm:rounded-none sm:border-0"
        >
          영상 펼치고 이어 듣기
        </button>
      )}

      {/* 재생 목록은 레일에서만 보인다 — 좁은 화면에는 알약의 ≡가 이미 있고,
          떠 있는 카드에 목록까지 넣으면 화면을 다 덮는다.
          min-h-0: flex 자식은 기본 min-height가 auto라, 이게 없으면 목록이 레일 밖으로 넘친다 */}
      <QueueList className="hidden min-h-0 flex-1 flex-col text-white sm:flex" />
    </div>
  );
```

컴포넌트 앞부분에 `const wrapRef = useRef<HTMLDivElement>(null);`를 추가하고, import에 `useEffect`, `useRef`, `QueueList`를 더한다.

- [ ] **Step 2: 크기를 CSS 변수로 내보내기**

같은 파일, `if (stageVideoId === null) return null;` **위**에 넣는다 (훅은 조기 반환보다 앞에 있어야 한다):

```tsx
  /**
   * 레일/카드가 차지하는 크기를 CSS 변수로 알린다 — `globals.css`의 `main` 규칙이
   * 이걸 읽어 콘텐츠 페이지 본문이 영상 아래에 깔리지 않게 자리를 비운다.
   *
   * 픽셀을 하드코딩하지 않고 실제로 재는 이유: 영상 세로는 화면 폭과 `VIDEO_MIN_PX`에
   * 따라 달라지고 접기 버튼도 붙는다. 하드코딩하면 그때마다 여백이 어긋난다.
   * 넓은 화면에서는 폭만, 좁은 화면에서는 높이만 쓴다(레일은 옆으로, 카드는 위로 비킨다).
   */
  useEffect(() => {
    const el = wrapRef.current;
    const root = document.documentElement;
    const clear = () => {
      root.style.setProperty("--video-rail-w", "0px");
      root.style.setProperty("--video-rail-h", "0px");
    };
    if (!el || typeof ResizeObserver === "undefined") {
      clear();
      return clear;
    }
    const apply = () => {
      const rail = window.matchMedia("(min-width: 640px)").matches;
      const r = el.getBoundingClientRect();
      root.style.setProperty("--video-rail-w", rail ? `${Math.round(r.width)}px` : "0px");
      // 카드는 top-20(5rem) 아래에 떠 있으므로 그 시작 위치까지 포함해 비운다
      root.style.setProperty("--video-rail-h", rail ? "0px" : `${Math.round(r.bottom)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      // 무대가 내려가면 여백도 걷는다 — 안 그러면 영상이 끝난 뒤에도 빈 자리가 남는다
      clear();
    };
  }, [stageVideoId, videoExpanded]);
```

- [ ] **Step 3: `globals.css` 규칙**

`src/app/globals.css` 끝에 추가:

```css
/* 영상 레일/카드가 서 있는 동안 콘텐츠 본문이 그 아래로 깔리지 않게 자리를 비운다.
   값은 VideoStage가 자기 크기를 재서 채운다 (없으면 0).

   은하(/, /planet/[id])는 <main>을 쓰지 않고 GalaxyCanvas를 그대로 렌더하므로
   이 규칙에 걸리지 않는다 — 전체 화면 캔버스 위에는 겹치는 것이 맞고, 캔버스는
   window.resize만 듣기 때문에 폭을 밀면 다음 창 크기 변경 전까지 늘어난 채 남는다. */
main {
  padding-right: var(--video-rail-w, 0px);
  padding-top: var(--video-rail-h, 0px);
}
```

- [ ] **Step 4: SSOT 갱신**

`docs/SSOT.md`에서:

1. `YouTube 무대의 자리` 행의 비고를 갱신한다 — 우측 상단 카드에서 **`sm` 이상은 우측 전체 높이 레일, 미만은 카드**로 바뀌었고, 콘텐츠 페이지는 `--video-rail-w`/`--video-rail-h`와 `globals.css`의 `main` 규칙으로 자리를 비우며, 은하는 `<main>`을 쓰지 않아 규칙에 안 걸린다는 점(그리고 그게 의도라는 점)을 적는다. "자리를 옮기지 않는다(iframe 재로드)"는 기존 문장은 그대로 둔다.
2. 표에 행 하나를 추가한다:

```markdown
| 재생 목록 UI | `src/player/QueueList.tsx` | 알약(`MiniPlayer`)의 ≡ 패널, 영상 레일(`VideoStage`) | 두 곳이 같은 컴포넌트를 쓴다 — 두 벌로 두면 곡 고르기 규칙(`playInQueue`가 큐의 mode를 지킨다)이 한쪽에만 반영되며 갈라진다. 붙는 자리만 `className`으로 부르는 쪽이 정한다 |
```

- [ ] **Step 5: 검증**

Run: `npx tsc --noEmit && npx eslint src/player/VideoStage.tsx src/player/QueueList.tsx src/player/MiniPlayer.tsx && npm run build 2>&1 | grep -E "Compiled successfully|Error" && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: 타입·린트 출력 없음, `✓ Compiled successfully`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add src/player/VideoStage.tsx src/app/globals.css docs/SSOT.md
git commit -m "$(cat <<'EOF'
feat: 영상을 우측 전체 높이 레일로 + 본문이 레일을 피하게

넓은 화면에서는 오른쪽 레일(영상 + 재생 목록), 좁은 화면에서는 지금처럼
떠 있는 카드. 레일이 자기 크기를 CSS 변수로 알리고 globals.css의 main
규칙이 그만큼 본문 여백을 준다 — <main>을 쓰지 않는 은하는 그대로 겹친다.

영상 재생 중에 목록의 ✕·+ 버튼이 iframe에 가려 눌리지 않던 문제를 없앤다.

[Prompts]
1. 한줄 정리 -> 푸시 배포, 그리고 영상 사이드바 도크 가림 문제까지 해결하자
2. 우선 이렇게 진행해보고 별로인부분들을 수정해보자
EOF
)"
```

---

## 검증 (전체 — 컨트롤러가 브라우저로 직접 확인한다)

로컬 dev를 프로덕션 DB에 붙이고(`vercel env pull`로 받은 `DATABASE_URL`), 로그인 쿠키를 심어 확인한다:

- [ ] `npm test` `# fail 0`, `npx tsc --noEmit` 무출력, `npm run build` 성공
- [ ] 1440×900에서 목록 재생 중 `/lists/[id]`의 `✕` 3개가 `elementFromPoint` 기준 **IFRAME이 아니다**
- [ ] 같은 조건에서 `/songs`의 `+` 버튼도 안 가린다
- [ ] 은하(`/`)에서는 레일이 겹치되 성단 라벨이 지금보다 덜 가려진다 (우측 끝으로 갔으므로)
- [ ] 레일 안 재생 목록에서 곡을 고르면 영상이 그 곡으로 바뀐다 (미리듣기로 강등되지 않음)
- [ ] 영상 접기 → 본문 여백이 사라진다 / 다시 펼치면 돌아온다
- [ ] 390×844(폰)에서 카드가 위에 뜨고 본문이 그 아래에서 시작한다
- [ ] 겹쳐 띄운 경로(은하 → 내 노래 목록 → 목록)에서도 본문이 레일을 피한다
- [ ] `git status` 깨끗
