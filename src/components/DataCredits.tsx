import Link from "next/link";

/**
 * 외부 데이터 출처 표기 — 이 목록이 출처의 단일 원본이다 (docs/SSOT.md).
 * 새 외부 소스를 붙이면 여기에 추가한다. 페이지마다 따로 적지 않는다.
 *
 * Last.fm은 API 이용약관이 출처 표기와 백링크를 요구한다.
 * 나머지도 같은 이유이거나(무료 공개 API의 관례), 데이터셋 라이선스 조건이다.
 */
const SOURCES: { name: string; href: string; what: string }[] = [
  { name: "Last.fm", href: "https://www.last.fm/", what: "가수·대표곡·청취 정보" },
  { name: "Spotify Tracks Dataset", href: "https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset", what: "곡 특성·장르" },
  { name: "iTunes Search API", href: "https://www.apple.com/itunes/", what: "앨범아트·미리듣기" },
  { name: "Deezer", href: "https://www.deezer.com/", what: "앨범아트·미리듣기" },
  { name: "MusicBrainz", href: "https://musicbrainz.org/", what: "가수 정보" },
  { name: "LRCLIB", href: "https://lrclib.net/", what: "가사" },
];

const linkClass = "underline decoration-white/20 underline-offset-2 transition hover:text-white/70";

/**
 * compact: 은하 화면처럼 자리가 없는 곳에서 쓰는 한 줄짜리.
 * 전체 목록은 /credits에서 본다.
 */
export default function DataCredits({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="pointer-events-auto text-[10px] text-white/30">
        데이터{" "}
        <a href="https://www.last.fm/" target="_blank" rel="noreferrer" className={linkClass}>
          Last.fm
        </a>
        {" · "}
        <Link href="/credits" className={linkClass}>
          출처 전체
        </Link>
      </p>
    );
  }

  return (
    <footer className="mt-12 border-t border-white/10 pt-5 text-xs leading-6 text-white/35">
      <p>
        데이터 출처 —{" "}
        {SOURCES.map((s, i) => (
          <span key={s.name}>
            {i > 0 && " · "}
            <a href={s.href} target="_blank" rel="noreferrer" className={linkClass}>
              {s.name}
            </a>
          </span>
        ))}
      </p>
      <p className="mt-1 text-white/25">
        미리듣기는 각 서비스가 제공하는 링크를 그대로 재생하며, 음원 파일을 보관하지 않습니다.
      </p>
    </footer>
  );
}

export { SOURCES };
