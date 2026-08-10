import { NextResponse } from "next/server";
import { ENRICH_BATCH } from "@/config/constants";
import { enrichSongs } from "@/server/enrich";

export const dynamic = "force-dynamic";

/** 한 번에 보강할 최대 곡 수 — iTunes 비공식 레이트리밋(분당 ~20회) 보호 */
const MAX_IDS = ENRICH_BATCH;

/**
 * POST /api/enrich { ids: number[] }
 * 곡의 앨범아트/30초 미리듣기를 iTunes Search API에서 찾아 DB에 캐시하고 반환한다.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((v): v is number => Number.isInteger(v)).slice(0, MAX_IDS)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids 배열이 필요합니다" }, { status: 400 });
  }
  return NextResponse.json(await enrichSongs(ids));
}
