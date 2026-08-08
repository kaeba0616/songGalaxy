/**
 * DB 스키마 — SSOT (docs/SSOT.md 참조)
 * 테이블 구조의 유일한 원본. 타입은 여기서 추론하고, 마이그레이션은 drizzle-kit으로 생성한다.
 */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** 테마 계층: level 1 = 큰 테마(성단), level 2 = 세부 테마 */
export const themes = pgTable("themes", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  level: integer("level").notNull(), // 1 | 2
  posX: real("pos_x"),
  posY: real("pos_y"),
  posZ: real("pos_z"),
  radius: real("radius"),
  color: text("color"),
});

/** 곡. 좌표는 레이아웃 배치(이슈 #3)가 1회 기록하며 이후 불변 */
export const songs = pgTable(
  "songs",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    album: text("album"),
    releaseYear: integer("release_year"),
    source: text("source").notNull(), // 'spotify-tracks-114k' | 'musicbrainz'
    sourceId: text("source_id").notNull(),
    genre: text("genre").notNull(), // 원본 장르 라벨 (세부 테마 배정 재료)
    themeId: integer("theme_id"),
    posX: real("pos_x"),
    posY: real("pos_y"),
    posZ: real("pos_z"),
    /** 오디오 특징 (danceability, energy, valence 등). 신곡(musicbrainz)은 null */
    features: jsonb("features").$type<Record<string, number> | null>(),
    popularity: integer("popularity").notNull().default(0),
    explicit: boolean("explicit").notNull().default(false),
    durationMs: integer("duration_ms"),
    /** 적재 배치 식별자. 신곡 파이프라인 롤백용 (이슈 #7) */
    batchId: text("batch_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * 미디어 보강 캐시 — 원본은 iTunes Search API (docs/SSOT.md).
     * enrichedAt이 있으면 조회를 시도한 것 (결과가 없어도 재조회하지 않기 위함).
     * 좌표 불변 원칙과 무관한 부가 메타데이터라 사후 갱신 허용.
     */
    artworkUrl: text("artwork_url"),
    previewUrl: text("preview_url"),
    enrichedAt: timestamp("enriched_at"),
    /** 가사 캐시 — 원본은 LRCLIB API (docs/SSOT.md). checked로 재조회 방지 */
    plainLyrics: text("plain_lyrics"),
    syncedLyrics: text("synced_lyrics"),
    lyricsCheckedAt: timestamp("lyrics_checked_at"),
    /** YouTube 영상 캐시 — 원본은 YouTube Data API (쿼터 보호: 곡당 1회 검색) */
    youtubeVideoId: text("youtube_video_id"),
    youtubeCheckedAt: timestamp("youtube_checked_at"),
  },
  (table) => [uniqueIndex("songs_source_unique").on(table.source, table.sourceId)],
);

/** 가수 정보 캐시 — 원본은 MusicBrainz API (CC0). name 기준 1회 조회 후 재사용 */
export const artists = pgTable("artists", {
  name: text("name").primaryKey(),
  type: text("type"),
  country: text("country"),
  beginYear: text("begin_year"),
  tags: jsonb("tags").$type<string[] | null>(),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  nickname: text("nickname").notNull(),
  /** 행성 테마 slug — 원본 팔레트는 src/config/planet-themes.ts (SSOT) */
  planetTheme: text("planet_theme"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 유저 취향의 원본. user_stars는 여기서 파생된다 */
export const likes = pgTable(
  "likes",
  {
    userId: integer("user_id").notNull(),
    songId: integer("song_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.songId] })],
);

/**
 * 파생 캐시 — 원본은 likes (SSOT).
 * 무효화 규칙: 좋아요 추가/삭제 트랜잭션 안에서 즉시 재계산한다 (D6).
 */
export const userStars = pgTable("user_stars", {
  userId: integer("user_id").primaryKey(),
  posX: real("pos_x").notNull(),
  posY: real("pos_y").notNull(),
  posZ: real("pos_z").notNull(),
  likesCount: integer("likes_count").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Theme = typeof themes.$inferSelect;
export type Song = typeof songs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Like = typeof likes.$inferSelect;
export type UserStar = typeof userStars.$inferSelect;
