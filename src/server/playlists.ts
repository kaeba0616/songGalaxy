import { and, desc, eq, isNull, sql, TransactionRollbackError, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { YOUTUBE_LOOKUP_RETRY_MAX } from "@/config/constants";
import { generateShareSlug } from "@/lib/share-slug";
import { nextPosition } from "@/player/engine";
import { sameMembers } from "@/lib/reorder";
import { getYoutubeVideoId } from "@/server/youtube";

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
 * 목록 삭제 + 담긴 곡 행 정리를 한 트랜잭션으로 묶는다.
 * 이제 playlist_songs.playlist_id에 ON DELETE CASCADE FK가 있어(스키마 참고) DB가
 * 고아 행을 막아주지만, 이 트랜잭션은 그대로 둔다 — 두 statement 사이에 연결이
 * 끊기면 "목록은 지워졌는데 곡 행만 남는" 반쪽 상태를 여기서도 막아준다(이중 방어).
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

export interface PlaylistTrack {
  id: number;
  title: string;
  artist: string;
  genre: string;
  youtubeVideoId: string | null;
}

export interface PlaylistDetail {
  id: number;
  name: string;
  shareSlug: string | null;
  ownerId: number;
  songs: PlaylistTrack[];
}

/** 내 목록인지 확인 */
async function ownsPlaylist(userId: number, playlistId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.playlists.id })
    .from(schema.playlists)
    .where(and(eq(schema.playlists.id, playlistId), eq(schema.playlists.userId, userId)));
  return row != null;
}

/**
 * 이 사용자의 목록 어딘가에 이 곡이 담겨 있는지 — "영상이 안 튼다"는 신고를 받아줄 권한의
 * 근거다. `youtube_video_id`는 공개 `/songs/[id]` 페이지 HTML에 그대로 노출되므로, 로그인만
 * 요구하면 아무 구글 계정이나 곡 id를 순회해 사이트 전체의 캐시를 지울 수 있었다(그리고
 * `youtube_checked_at`은 남아 재검색 경로가 없어 복구가 SQL 수작업뿐이었다). 신고는 실제로
 * 그 곡을 목록에 담아 재생을 시도한 사람만 할 수 있다고 좁힌다 — 목록에 없는 사람이 보낸
 * 신고는 거부되어야 정상이고(다른 사람의 공유 목록을 보는 비소유자는 신고를 못 보내지만,
 * 클라이언트가 어차피 그 자리에서 미리듣기로 넘어가므로 해가 없다).
 */
export async function songInUsersPlaylist(userId: number, songId: number): Promise<boolean> {
  const [row] = await db
    .select({ songId: schema.playlistSongs.songId })
    .from(schema.playlistSongs)
    .innerJoin(schema.playlists, eq(schema.playlists.id, schema.playlistSongs.playlistId))
    .where(and(eq(schema.playlists.userId, userId), eq(schema.playlistSongs.songId, songId)));
  return row != null;
}

/**
 * 목록에 곡을 담는다.
 *
 * 여기가 YouTube 영상 ID를 새로 찾는 두 지점 중 하나다(다른 하나는 아래
 * `retryMissingVideos` — 소유자가 목록을 열 때의 보충 조회). 탐색·재생 경로에서 부르면
 * 하루 100회 검색 쿼터가 순식간에 마른다. getYoutubeVideoId는 이미 캐시를 보므로
 * 이미 찾아둔 곡이면 외부 호출이 나가지 않는다.
 * 조회에 실패해도 담기는 성공시킨다 — 그 곡만 미리듣기로 재생되고,
 * 영상은 다음에 다시 시도된다.
 * 한 사람이 하루 쿼터 전체(100곡)를 말려 다른 모든 사용자의 영상을 끊는 일이 없도록
 * 사용자별 하루 한도를 두는데, 그 판단은 여기가 아니라 `getYoutubeVideoId` 안에 있다 —
 * 검사와 소비가 붙어 있어야 동시 요청이 함께 새지 않는다. 한도를 넘으면 영상만 못 찾고
 * 담기 자체는 그대로 성공한다.
 *
 * "already"·"nosong" 둘 다 insert보다 먼저 반환한다 — 어느 경우든 실제로
 * 새로 담기는 일이 없으므로 아래 getYoutubeVideoId 호출까지 가면 안 된다.
 */
