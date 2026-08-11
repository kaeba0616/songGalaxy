/**
 * DB 스키마 — SSOT (docs/SSOT.md 참조)
 * 테이블 구조의 유일한 원본. 타입은 여기서 추론하고, 마이그레이션은 drizzle-kit으로 생성한다.
 */
import {
  boolean,
  date,
  index,
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

/**
 * 오디오 특징 조회표 — 원본은 초기 데이터셋 CSV (docs/SSOT.md).
 *
 * 은하에 넣지 않은 곡(인기도 하위 5.9만 곡)의 특징까지 들고 있다.
 * 나중에 편입되는 곡의 특징을 여기서 찾아, 소리가 비슷한 곡 옆에 놓기 위함.
 * songs와 달리 "곡 데이터"가 아니라 배치용 참조표라서 별도 테이블로 둔다.
 */
export const datasetFeatures = pgTable(
  "dataset_features",
  {
    id: serial("id").primaryKey(),
    /** 정규화된 제목 (소문자 + 문자/숫자만) */
    titleKey: text("title_key").notNull(),
    /** 괄호·부제를 뗀 제목 — "Song (feat. X)" 같은 표기 차이를 흡수 */
    baseKey: text("base_key").notNull(),
    /** 정규화된 대표(첫 번째) 가수명 */
    artistKey: text("artist_key").notNull(),
    genre: text("genre").notNull(),
    features: jsonb("features").$type<Record<string, number>>().notNull(),
  },
  (table) => [
    index("dataset_features_title_artist").on(table.titleKey, table.artistKey),
    index("dataset_features_base_artist").on(table.baseKey, table.artistKey),
  ],
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
  /** 행성 프로필 한 줄 소개 — 방문자 정보 패널에 보인다 */
  bio: text("bio"),
  /**
   * 프로필 사진 URL. 첫 로그인 때 Google이 준 사진으로 채우고, 유저가 직접 바꿀 수 있다.
   * 파일을 받아 보관하지 않고 링크만 둔다 — 앨범아트·미리듣기와 같은 방침이다.
   */
  avatarUrl: text("avatar_url"),
  /** 대표곡(좋아요 중 하나) — 행성 라디오가 이 곡부터 시작 */
  pinnedSongId: integer("pinned_song_id"),
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

/** 사용자가 만든 노래 목록. share_slug가 있으면 그 slug를 아는 누구나 열람 가능 */
export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** NULL이면 비공개. 값이 있으면 /list/[slug]로 열람 가능 */
  shareSlug: text("share_slug").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 목록에 담긴 곡. 곡 개수는 여기서 count로 구한다 — 컬럼으로 저장하지 않는다 (SSOT).
 * position은 구멍이 생길 수 있으므로 순서 비교용으로만 쓰고 인덱스로 쓰지 않는다.
 */
export const playlistSongs = pgTable(
  "playlist_songs",
  {
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    songId: integer("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.playlistId, table.songId] })],
);

/**
 * 사용자별 YouTube 검색 소비량 — "실제로 태운 쿼터"의 원본 (docs/SSOT.md).
 *
 * 이 값만은 계산으로 되살릴 수 없어 저장한다(SSOT의 "저장하지 않는다" 원칙의 예외).
 * 예전엔 "내 목록에 든 곡 중 최근 조회된 곡 수"로 셌는데, 곡을 빼거나 목록을 지우면
 * 카운터가 되돌아가 담기→조회→빼기를 반복하면 한도가 사실상 없었고, 403·타임아웃으로
 * 실패한 조회는 쿼터를 태우고도 한 번도 세지 않았다. 그래서 "조회를 시도한 순간"
 * 단조 증가하는 행을 따로 둔다 — 목록을 어떻게 주무르든 줄지 않는다.
 */
export const youtubeLookups = pgTable(
  "youtube_lookups",
  {
    userId: integer("user_id").notNull(),
    /** UTC 날짜 — 이 날짜가 넘어가면 한도가 리셋된다 */
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

export type Theme = typeof themes.$inferSelect;
export type Song = typeof songs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Like = typeof likes.$inferSelect;
export type UserStar = typeof userStars.$inferSelect;
export type Playlist = typeof playlists.$inferSelect;
export type PlaylistSong = typeof playlistSongs.$inferSelect;
export type YoutubeLookup = typeof youtubeLookups.$inferSelect;
