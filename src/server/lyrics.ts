import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export interface Lyrics {
  plain: string | null;
  synced: string | null;
}

/**
 * 곡 가사 조회 — 원본은 LRCLIB API, songs 테이블에 캐시 (docs/SSOT.md).
 * LRCLIB 권장사항 준수: User-Agent 명시, 곡당 1회만 조회 (lyricsCheckedAt).
 */
export async function getLyrics(songId: number): Promise<Lyrics> {
  const [song] = await db
    .select({
      title: schema.songs.title,
      artist: schema.songs.artist,
      album: schema.songs.album,
      durationMs: schema.songs.durationMs,
      plainLyrics: schema.songs.plainLyrics,
      syncedLyrics: schema.songs.syncedLyrics,
      lyricsCheckedAt: schema.songs.lyricsCheckedAt,
    })
    .from(schema.songs)
    .where(eq(schema.songs.id, songId));
  if (!song) return { plain: null, synced: null };
  if (song.lyricsCheckedAt) {
    return { plain: song.plainLyrics, synced: song.syncedLyrics };
  }

  let plain: string | null = null;
  let synced: string | null = null;
  try {
    const params = new URLSearchParams({
      track_name: song.title,
      artist_name: song.artist,
    });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { "User-Agent": "songGalaxy/0.1 (https://github.com/kaeba0616/songGalaxy)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // 레이트리밋 등 일시 오류 — 캐시하지 않고 반환해 다음에 재시도
      return { plain: null, synced: null };
    }
    const results = (await res.json()) as {
      trackName: string;
      artistName: string;
      plainLyrics: string | null;
      syncedLyrics: string | null;
      instrumental: boolean;
    }[];
    // 제목·아티스트가 대체로 일치하는 첫 결과 사용 (싱크 가사 우선)
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const match = results.find(
      (r) =>
        norm(r.trackName).includes(norm(song.title).slice(0, 12)) &&
        (norm(r.artistName).includes(norm(song.artist)) || norm(song.artist).includes(norm(r.artistName))),
    );
    if (match && !match.instrumental) {
      plain = match.plainLyrics ?? null;
      synced = match.syncedLyrics ?? null;
    }
  } catch {
    return { plain: null, synced: null };
  }

  await db
    .update(schema.songs)
    .set({ plainLyrics: plain, syncedLyrics: synced, lyricsCheckedAt: new Date() })
    .where(eq(schema.songs.id, songId));
  return { plain, synced };
}
