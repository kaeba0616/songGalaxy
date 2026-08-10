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
    <GalaxyCanvas
      initialSongId={Number.isInteger(songId) ? songId : undefined}
      focusMyStar={star === "me"}
    />
  );
}
