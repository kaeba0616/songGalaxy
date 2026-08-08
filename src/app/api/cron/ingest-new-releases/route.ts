import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { runNewReleaseIngest } from "@/server/new-releases";

export const dynamic = "force-dynamic";
/** 서버리스 실행 상한 (초). 파이프라인은 deadline으로 이 안에서 안전 종료한다 */
export const maxDuration = 300;

/**
 * GET /api/cron/ingest-new-releases — 주간 신곡 적재 (Vercel Cron이 호출)
 * vercel.json crons 설정으로 매주 월요일 03:00 UTC에 실행된다.
 * CRON_SECRET이 설정되어 있으면 Vercel이 보내는 Bearer 토큰을 검증한다.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const secret = env.cronSecret;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const stats = await runNewReleaseIngest({
    days: 7,
    limit: 60,
    deadlineMs: 260_000, // maxDuration(300s)보다 여유 있게
  });
  console.log("[cron] new-release ingest:", JSON.stringify(stats));
  return NextResponse.json(stats);
}
