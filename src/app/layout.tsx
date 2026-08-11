import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LikesProvider } from "@/likes/likes-context";
import MiniPlayer from "@/player/MiniPlayer";
import { PlayerProvider } from "@/player/player-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "songGalaxy — 음악 은하계",
  description: "수만 곡이 성운처럼 깔린 은하에서 취향의 별을 찍는 음악 탐색 사이트",
};

/**
 * modal 슬롯은 은하 위에 겹쳐 띄우는 화면이 들어오는 자리다 (src/app/@modal).
 * 겹쳐 띄우는 동안 children 슬롯은 이전 경로(은하)에 머물러 있으므로
 * 3D 장면이 내려가지 않는다 — 돌아가기가 즉시가 되는 이유.
 */
export default function RootLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LikesProvider>
          <PlayerProvider>
            {children}
            {modal}
            <MiniPlayer />
          </PlayerProvider>
        </LikesProvider>
      </body>
    </html>
  );
}
