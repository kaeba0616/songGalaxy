import GalaxyCanvas from "@/galaxy/GalaxyCanvas";

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
