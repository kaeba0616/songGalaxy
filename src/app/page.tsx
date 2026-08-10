import type { Viewport } from "next";
import GalaxyCanvas from "@/galaxy/GalaxyCanvas";

// 3D 캔버스 페이지: 페이지 핀치줌이 카메라 줌 제스처와 충돌하지 않게 고정
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#05060f",
};

export default async function Home(props: {
  searchParams: Promise<{ song?: string; star?: string }>;
}) {
  const { song, star } = await props.searchParams;
  const songId = Number(song);
  // 은하 데이터 요청은 GalaxyCanvas가 이펙트 맨 앞에서 직접 보낸다.
  // 여기에 <link rel="preload" as="fetch">를 두는 방법을 시도했다가 되돌렸다 —
  // preload가 fetch()의 CORS 모드와 맞지 않아 재사용되지 않고,
  // 3MB짜리 페이로드를 두 번 받아버렸다 (실측: galaxy 요청 2건).
  return (
    <GalaxyCanvas
      initialSongId={Number.isInteger(songId) ? songId : undefined}
      focusMyStar={star === "me"}
    />
  );
}
