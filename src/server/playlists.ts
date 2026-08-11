import { and, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  YOUTUBE_LOOKUPS_PER_USER_PER_DAY,
  YOUTUBE_LOOKUP_RETRY_MAX,
} from "@/config/constants";
import { generateShareSlug } from "@/lib/share-slug";
import { nextPosition } from "@/player/engine";
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
 * 이 사용자가 직전 24시간에 태운 영상 검색 횟수(근사).
 *
 * 별도 집계 테이블을 두지 않는다 — 검색이 일어나면 `songs.youtube_checked_at`이 찍히므로
 * "내 목록에 든 곡 중 최근 24시간 안에 조회된 곡 수"로 셀 수 있다
 * (SSOT: 계산할 수 있는 값은 저장하지 않는다).
 * 남이 먼저 조회해 준 곡까지 내 몫으로 세는 과대평가가 있지만, 한도의 목적이
 * "한 사람이 전체 쿼터를 말리지 못하게"이므로 과대평가는 안전한 방향이다.
 */
async function lookupsSpentToday(userId: number): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${schema.playlistSongs.songId})::int` })
    .from(schema.playlistSongs)
    .innerJoin(schema.playlists, eq(schema.playlists.id, schema.playlistSongs.playlistId))
    .innerJoin(schema.songs, eq(schema.songs.id, schema.playlistSongs.songId))
    .where(
      and(eq(schema.playlists.userId, userId), gte(schema.songs.youtubeCheckedAt, since)),
    );
  return row?.n ?? 0;
}

/** 하루 한도가 남았는지 — 넘었으면 검색을 아예 걸지 않는다(담기는 그대로 성공한다) */
async function hasLookupBudget(userId: number): Promise<boolean> {
  return (await lookupsSpentToday(userId)) < YOUTUBE_LOOKUPS_PER_USER_PER_DAY;
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
 * 사용자별 하루 한도를 넘으면 검색을 걸지 않는다 — 담기 자체는 그대로 성공한다.
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

  // playlist_songs.song_id에는 FK가 없다(스키마 참고) — 확인 없이 insert하면
  // 존재하지 않는 songId가 영구히 박혀서 loadDetail의 join에서는 조용히 빠지는데
  // listMyPlaylists의 songCount는 raw 행을 세므로 목록에 안 보이는 곡만큼 개수가
  // 영영 어긋난다. SSOT를 지키려면 같은 songs 테이블을 insert 전에 확인해야 한다.
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

  if (await hasLookupBudget(userId)) {
    await getYoutubeVideoId(songId).catch(() => null);
  }
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
  if (!(await hasLookupBudget(userId))) return 0;

  const found = await Promise.all(
    candidates.map((c) => getYoutubeVideoId(c.id).catch(() => null)),
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
