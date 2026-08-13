import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { GENRE_CLUSTERS } from "@/config/genre-clusters";
import { listPlanetDecor } from "@/server/planet-decor";

export const dynamic = "force-dynamic";

const CLUSTER_META = new Map(GENRE_CLUSTERS.map((c) => [c.slug, { label: c.label, color: c.color }]));

/**
 * GET /api/users/[id]/likes — 그 유저의 좋아요 곡 id 전체(최근 순)와
 * 행성 정보 패널용 요약(성단 분포 상위 3, 마지막 좋아요 시각). 기본 공개(D15).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "잘못된 사용자 id" }, { status: 400 });
  }
  const sub = alias(schema.themes, "sub");
  const big = alias(schema.themes, "big");
  const [rows, clusterRows, [owner], decor] = await Promise.all([
    db
      // 곡 메타까지 내린다 — 은하 페이로드는 페이지 로드 때 한 번만 받아서,
      // 그 뒤 편입된 곡을 좋아요하면 클라이언트 페이로드에 없다. 행성이 이걸로
      // 빠진 곡을 페이로드에 채워 넣어야 밤하늘에서 곡이 사라지지 않는다
      .select({
        songId: schema.likes.songId,
        at: schema.likes.createdAt,
        title: schema.songs.title,
        artist: schema.songs.artist,
        x: schema.songs.posX,
        y: schema.songs.posY,
        z: schema.songs.posZ,
        popularity: schema.songs.popularity,
        themeId: schema.songs.themeId,
      })
      .from(schema.likes)
      .innerJoin(schema.songs, eq(schema.likes.songId, schema.songs.id))
      .where(eq(schema.likes.userId, userId))
      .orderBy(desc(schema.likes.createdAt)),
    db
      .select({ cluster: big.name, n: sql<number>`count(*)::int` })
      .from(schema.likes)
      .innerJoin(schema.songs, eq(schema.likes.songId, schema.songs.id))
      .innerJoin(sub, eq(sub.id, schema.songs.themeId))
      .innerJoin(big, eq(big.id, sub.parentId))
      .where(eq(schema.likes.userId, userId))
      .groupBy(big.name)
      .orderBy(sql`count(*) desc`)
      .limit(3),
    db
      .select({ bio: schema.users.bio, pinnedSongId: schema.users.pinnedSongId })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
    listPlanetDecor(userId),
  ]);
  return NextResponse.json(
    {
      songIds: rows.map((r) => r.songId),
      songs: rows.map((r) => ({
        id: r.songId,
        title: r.title,
        artist: r.artist,
        x: r.x,
        y: r.y,
        z: r.z,
        popularity: r.popularity,
        themeId: r.themeId,
      })),
      likesCount: rows.length,
      lastLikedAt: rows[0]?.at ?? null,
      bio: owner?.bio ?? null,
      pinnedSongId: owner?.pinnedSongId ?? null,
      // 방문자에게도 주인이 꾸민 대로 보인다 (테마와 같은 방침)
      decor,
      clusters: clusterRows.map((c) => ({
        slug: c.cluster,
        label: CLUSTER_META.get(c.cluster)?.label ?? c.cluster,
        color: CLUSTER_META.get(c.cluster)?.color ?? "#ffffff",
        n: c.n,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
