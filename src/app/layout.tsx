import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PlayerProvider>
          {children}
          <MiniPlayer />
        </PlayerProvider>
      </body>
    </html>
  );
}
