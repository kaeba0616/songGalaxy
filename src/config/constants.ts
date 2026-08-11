/**
 * 앱 전역 상수 — SSOT (docs/SSOT.md 참조)
 * 값을 바꿀 때는 여기만 수정한다. 다른 곳에 하드코딩 금지.
 */

/** 내 별이 은하에 찍히기 위한 최소 좋아요 곡 수 (D7) */
export const MIN_LIKES_FOR_STAR = 5;

/** 큰 테마(성단) 목표 개수 (D1, 12개 내외) */
export const BIG_THEME_COUNT = 12;

/** 초기 은하를 채우는 곡 수 — 데이터셋 인기도 상위 서브셋 (D13) */
export const GALAXY_SONG_COUNT = 30_000;

/** 은하 전체 반지름 (씬 좌표 단위). 모든 좌표는 이 반지름 안에 있어야 한다 */
export const GALAXY_RADIUS = 1_000;

/** 내 별 좌표 계산 시 최근 좋아요 가중치 (가중 중심점, D6) */
export const RECENT_LIKE_WEIGHT = 1.5;
/** "최근"으로 간주하는 좋아요 개수 */
export const RECENT_LIKE_WINDOW = 10;

/** 앨범아트·미리듣기 보강 배치 크기 — /api/enrich 요청 상한과 클라이언트 배치가 공유 */
export const ENRICH_BATCH = 12;

/**
 * 좌표 산출에 쓰는 오디오 특징 (데이터셋 컬럼명).
 * 적재·배치·신곡 이웃 찾기가 모두 이 목록을 공유한다 — 순서까지 같아야 한다.
 */
export const AUDIO_FEATURE_KEYS = [
  "danceability",
  "energy",
  "loudness",
  "speechiness",
  "acousticness",
  "instrumentalness",
  "liveness",
  "valence",
  "tempo",
] as const;

/** 신곡을 놓을 때 참고할 이웃 곡 수 (특징 공간 최근접) */
export const PLACEMENT_NEIGHBORS = 8;

/**
 * YouTube 무대가 준비되기를 기다리는 한도(ms).
 * IFrame API 스크립트를 내려받고 플레이어가 onReady를 알릴 때까지의 창을 덮는다 —
 * 이 시간이 지나도 무대가 없으면 요청을 버리고 호출부에 실패를 알린다.
 */
export const YT_STAGE_READY_TIMEOUT_MS = 10_000;

/**
 * 영상 오류 폭주 차단 — 이 창(ms) 안에 오류가 이만큼 쌓이면 목록 전체를 미리듣기로 내린다.
 * 오류 → 다음 곡 → 오류가 iframe 로드 속도로 목록 전체를 태우는 것을 막는다.
 */
export const YT_ERROR_WINDOW_MS = 15_000;
export const YT_ERROR_LIMIT = 3;

/**
 * 한 사용자가 하루(직전 24시간)에 태울 수 있는 YouTube 검색 횟수.
 * 서비스 전체 무료 쿼터가 하루 100회(검색 1회 = 100유닛)라 한 사람이 다 쓰면
 * 나머지 사용자 전원이 그날 영상을 못 찾는다.
 */
export const YOUTUBE_LOOKUPS_PER_USER_PER_DAY = 20;

/** 목록 상세를 열 때 "아직 못 찾은 곡"을 다시 찾아보는 최대 곡 수 (한 번의 열람당) */
export const YOUTUBE_LOOKUP_RETRY_MAX = 3;

/** 행성 프로필 — 닉네임 최대 길이 */
export const NICKNAME_MAX = 20;
/** 행성 프로필 — 한 줄 소개 최대 길이 */
export const BIO_MAX = 80;
