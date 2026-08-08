/**
 * 행성 테마 팔레트 — SSOT (docs/SSOT.md, 이슈 #10 꾸미기 맛보기)
 * 밤하늘(개인 행성)의 하늘·지면 색 조합. users.planet_theme에 slug 저장.
 * 테마 추가/수정은 반드시 여기서만 한다. 방문자에게도 주인의 테마로 보인다.
 */

export interface PlanetTheme {
  slug: string;
  label: string;
  /** 지평선 부근 하늘색 */
  horizon: string;
  /** 천정(머리 위) 하늘색 */
  zenith: string;
  /** 지평선 글로우 색 (테마의 감성 포인트) */
  glow: string;
  /** 지면(행성 표면) 색 */
  ground: string;
}

export const PLANET_THEMES: PlanetTheme[] = [
  {
    slug: "midnight",
    label: "자정",
    horizon: "#1a2952",
    zenith: "#030612",
    glow: "#3d5aa8",
    ground: "#0a141c",
  },
  {
    slug: "aurora",
    label: "오로라",
    horizon: "#0e3a34",
    zenith: "#02100d",
    glow: "#2fbf9a",
    ground: "#07130e",
  },
  {
    slug: "twilight",
    label: "노을",
    horizon: "#4a2545",
    zenith: "#0d0512",
    glow: "#c96a8d",
    ground: "#160d14",
  },
  {
    slug: "moonlight",
    label: "달빛",
    horizon: "#2e3a4d",
    zenith: "#0a0d14",
    glow: "#9db8d8",
    ground: "#131a22",
  },
];

export const DEFAULT_PLANET_THEME = "midnight";

export function getPlanetTheme(slug: string | null | undefined): PlanetTheme {
  return PLANET_THEMES.find((t) => t.slug === slug) ?? PLANET_THEMES[0];
}
