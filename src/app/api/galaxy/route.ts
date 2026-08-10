import { NextResponse } from "next/server";
import { isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { GENRE_CLUSTERS } from "@/config/genre-clusters";
import type { GalaxyPayload, GalaxyTheme } from "@/galaxy/types";

export const dynamic = "force-dynamic";

const CLUSTER_LABEL = new Map(GENRE_CLUSTERS.map((c) => [c.slug, c.label]));

export async function GET(): Promise<NextResponse> {
  const [themeRows, songRows] = await Promise.all([
    db.select().from(schema.themes),
    db
      .select({
        id: schema.songs.id,
        title: schema.songs.title,
        artist: schema.songs.artist,
        posX: schema.songs.posX,
        posY: schema.songs.posY,
        posZ: schema.songs.posZ,
        popularity: schema.songs.popularity,
        themeId: schema.songs.themeId,
      })
      .from(schema.songs)
      .where(isNotNull(schema.songs.posX)),
  ]);

  const themes: GalaxyTheme[] = themeRows.map((t) => ({
    id: t.id,
    name: t.name,
    label: t.level === 1 ? (CLUSTER_LABEL.get(t.name) ?? t.name) : t.name,
    level: t.level as 1 | 2,
    parentId: t.parentId,
    x: t.posX ?? 0,
    y: t.posY ?? 0,
    z: t.posZ ?? 0,
    radius: t.radius ?? 0,
    color: t.color ?? "#ffffff",
  }));

  const n = songRows.length;
  const payload: GalaxyPayload = {
    songs: {
      id: new Array(n),
      title: new Array(n),
      artist: new Array(n),
      pos: new Array(n * 3),
      popularity: new Array(n),
      themeId: new Array(n),
    },
    themes,
  };
  /**
   * 좌표를 소수점 한 자리로 줄인다.
   * 은하 반지름이 1000이라 0.1은 별 하나 크기보다 훨씬 작은 차이인데,
   * DB의 float는 "-121.57167"처럼 길게 직렬화돼 페이로드를 크게 부풀린다.
   */
  const round1 = (v: number | null) => Math.round((v ?? 0) * 10) / 10;

  songRows.forEach((s, i) => {
    payload.songs.id[i] = s.id;
    payload.songs.title[i] = s.title;
    payload.songs.artist[i] = s.artist;
    payload.songs.pos[i * 3] = round1(s.posX);
    payload.songs.pos[i * 3 + 1] = round1(s.posY);
    payload.songs.pos[i * 3 + 2] = round1(s.posZ);
    payload.songs.popularity[i] = s.popularity;
    payload.songs.themeId[i] = s.themeId ?? 0;
  });

  return NextResponse.json(payload, {
    headers: {
      // 좌표는 불변이므로 길게 캐시 (신곡 편입 주기 = 주 1회)
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
