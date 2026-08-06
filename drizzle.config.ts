import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // 스크립트 실행 시점에만 필요하므로 env 모듈 대신 직접 읽되, 이 파일 외 직접 접근 금지 (docs/SSOT.md)
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/songgalaxy",
  },
});
