# 노래 목록 + YouTube 전체 재생 설계 (2026-08-11)

## 목표

사용자가 이름 붙인 노래 목록을 여러 개 만들고, 그 목록의 곡을 30초 미리듣기가
아니라 **YouTube 공식 임베드 플레이어로 전곡** 들을 수 있게 한다.
목록은 공유 링크로 남에게 보여줄 수 있다.

## 확정 결정 (사용자 승인)

- YouTube 전체 재생 범위: **목록 재생에서만**. 은하 탐색·카드 캐러셀은 지금처럼 30초 미리듣기.
  (내가 만든 목록이든 공유 링크로 받은 남의 목록이든, 목록을 재생하면 전곡 재생이다)
- 목록 모양: **이름 붙인 여러 개 + 공유 링크**
- 플레이어 위치: **알약(미니플레이어)이 위로 펼쳐지며 그 자리에 영상**
- 접기 버튼은 **일시정지와 한 몸**으로 묶는다 (아래 "약관 준수" 참조)

## 약관 준수 — 이 설계의 전제

YouTube 약관은 공식 플레이어나 API를 통하지 않은 스트림 접근을 금지한다.
`ytdl`·`yt-dlp` 류로 `googlevideo.com` 파일 주소를 추출해 자체 `<audio>`로
재생하는 방식은 (1) 약관 위반이고 (2) 서명·난독화를 푸는 기술적 보호조치 우회로
저작권법 제104조의2(미국 DMCA §1201)의 별도 위반이며 (3) 광고를 건너뛰어
권리자 수익을 없앤다. **이 방식은 절대 쓰지 않는다.**

대신 **YouTube IFrame Player API**만 쓴다. 광고가 정상 재생되고 조회수가 집계된다.
그 대가로 **플레이어가 화면에 보여야 한다** — 숨기거나 1픽셀로 만들면 그 자체가 위반이다.
그래서 "영상을 접으면 소리도 멈춘다"가 UI 선택이 아니라 준수 요건이다.

2026-08-11 기준 코드 감사 결과 위반 없음:
`ytdl`/`yt-dlp`/`play-dl`/`youtubei` 계열 의존성 0건,
`googlevideo`·`player_response`·`signatureCipher`·`adaptiveFormats` 문자열
`src/`·`scripts/` 전체 0건, `<audio>`에 들어가는 소스는 iTunes/Deezer의
공식 미리듣기 링크(`previewUrl`) 하나뿐.

## 영상 ID 확보 — 쿼터가 이 기능의 병목이다

YouTube Data API 무료 쿼터는 하루 10,000유닛이고 `search.list`가 100유닛이라
**하루 100곡**만 새로 찾을 수 있다. 2026-08-11 기준 50,859곡 중 33곡만
`youtube_video_id`가 채워져 있다(곡 상세 페이지를 연 곡만 채워지기 때문).
전체를 미리 채우는 것은 불가능하다(하루 100곡이면 약 1,400년).

쿼터를 쓰지 않는 대안은 실측으로 모두 배제했다:

| 경로 | 결과 |
| --- | --- |
| Odesli(song.link) 무료 API | HTTP 200이지만 응답에서 YouTube를 제외. amazonMusic·deezer·tidal·appleMusic만 옴 |
| MusicBrainz 레코딩 URL 관계 | 표본 5곡 전부 관계 0건 (Bohemian Rhapsody 포함) |
| YouTube Data API 저비용 엔드포인트 | 없음. `videos.list`는 1유닛이나 ID를 이미 알아야 함 |
| IFrame `listType=search` | 2020년 제거됨 (기존 `src/server/youtube.ts` 주석에 기록) |

따라서 설계는 병목을 없애는 대신 **병목을 견디도록** 한다.

- 조회 시점은 **곡을 목록에 담을 때** 한 번. 탐색 중에는 조회하지 않아 쿼터를 아낀다.
- 캐시(`songs.youtube_video_id`)는 전 사용자 공유다. 하루 한도는 "재생 100회"가
  아니라 "**이 서비스가 처음 보는 곡** 100개"이며, 찾은 ID는 영구히 남는다.
- 쿼터 초과 시 `youtube_checked_at`을 기록하지 않아 다음 날 자동 재시도된다
  (기존 `getYoutubeVideoId`가 이미 이렇게 동작한다 — 그대로 쓴다).
- 영상 ID가 없는 곡은 **그 곡만** 30초 미리듣기로 재생된다. 목록 전체가 죽지 않는다.

쿼터 증액 신청(YouTube API Services Audit and Quota Extension Form)은 무료이며
이 용도가 그 절차의 대상이다. 승인은 보장되지 않고 수 주가 걸리므로 설계 전제로 삼지 않는다.

## 데이터 모델

```
playlists
  id          serial PK
  user_id     integer NOT NULL     -- 소유자
  name        text    NOT NULL
  share_slug  text    UNIQUE       -- NULL이면 비공개
  created_at  timestamp NOT NULL
  updated_at  timestamp NOT NULL

playlist_songs
  playlist_id integer NOT NULL
  song_id     integer NOT NULL
  position    integer NOT NULL     -- 목록 내 순서
  added_at    timestamp NOT NULL
  PK (playlist_id, song_id)
```

곡 개수는 컬럼으로 두지 않고 `count(*)`로 구한다 (SSOT: 계산 가능한 값은 저장하지 않는다).

