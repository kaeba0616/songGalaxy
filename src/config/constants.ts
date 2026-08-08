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
