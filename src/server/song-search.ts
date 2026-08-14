/**
 * 곡 검색의 매칭 규칙 — SSOT (docs/SSOT.md).
 *
 * 은하 하단 검색창과 곡 목록 페이지가 **같은 규칙**을 써야 한다. 두 벌이면
 * "여기서는 나오는데 저기서는 안 나오는" 검색이 된다 — 실제로 iTunes(외부)와
 * DB 검색이 갈라져 "Humpback"으로 밴드 "Hump Back"을 못 찾던 일이 있었다.
 * 그래서 공백을 무시하는 부분 일치가 규칙이다: 질의도 컬럼도 공백을 뗀 뒤 비교한다.
 */
import { desc, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";

/** 검색어 정규화 — 소문자 + 공백 제거. 매칭·순위 비교 모두 이 값 기준 */
export function normalizeSearch(q: string): string {
  return q.toLowerCase().replace(/\s+/g, "");
}

/** 공백 무시 부분 일치 조건 */
export function spacelessLike(col: AnyPgColumn, norm: string): SQL {
  return sql`replace(lower(${col}), ' ', '') LIKE ${"%" + norm + "%"}`;
}

/** 공백 제거한 컬럼식 — 정확/접두 순위 비교용 */
export function spacelessCol(col: AnyPgColumn): SQL {
  return sql`replace(lower(${col}), ' ', '')`;
}

export interface QuickSearchSong {
  id: number;
  title: string;
  artist: string;
  popularity: number;
  artworkUrl: string | null;
}

/**
 * 빠른 검색 — 제목+가수 대상, 정확 일치 > 접두 일치 > 인기순.
 * 은하 하단 검색창이 쓴다 (필터·페이지네이션이 필요한 깊은 탐색은 곡 목록 페이지).
 */
export async function quickSearchSongs(q: string, limit = 30): Promise<QuickSearchSong[]> {
  const norm = normalizeSearch(q);
  if (!norm) return [];
  const nt = spacelessCol(schema.songs.title);
  const na = spacelessCol(schema.songs.artist);
  const prefix = `${norm}%`;
  return db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.songs.artist,
      popularity: schema.songs.popularity,
      artworkUrl: schema.songs.artworkUrl,
    })
    .from(schema.songs)
    .where(or(spacelessLike(schema.songs.title, norm), spacelessLike(schema.songs.artist, norm)))
    .orderBy(
      sql`(${nt} = ${norm} OR ${na} = ${norm}) DESC`,
      sql`(${nt} LIKE ${prefix} OR ${na} LIKE ${prefix}) DESC`,
      desc(schema.songs.popularity),
    )
    .limit(limit);
}