공유는 `share_slug` 하나로 표현한다. NULL이면 비공개, 값이 있으면 그 slug를 아는
누구나 `/list/[slug]`를 볼 수 있다. 기본값은 NULL이고 "공유 링크 만들기"를 눌러야
생성된다. 편집(이름 변경·곡 추가/삭제·삭제)은 언제나 `user_id` 소유자만 가능하다.
공유를 끄면 slug를 NULL로 되돌린다 — 기존 링크는 즉시 죽는다.

## 재생 구조 — PlayerProvider 확장

현재 `src/player/player-context.tsx`의 `PlayerProvider`가 재생의 단일 원본이고
`<audio>` 하나를 소유한다. YouTube가 들어오면 소리 나는 곳이 둘이 되므로,
**두 엔진을 모두 PlayerProvider가 소유하고 곡마다 하나만 켠다.**

- 상태에 `engine: "preview" | "youtube"`를 추가한다.
- `<audio>`는 지금 그대로 둔다.
- YouTube IFrame Player는 `MiniPlayer`가 화면에 그리되, 재생 제어권은
  `PlayerProvider`가 ref로 잡는다. 제어권이 Provider에 있어야 페이지를 옮겨도
  재생이 이어지는 지금 구조가 유지된다.
- 엔진을 전환할 때 반대쪽을 **반드시 정지**시킨다. 동시 재생은 어떤 경로로도 없어야 한다.

곡 하나를 재생할 때의 판단은 한 곳에 모은다: 목록 재생이고 그 곡에
`youtube_video_id`가 있으면 `youtube`, 아니면 `preview`.

### 기존 동작에 맞춰 붙는 지점

- **자동 다음 곡**: `<audio>`는 `onended`, YouTube는 `onStateChange`의 `ENDED`.
  둘 다 기존 `advanceRef`로 들어간다. 큐 순환·루프 로직은 그대로 재사용한다.
- **볼륨 단위**: YouTube는 0~100, `<audio>`는 0~1. `changeVolume` 하나가 양쪽에 반영한다.
- **일시정지**: `toggle()`이 활성 엔진에 위임한다.
- **접기**: 영상 패널을 접으면 일시정지한다(약관 요건). 펼치면 재개한다.
- **모바일 자동재생**: YouTube IFrame은 사용자 제스처 없이는 소리를 못 낸다.
  첫 재생이 항상 클릭에서 시작하는 현재 구조가 그대로 요건을 만족한다.
- **스냅샷/복원**: 행성 착륙 시 `snapshot()`에 `engine`도 담고, `restore()`가
  같은 엔진으로 되살린다.

## 화면

- **알약**: ♥ 옆에 `+` 버튼 — 지금 듣는 곡을 목록에 담는다. 누르면 내 목록이
  팝오버로 뜨고, 목록이 하나도 없으면 그 자리에서 이름을 입력해 새로 만든다
  (목록을 먼저 만들러 다른 페이지로 보내지 않는다).
  목록을 재생 중이면 알약 위로 영상 패널이 펼쳐지고 접기 버튼이 붙는다.
- **`/lists`**: 내 목록 관리 — 만들기, 이름 변경, 삭제, 공유 링크 생성/해제.
- **`/lists/[id]`**: 소유자용 목록 상세 — 곡 목록, 재생 시작, 곡 빼기.
- **`/list/[slug]`**: 공유 열람용. 경로가 `/lists/[id]`와 따로인 이유는 접근 근거가
  다르기 때문이다 — `/lists/*`는 로그인 소유자 확인, `/list/*`는 slug 소지만 확인한다.
  로그인 없이 열람·재생 가능하고 편집 UI는 없다.

## 오류 처리

- 영상 ID 없음 → 그 곡만 미리듣기 폴백. 미리듣기도 없으면 다음 곡으로 건너뛴다
  (기존 `advanceRef`가 이미 하는 일).
- IFrame API 스크립트 로드 실패 → 목록 전체를 미리듣기로 재생하고 안내 한 줄.
- 임베드 거부(권리자가 임베드를 막은 영상) → `onError`를 받아 그 곡을 미리듣기로
  폴백하고, `youtube_video_id`만 NULL로 지우되 `youtube_checked_at`은 남긴다.
  "확인했고 쓸 수 있는 영상이 없다"는 뜻이라 다시 검색하지 않는다 — 재검색하면
  같은 영상을 또 찾아오면서 쿼터만 태운다. (검색에 `videoEmbeddable=true`가
  이미 걸려 있어 이 경우는 드물다.)
- 비로그인 사용자가 `+`를 누름 → 로그인 유도 (기존 `LikeButton`과 같은 방식).
- 남의 목록 편집 시도 → 서버에서 소유자 검사 후 403.

## 검증

- 동시 재생 없음: 엔진 전환 시 반대쪽이 멈추는지 — 목록 재생 중 은하로 나가
  카드 미리듣기를 눌러본다.
- 접기 = 정지: 영상을 접었을 때 소리가 완전히 멎는지.
- 폴백: 영상 ID가 없는 곡이 섞인 목록이 끊기지 않고 끝까지 재생되는지.
- 권한: 남의 목록 편집 API가 403을 주는지, 비공개 목록의 `/list/[slug]`가 404인지.
- 쿼터: 담기 1회에 검색이 1회만 나가는지(캐시된 곡은 0회).

## 범위 밖 (이번에 하지 않음)

- 드래그로 곡 순서 바꾸기 (`position` 컬럼은 미리 두되 UI는 나중에)
- `/songs` 목록의 행마다 담기 버튼
- 목록 좋아요·댓글·협업 편집
- 목록 자동 생성(추천)