export async function addSongToPlaylist(
  userId: number,
  playlistId: number,
  songId: number,
): Promise<"added" | "already" | "forbidden" | "nosong"> {
  if (!(await ownsPlaylist(userId, playlistId))) return "forbidden";

  const existing = await db
    .select({ songId: schema.playlistSongs.songId, position: schema.playlistSongs.position })
    .from(schema.playlistSongs)
    .where(eq(schema.playlistSongs.playlistId, playlistId));
  if (existing.some((e) => e.songId === songId)) return "already";

  // playlist_songs.song_id에 ON DELETE CASCADE FK가 생겨(스키마 참고) 존재하지 않는
  // songId로 insert하면 이제 DB가 제약 위반으로 거부한다. 그래도 여기서 미리 확인하는
  // 이유는 그 거부를 500으로 흘려보내지 않고 깔끔한 "nosong" 400으로 답하기 위해서다.
  const [song] = await db
    .select({ id: schema.songs.id })
    .from(schema.songs)
    .where(eq(schema.songs.id, songId));
  if (!song) return "nosong";

  // existing 조회와 insert 사이에 같은 곡이 두 번(더블탭 등) 거의 동시에 들어오면
  // 둘 다 위의 already 검사를 통과할 수 있다 — onConflictDoNothing으로 나중 것을
  // 조용히 무시하고, 실제로 삽입됐는지(returning)로 결과를 가른다.
  const inserted = await db
    .insert(schema.playlistSongs)
    .values({
      playlistId,
      songId,
      position: nextPosition(existing.map((e) => e.position)),
    })
    .onConflictDoNothing({ target: [schema.playlistSongs.playlistId, schema.playlistSongs.songId] })
    .returning({ songId: schema.playlistSongs.songId });
  if (inserted.length === 0) return "already"; // 경쟁에서 진 요청 — 사용자에게는 순차 중복과 같은 결과

  await db
    .update(schema.playlists)
    .set({ updatedAt: new Date() })
    .where(eq(schema.playlists.id, playlistId));

  await getYoutubeVideoId(songId, userId).catch(() => null);
  return "added";
}

/**
 * 아직 한 번도 영상을 찾아보지 못한 곡을 몇 개만 다시 조회한다. 찾은 개수를 돌려준다.
 *
 * 담을 때 하루 쿼터가 이미 말라 있었으면 `getYoutubeVideoId`가 `youtube_checked_at`을
 * 남기지 않는다(다음 날 재시도하라는 뜻). 그런데 그 뒤로 아무도 그 곡을 다시 조회하지
 * 않으므로 목록의 곡이 영원히 미리듣기에 갇힌다. 그래서 **소유자가 자기 목록 상세를 열 때만**
 * 보충 조회를 건다 — 공개 열람(`/list/[slug]`)에는 절대 걸지 않는다(크롤러가 쿼터를 태운다).
 * 한 번의 열람당 최대 `YOUTUBE_LOOKUP_RETRY_MAX`곡, 사용자별 하루 한도 안에서만.
 */
export async function retryMissingVideos(userId: number, playlistId: number): Promise<number> {
  if (!(await ownsPlaylist(userId, playlistId))) return 0;
  // 후보를 먼저 본다 — 아무것도 없으면 한도 조회조차 하지 않는다(대부분의 열람이 이 경우)
  const candidates = await db
    .select({ id: schema.songs.id })
    .from(schema.playlistSongs)
    .innerJoin(schema.songs, eq(schema.songs.id, schema.playlistSongs.songId))
    .where(
      and(
        eq(schema.playlistSongs.playlistId, playlistId),
        isNull(schema.songs.youtubeCheckedAt),
      ),
    )
    .orderBy(schema.playlistSongs.position)
    .limit(YOUTUBE_LOOKUP_RETRY_MAX);
  if (candidates.length === 0) return 0;

  // 한도 확인은 getYoutubeVideoId 안에서 곡마다 원자적으로 이뤄진다 —
  // 여기서 한 번 미리 보면 세 건이 같은 잔량을 읽고 전부 통과한다
  const found = await Promise.all(
    candidates.map((c) => getYoutubeVideoId(c.id, userId).catch(() => null)),
  );
  return found.filter(Boolean).length;
}

