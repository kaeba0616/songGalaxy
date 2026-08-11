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

/**
 * 소유 확인 + 현재 공유 slug 조회 — PATCH가 이름/공유 변경 전에 딱 한 번 소유권을
 * 검사하고, 그 결과(현재 shareSlug)를 두 분기(이름만 옴 / shared만 옴)에서
 * 그대로 재사용하기 위함. null이면 내 목록이 아니거나 존재하지 않음.
 */
export async function findMyPlaylist(
  userId: number,
  id: number,
): Promise<{ shareSlug: string | null } | null> {
  const [row] = await db
    .select({ shareSlug: schema.playlists.shareSlug })
    .from(schema.playlists)
    .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)));
  return row ?? null;
}

export async function renamePlaylist(userId: number, id: number, name: string): Promise<boolean> {
  const r = await db
    .update(schema.playlists)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
    .returning({ id: schema.playlists.id });
  return r.length > 0;
}

/** setPlaylistShared 결과 — "내 목록이 아님"과 "공유 껐음"을 구분해야 호출부가 403과 200을 가를 수 있다 */
export type SetPlaylistSharedResult = { ok: false } | { ok: true; shareSlug: string | null };

/**
 * 공유 켜기/끄기. 켜면 slug를 만들고, 끄면 NULL로 되돌린다 —
 * 끄는 순간 기존 링크는 죽는다(의도된 동작).
 * slug 충돌은 unique 제약이 막으므로 몇 번 다시 시도한다.
 *
 * 반환값은 { ok: false }(내 목록이 아님) vs { ok: true, shareSlug }(성공, 끈 경우 null)로
 * 구분한다 — 예전엔 둘 다 null을 반환해 호출부(PATCH)가 실패를 성공으로 보고했었다.
 */
export async function setPlaylistShared(
  userId: number,
  id: number,
  shared: boolean,
): Promise<SetPlaylistSharedResult> {
  if (!shared) {
    const r = await db
      .update(schema.playlists)
      .set({ shareSlug: null, updatedAt: new Date() })
      .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
      .returning({ id: schema.playlists.id });
    if (r.length === 0) return { ok: false }; // 내 목록이 아님
    return { ok: true, shareSlug: null };
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateShareSlug();
    try {
      const r = await db
        .update(schema.playlists)
        .set({ shareSlug: slug, updatedAt: new Date() })
        .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
        .returning({ shareSlug: schema.playlists.shareSlug });
      if (r.length === 0) return { ok: false }; // 내 목록이 아님
      return { ok: true, shareSlug: r[0].shareSlug };
    } catch {
      // unique 충돌 — 다른 slug로 다시
    }
  }
  throw new Error("공유 링크를 만들지 못했습니다");
}

/**
 * 목록 삭제 + 담긴 곡 행 정리를 한 트랜잭션으로 묶는다 —
 * FK 제약이 없어(스키마 참고) 두 statement를 따로 실행하면 연결이 중간에 끊길 때
 * playlist_songs에 죽은 playlist_id를 가리키는 고아 행이 남을 수 있다.
 */
export async function deletePlaylist(userId: number, id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const r = await tx
      .delete(schema.playlists)
      .where(and(eq(schema.playlists.id, id), eq(schema.playlists.userId, userId)))
      .returning({ id: schema.playlists.id });
    if (r.length === 0) return false;
    await tx.delete(schema.playlistSongs).where(eq(schema.playlistSongs.playlistId, id));
    return true;
  });
}
