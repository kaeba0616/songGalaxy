/**
 * 환경변수 단일 접근 지점 — SSOT (docs/SSOT.md 참조)
 * 코드 어디서도 process.env를 직접 읽지 않는다. 반드시 이 모듈을 거친다.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name}이(가) 설정되지 않았습니다. .env를 확인하세요.`);
  }
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get googleClientId(): string {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret(): string {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get authSecret(): string {
    return required("AUTH_SECRET");
  },
  /** 선택값 — 없으면 곡 상세의 YouTube 재생이 검색 링크 폴백으로 동작 */
  get youtubeApiKey(): string | null {
    return process.env.YOUTUBE_API_KEY ?? null;
  },
  /** 선택값 — 설정되어 있으면 Cron 엔드포인트가 Bearer 토큰을 검증 */
  get cronSecret(): string | null {
    return process.env.CRON_SECRET ?? null;
  },
  /** 선택값 — 아티스트 대표곡 확장(scripts/expand-artists.ts)에 필요. 없으면 확장은 건너뛴다 */
  get lastfmApiKey(): string | null {
    return process.env.LASTFM_API_KEY ?? null;
  },
};
