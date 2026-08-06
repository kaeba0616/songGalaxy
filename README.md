# songGalaxy 🌌

음악을 은하계로 시각화하는 웹사이트. 수만 곡이 성운처럼 깔린 3D 은하에서, 사람들은 좋아요한 곡들의 중심에 크고 밝은 별로 찍힌다.

- 스펙·확정 결정: [에픽 이슈 #1](https://github.com/kaeba0616/songGalaxy/issues/1) (SSOT)
- 진실의 원본 위치: [docs/SSOT.md](docs/SSOT.md)
- 커밋 메시지의 `[Prompts]` 섹션에 이 프로젝트를 만든 실제 프롬프트가 기록되어 있다

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
