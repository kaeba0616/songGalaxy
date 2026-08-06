/**
 * 은하 렌더링 페이로드 타입 — /api/galaxy 응답 (원본: DB songs/themes, docs/SSOT.md)
 * 30,000곡을 전송하므로 행 객체 배열 대신 컬럼형 배열로 직렬화 비용을 줄인다.
 */

export interface GalaxyTheme {
  id: number;
  /** 슬러그(level 1) 또는 장르명(level 2) */
  name: string;
  /** 화면 표시용 이름표 */
  label: string;
  level: 1 | 2;
  parentId: number | null;
  x: number;
  y: number;
  z: number;
  radius: number;
  color: string;
}

export interface GalaxyPayload {
  songs: {
    id: number[];
    title: string[];
    artist: string[];
    /** xyz 인터리브 (길이 = 3 × 곡 수) */
    pos: number[];
    popularity: number[];
    themeId: number[];
  };
  themes: GalaxyTheme[];
}
