# SSOT 맵

이 프로젝트의 모든 "진실의 원본"이 어디에 사는지 기록하는 레지스트리.
코드를 작성하기 전에 이 표를 먼저 확인할 것. 여기 없는 원본을 새로 만들면 이 표에 추가할 것.
문서 갱신은 관련 코드 변경과 같은 커밋에 포함한다.

## 현재 유효한 원본

| 지식의 종류 | 원본 위치 | 파생물 | 비고 |
| --- | --- | --- | --- |
| 제품 스펙·확정 결정(D1~D13) | [에픽 이슈 #1](https://github.com/kaeba0616/songGalaxy/issues/1) | 하위 이슈 #2~#8 | 스펙 본문을 다른 문서에 복제하지 말 것 |
| 작업 단위·순서·완료 기준 | 이슈 #2~#8 | — | 각 이슈의 Acceptance Criteria가 완료 정의 |
| 개발 프로세스 규칙 | `.claude/skills/ssot/SKILL.md`, `.claude/skills/commit-with-prompts/SKILL.md` | — | |

## 예정된 원본 (구현 시 실제 경로로 갱신)

| 지식의 종류 | 원본 위치(예정) | 파생물 | 비고 |
| --- | --- | --- | --- |
| DB 스키마 | `src/db/schema.ts` (Drizzle) | 마이그레이션, TS 타입 | SQL·타입 수기 중복 정의 금지 |
| 앱 상수 | `src/config/constants.ts` | — | `MIN_LIKES_FOR_STAR=5`, `BIG_THEME_COUNT=12`, `GALAXY_SONG_COUNT=30000` |
| 장르→성단 매핑 | 테마 배치 스크립트 내 명시적 상수 | themes 테이블 | 이슈 #3 |
| 곡 좌표 | `songs.pos_x/y/z` (배치가 1회 기록) | 렌더러 페이로드 | 기록 후 불변 |
| 유저 취향 원본 | `likes` 테이블 | `user_stars`(파생 캐시) | 무효화: 좋아요 변경 시 즉시 재계산 |
| 환경변수 | `.env` → 단일 config 모듈 | — | `process.env` 직접 접근 금지 |
