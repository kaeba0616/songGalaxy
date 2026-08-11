import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateShareSlug } from "@/lib/share-slug";

/** 목록 한 줄 요약 — 곡 개수는 저장하지 않고 매번 센다 (SSOT) */
export interface PlaylistSummary {
  id: number;
  name: string;
  shareSlug: string | null;
  songCount: number;
  updatedAt: string;
}

export const NAME_MAX = 40;

/** 이름 정리 — 앞뒤 공백 제거, 길이 제한. 빈 이름은 거부한다 */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, NAME_MAX);
  return name.length > 0 ? name : null;
}

export async function listMyPlaylists(userId: number): Promise<PlaylistSummary[]> {
  const rows = await db
    .select({
      id: schema.playlists.id,
      name: schema.playlists.name,
      shareSlug: schema.playlists.shareSlug,
      updatedAt: schema.playlists.updatedAt,
      songCount: sql<number>`(
        select count(*)::int from playlist_songs ps where ps.playlist_id = ${schema.playlists.id}
      )`,
    })
    .from(schema.playlists)
    .where(eq(schema.playlists.userId, userId))
    .orderBy(desc(schema.playlists.updatedAt));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function createPlaylist(userId: number, name: string): Promise<PlaylistSummary> {
  const [row] = await db
    .insert(schema.playlists)
    .values({ userId, name })
    .returning({
      id: schema.playlists.id,
      name: schema.playlists.name,
      shareSlug: schema.playlists.shareSlug,
      updatedAt: schema.playlists.updatedAt,
    });
  return { ...row, songCount: 0, updatedAt: row.updatedAt.toISOString() };
}

export async function renamePlaylist(userId: number, id: number, name: string): Promise<boolean> {
  const r = await db
    .update(schema.playlists)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
    .returning({ id: schema.playlists.id });
  return r.length > 0;
}

/**
 * 공유 켜기/끄기. 켜면 slug를 만들고, 끄면 NULL로 되돌린다 —
 * 끄는 순간 기존 링크는 죽는다(의도된 동작).
 * slug 충돌은 unique 제약이 막으므로 몇 번 다시 시도한다.
 */
export async function setPlaylistShared(
  userId: number,
  id: number,
  shared: boolean,
): Promise<string | null> {
  if (!shared) {
    await db
      .update(schema.playlists)
      .set({ shareSlug: null, updatedAt: new Date() })
      .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)));
    return null;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateShareSlug();
    try {
      const r = await db
        .update(schema.playlists)
        .set({ shareSlug: slug, updatedAt: new Date() })
        .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
        .returning({ shareSlug: schema.playlists.shareSlug });
      if (r.length === 0) return null; // 내 목록이 아님
      return r[0].shareSlug;
    } catch {
      // unique 충돌 — 다른 slug로 다시
    }
  }
  throw new Error("공유 링크를 만들지 못했습니다");
}

export async function deletePlaylist(userId: number, id: number): Promise<boolean> {
  const r = await db
    .delete(schema.playlists)
    .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
    .returning({ id: schema.playlists.id });
  if (r.length === 0) return false;
  // 목록이 사라지면 담긴 곡 행도 의미가 없다 (FK 제약을 두지 않았으므로 직접 지운다)
  await db.delete(schema.playlistSongs).where(eq(schema.playlistSongs.playlistId, id));
  return true;
}
