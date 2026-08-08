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
| 배포·운영 환경 | Vercel 프로젝트 `song-galaxy` (https://song-galaxy.vercel.app) | — | 프로덕션 DB = Neon(Marketplace, env 자동 주입). 로컬 dev DB = Docker 5433 (.env). 환경별 DATABASE_URL로 분리 |
| DB 스키마 | `src/db/schema.ts` (Drizzle) | 마이그레이션(`drizzle-kit push`), TS 타입(`$inferSelect`) | SQL·타입 수기 중복 정의 금지 |
| 앱 상수 | `src/config/constants.ts` | — | `MIN_LIKES_FOR_STAR=5`, `BIG_THEME_COUNT=12`, `GALAXY_SONG_COUNT=30000` 등 |
| 환경변수 접근 | `.env` → `src/config/env.ts` | — | `process.env` 직접 접근 금지 (예외: `drizzle.config.ts`, 파일 내 주석 참조) |
| 유저 취향 원본 | `likes` 테이블 | `user_stars`(파생 캐시) | 무효화: 좋아요 변경 시 즉시 재계산 |
| 곡 데이터 원천(기본) | HuggingFace `maharshipandya/spotify-tracks-dataset` → `scripts/ingest-dataset.ts` | `songs` 테이블 (3만 곡, source=`spotify-tracks-114k`) | 멱등: `(source, source_id)` 유니크. 2022-10 스냅샷 |
| 곡 데이터 원천(즉석 편입) | 외부 iTunes Search API → `src/server/import-song.ts` | `songs` 테이블 (source=`itunes`, batch=`user-import`) | /songs 검색에서 유저 트리거. iTunes 장르 매핑: `genre-clusters.ts`의 `ITUNES_GENRE_TO_GENRE` |
| 곡 데이터 원천(주간 신곡) | 외부 MusicBrainz API → `src/server/new-releases.ts` | `songs` 테이블 (source=`musicbrainz`, batch=`mb-weekly-<날짜>`) | 최근 7일 공식 싱글 + 장르 태그 필수 + 상한. 롤백=배치 삭제. CLI(`npm run ingest:new`)와 Cron(`/api/cron/ingest-new-releases`, vercel.json, 매주 월 03:00 UTC, CRON_SECRET 보호)이 공용 |
| 태그 기반 좌표 배치 | `src/server/place-song.ts` | 즉석 편입·주간 신곡이 공용 | 세부 테마 구역 내 시드 랜덤 + 성단/은하 경계 클램프 |
| 좌표 수학 유틸 | `src/lib/layout-math.ts` | 배치 스크립트·즉석 편입이 공용 | scripts/lib에서 이동 |
| 장르→성단 매핑 | `src/config/genre-clusters.ts` | `themes` 테이블 (`scripts/build-themes.ts`가 생성) | 성단 12개·색상 포함. 매핑 변경은 신규 곡에만 적용 |
| 행성 테마 팔레트 | `src/config/planet-themes.ts` | `users.planet_theme`(slug 저장), 밤하늘 렌더링 | 꾸미기 맛보기(이슈 #10). 테마 추가는 여기서만 |
| 앨범아트·미리듣기 | 외부 iTunes Search API | `songs.artwork_url/preview_url` (파생 캐시, `/api/enrich`) | `enriched_at`으로 조회 여부 기록. 실패 시 캐시 안 함 |
| 가수 정보 | 외부 MusicBrainz API (CC0) | `artists` 테이블 (파생 캐시, `src/server/artist-info.ts`) | 이름당 1회 조회. 검색 점수 85 미만은 버림(오매칭 방지) |
| 가사 | 외부 LRCLIB API | `songs.plain_lyrics/synced_lyrics` (파생 캐시, `src/server/lyrics.ts`) | 곡당 1회 조회. 출처 표기 필수 |
| YouTube 영상 ID | 외부 YouTube Data API | `songs.youtube_video_id` (파생 캐시, `src/server/youtube.ts`) | 곡당 1회 검색(쿼터 100곡/일). 키 없으면 검색 링크 폴백 |
| 곡 좌표 | `songs.pos_x/y/z` (`scripts/layout-songs.ts`가 1회 기록) | 렌더러 페이로드 | 기록 후 불변. NULL인 곡만 채움. 배치 수학: `scripts/lib/layout-math.ts` |
