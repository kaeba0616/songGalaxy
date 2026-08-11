import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/config/env";

/**
 * Google OAuth 로그인 (이슈 #5, D8 확정)
 * 세션은 JWT 전략 — 유저 원본은 우리 users 테이블(SSOT)이고,
 * 최초 로그인 시 google_sub 기준으로 업서트한 내부 id를 토큰에 싣는다.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.authSecret,
  trustHost: true,
  providers: [
    Google({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile?.sub) {
        const nickname = profile.name ?? "이름 없는 별";
        /** 구글이 주는 프로필 사진. 없을 수도 있다 */
        const googlePicture = typeof profile.picture === "string" ? profile.picture : null;
        const [existing] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.googleSub, profile.sub));
        if (existing) {
          token.userId = existing.id;
          token.nickname = existing.nickname;
          // 비어 있을 때만 채운다 — 직접 바꾼 사진을 로그인할 때마다 덮어쓰면 안 된다
          if (!existing.avatarUrl && googlePicture) {
            await db
              .update(schema.users)
              .set({ avatarUrl: googlePicture })
              .where(eq(schema.users.id, existing.id));
          }
        } else {
          const [created] = await db
            .insert(schema.users)
            .values({ googleSub: profile.sub, nickname, avatarUrl: googlePicture })
            .returning();
          token.userId = created.id;
          token.nickname = created.nickname;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === "number") {
        session.appUserId = token.userId;
        session.nickname = (token.nickname as string) ?? session.user?.name ?? "이름 없는 별";
      }
      return session;
    },
  },
});

/** 로그인한 유저의 내부 id·닉네임. 비로그인이면 null */
export async function getSessionUser(): Promise<{ id: number; nickname: string } | null> {
  const session = await auth();
  if (!session || typeof session.appUserId !== "number") return null;
  return { id: session.appUserId, nickname: session.nickname ?? "이름 없는 별" };
}

declare module "next-auth" {
  interface Session {
    appUserId?: number;
    nickname?: string;
  }
}
