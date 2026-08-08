import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import GalaxyCanvas from "@/galaxy/GalaxyCanvas";

export const dynamic = "force-dynamic";

/**
 * /planet/[userId] — 행성 공유 딥링크 (이슈 #10).
 * 접속하면 은하 로드 후 그 유저의 행성으로 자동 착륙한다.
 */
export default async function PlanetPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) notFound();
  const [star] = await db
    .select({ userId: schema.userStars.userId })
    .from(schema.userStars)
    .where(eq(schema.userStars.userId, userId));
  if (!star) notFound(); // 별이 없는 유저의 행성은 아직 없음
  return <GalaxyCanvas landUserId={userId} />;
}
