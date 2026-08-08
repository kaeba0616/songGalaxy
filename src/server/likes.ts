import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  MIN_LIKES_FOR_STAR,
  RECENT_LIKE_WEIGHT,
  RECENT_LIKE_WINDOW,
} from "@/config/constants";

/**
 * 좋아요와 내 별 (이슈 #5, D2·D6·D7 확정)
 * 원본은 likes 테이블, user_stars는 파생 캐시 (docs/SSOT.md).
 * 무효화 규칙: 좋아요 추가/삭제 트랜잭션 안에서 즉시 재계산한다.
 */

export interface StarState {
  x: number;
  y: number;
  z: number;
}

export interface LikeResult {
  liked: boolean;
  likesCount: number;
  star: StarState | null;
  /** 이번 좋아요로 별이 처음 태어났는지 (탄생 연출 트리거) */
  starBorn: boolean;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 좋아요한 곡들의 가중 중심점(최근 좋아요 가중)으로 별 좌표를 재계산 */
async function recomputeStar(tx: Tx, userId: number): Promise<{ star: StarState | null; count: number }> {
  const rows = await tx
    .select({
      x: schema.songs.posX,
      y: schema.songs.posY,
      z: schema.songs.posZ,
    })
    .from(schema.likes)
    .innerJoin(schema.songs, eq(schema.likes.songId, schema.songs.id))
    .where(eq(schema.likes.userId, userId))
    .orderBy(desc(schema.likes.createdAt));

  const placed = rows.filter((r) => r.x != null && r.y != null && r.z != null);
  if (placed.length < MIN_LIKES_FOR_STAR) {
    await tx.delete(schema.userStars).where(eq(schema.userStars.userId, userId));
    return { star: null, count: placed.length };
  }

  let sx = 0, sy = 0, sz = 0, sw = 0;
  placed.forEach((r, i) => {
    const w = i < RECENT_LIKE_WINDOW ? RECENT_LIKE_WEIGHT : 1;
    sx += r.x! * w;
    sy += r.y! * w;
    sz += r.z! * w;
    sw += w;
  });
  const star = { x: sx / sw, y: sy / sw, z: sz / sw };

  await tx
    .insert(schema.userStars)
    .values({ userId, posX: star.x, posY: star.y, posZ: star.z, likesCount: placed.length })
    .onConflictDoUpdate({
      target: schema.userStars.userId,
      set: {
        posX: star.x,
        posY: star.y,
        posZ: star.z,
        likesCount: placed.length,
        updatedAt: new Date(),
      },
    });
  return { star, count: placed.length };
}

/** 좋아요 설정/해제 + 별 즉시 재계산 (하나의 트랜잭션) */
export async function setLike(userId: number, songId: number, liked: boolean): Promise<LikeResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.likes)
      .where(eq(schema.likes.userId, userId));

    if (liked) {
      await tx.insert(schema.likes).values({ userId, songId }).onConflictDoNothing();
    } else {
      await tx
        .delete(schema.likes)
        .where(and(eq(schema.likes.userId, userId), eq(schema.likes.songId, songId)));
    }

    const { star, count } = await recomputeStar(tx, userId);
    return {
      liked,
      likesCount: count,
      star,
      starBorn: before.n < MIN_LIKES_FOR_STAR && count >= MIN_LIKES_FOR_STAR,
    };
  });
}

export interface LikeState {
  likedIds: number[];
  likesCount: number;
  star: StarState | null;
}

/** 유저의 좋아요 목록과 별 상태 */
export async function getLikeState(userId: number): Promise<LikeState> {
  const [likedRows, starRows] = await Promise.all([
    db
      .select({ songId: schema.likes.songId })
      .from(schema.likes)
      .where(eq(schema.likes.userId, userId)),
    db.select().from(schema.userStars).where(eq(schema.userStars.userId, userId)),
  ]);
  const star = starRows[0];
  return {
    likedIds: likedRows.map((r) => r.songId),
    likesCount: likedRows.length,
    star: star ? { x: star.posX, y: star.posY, z: star.posZ } : null,
  };
}
