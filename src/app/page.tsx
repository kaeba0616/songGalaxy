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
  return (
    <>
      {/*
        은하 데이터를 HTML 파싱 단계에서 미리 받기 시작한다.
        이게 없으면 JS 번들 로드·하이드레이션이 끝난 뒤에야 요청이 나가서
        첫 화면이 1초 넘게 늦어진다 (실측: 요청 시작이 1.65초 지점).
      */}
      <link rel="preload" href="/api/galaxy" as="fetch" />
      <GalaxyCanvas
        initialSongId={Number.isInteger(songId) ? songId : undefined}
        focusMyStar={star === "me"}
      />
    </>
  );
}
