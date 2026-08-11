import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/auth";
import DataCredits from "@/components/DataCredits";
import { listMyPlaylists } from "@/server/playlists";
import PlaylistManager from "./PlaylistManager";

export const dynamic = "force-dynamic";

/** 로그인한 사람의 개인 화면이다 — 검색엔진에 올리지 않는다 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ListsPage() {
  const user = await getSessionUser();
  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/50 transition hover:text-white">
          ← 은하로 돌아가기
        </Link>
        <h1 className="mt-6 mb-1 text-2xl font-semibold">내 노래 목록</h1>
        <p className="mb-5 text-sm text-white/50">
          목록의 곡은 YouTube로 전곡 재생됩니다.
        </p>
        {user ? (
          <PlaylistManager initial={await listMyPlaylists(user.id)} />
        ) : (
          <p className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/50">
            {/* 정적 문자열 href는 no-html-link-for-pages 린트에 걸린다(AddToPlaylist.tsx와 동일한 이유로
                템플릿 리터럴을 쓴다) — 로그인 후 이 페이지로 돌아오도록 callbackUrl도 함께 싣는다 */}
            <a href={`/api/auth/signin?callbackUrl=${encodeURIComponent("/lists")}`} className="underline">
              로그인
            </a>
            하면 목록을 만들 수 있어요.
          </p>
        )}
        <DataCredits />
      </div>
    </main>
  );
}