export async function removeSongFromPlaylist(
  userId: number,
  playlistId: number,
  songId: number,
): Promise<boolean> {
  if (!(await ownsPlaylist(userId, playlistId))) return false;
  await db
    .delete(schema.playlistSongs)
    .where(
      and(
        eq(schema.playlistSongs.playlistId, playlistId),
        eq(schema.playlistSongs.songId, songId),
      ),
    );
  await db
    .update(schema.playlists)
    .set({ updatedAt: new Date() })
    .where(eq(schema.playlists.id, playlistId));
  return true;
}

export type ReorderResult = "ok" | "forbidden" | "mismatch";

/**
 * 목록의 재생 순서를 통째로 다시 쓴다.
 *
 * 부분 이동(`{songId, toIndex}`)이 아니라 **전체 순서 배열**을 받는 이유:
 * 멱등적이고, 다른 탭에서 곡이 추가·삭제돼 클라이언트가 낡았을 때 조용히
 * 어긋나는 대신 집합 비교로 잡아 "mismatch"를 돌려줄 수 있다.
 *
 * position을 0..n-1로 다시 써도 `nextPosition`(최대값+1)의 전제는 유지된다.
 */
export async function reorderPlaylistSongs(
  userId: number,
  playlistId: number,
  songIds: number[],
): Promise<ReorderResult> {
  if (!(await ownsPlaylist(userId, playlistId))) return "forbidden";

  try {
    // 확인(SELECT)과 재기록(UPDATE)을 한 트랜잭션 안에서 한다 — 따로 두면 확인 직후
    // 다른 탭이 곡을 담거나 빼는 순간이 그 틈으로 끼어들 수 있고, 중간에 끊기면
    // 순서가 섞인 채 남는다. (playlist_id, song_id)가 기본키라 곡마다 한 행씩
    // 확실히 짚힌다
    await db.transaction(async (tx) => {
      const current = await tx
        .select({ songId: schema.playlistSongs.songId })
        .from(schema.playlistSongs)
        .where(eq(schema.playlistSongs.playlistId, playlistId));
      if (!sameMembers(current.map((c) => c.songId), songIds)) {
        // 쓸 게 없다 — 롤백하고 아래 catch에서 mismatch로 바꿔 돌려준다
        tx.rollback();
      }

      for (const [i, songId] of songIds.entries()) {
        await tx
          .update(schema.playlistSongs)
          .set({ position: i })
          .where(
            and(
              eq(schema.playlistSongs.playlistId, playlistId),
              eq(schema.playlistSongs.songId, songId),
            ),
          );
      }
      await tx
        .update(schema.playlists)
        .set({ updatedAt: new Date() })
        .where(eq(schema.playlists.id, playlistId));
    });
    return "ok";
  } catch (e) {
    if (e instanceof TransactionRollbackError) return "mismatch";
    throw e;
  }
}

/** 목록 + 담긴 곡 (position 순). 열람 권한 판단은 호출부가 한다 */
async function loadDetail(where: SQL): Promise<PlaylistDetail | null> {
  const [pl] = await db
    .select({
      id: schema.playlists.id,
      name: schema.playlists.name,
      shareSlug: schema.playlists.shareSlug,
      ownerId: schema.playlists.userId,
    })
    .from(schema.playlists)
    .where(where);
  if (!pl) return null;

  const songs = await db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.songs.artist,
      genre: schema.songs.genre,
      youtubeVideoId: schema.songs.youtubeVideoId,
    })
    .from(schema.playlistSongs)
    .innerJoin(schema.songs, eq(schema.songs.id, schema.playlistSongs.songId))
    .where(eq(schema.playlistSongs.playlistId, pl.id))
    .orderBy(schema.playlistSongs.position);

  return { ...pl, songs };
}

export function getPlaylistById(id: number): Promise<PlaylistDetail | null> {
  return loadDetail(eq(schema.playlists.id, id));
}

export function getPlaylistBySlug(slug: string): Promise<PlaylistDetail | null> {
  return loadDetail(eq(schema.playlists.shareSlug, slug));
}
