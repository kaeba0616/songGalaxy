# songGalaxy 🌌

음악을 은하계로 시각화하는 웹사이트. 수만 곡이 성운처럼 깔린 3D 은하에서, 사람들은 좋아요한 곡들의 중심에 크고 밝은 별로 찍힌다.

**Live: https://song-galaxy.vercel.app**

- 스펙·확정 결정·v1 구현 결과: [에픽 이슈 #1](https://github.com/kaeba0616/songGalaxy/issues/1) (SSOT)
- 진실의 원본 위치: [docs/SSOT.md](docs/SSOT.md)
- 커밋 메시지의 `[Prompts]` 섹션에 이 프로젝트를 만든 실제 프롬프트가 기록되어 있다

## 기능 (v1)

**은하 탐색**
- 30,000+곡이 12개 성단(장르 그룹)으로 뭉친 구형 3D 은하 — 성운 글로우, 배경 별 반짝임
- 3단계 탐색: 멀리서 성단 이름표 → 다가가면 세부 장르 → 진입하면 곡 제목 (좌표는 불변, 카메라만 이동)
- 성단/장르 라벨 클릭 드릴다운 + 하단 인기곡 카드 캐러셀, 미니맵, 커서 방향 줌

**듣기**
- 카드 ▶ 30초 미리듣기 — 곡이 끝나면 다음 곡 자동 재생 (장르 라디오)
- 곡 상세: YouTube 영상, 가사 전문(LRCLIB), 가수 정보(MusicBrainz), 앨범아트

**내 별 (은하 주민)**
- Google 로그인 후 좋아요 5곡 → 취향 중심점에 금빛 별 탄생 🌟
- 좋아요할 때마다 별이 새 취향 중심으로 부드럽게 이동, "✦ 내 별" 버튼으로 포커싱
- `/me`: 좋아요 목록·성단 분포·별 상태

**자라는 은하**
- 검색해서 없는 곡(신인 포함)은 iTunes에서 찾아 "은하에 추가" → 그 자리에서 새 별로 편입
- 매주 월요일 MusicBrainz 신곡 자동 유입 (Vercel Cron)

## 개발 시작

```bash
npm install
npm run db:up      # 로컬 Postgres (docker, 포트 5433)
npm run db:push    # 스키마 반영
npm run ingest     # 곡 3만 곡 적재 (HuggingFace 데이터셋 다운로드 포함)
npm run dev
```

환경변수는 `.env.example`을 `.env`로 복사해 채운다. 코드에서는 `src/config/env.ts`를 통해서만 접근한다.

## 스택

Next.js (App Router) · Three.js · Postgres + Drizzle · Auth.js (Google) · Vercel
