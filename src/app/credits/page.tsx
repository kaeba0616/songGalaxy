import BackToGalaxyLink from "@/components/BackToGalaxyLink";
import DataCredits, { SOURCES } from "@/components/DataCredits";

export const metadata = { title: "데이터 출처 — songGalaxy" };

/**
 * /credits — 외부 데이터 출처를 한눈에 보여주는 페이지.
 * 목록의 원본은 src/components/DataCredits.tsx (docs/SSOT.md) — 여기서 다시 적지 않는다.
 */
export default function CreditsPage() {
  return (
    <main className="min-h-dvh bg-[#05060f] px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <BackToGalaxyLink className="text-sm text-white/50 transition hover:text-white" />
        <h1 className="mt-6 text-2xl font-semibold">데이터 출처</h1>
        <p className="mt-2 text-sm text-white/50">
          songGalaxy의 곡·가수·앨범아트·가사는 아래 서비스에서 받아옵니다.
        </p>

        <ul className="mt-6 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
          {SOURCES.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline decoration-white/25 underline-offset-2 transition hover:text-white/70"
                >
                  {s.name}
                </a>
                <p className="mt-0.5 text-sm text-white/40">{s.what}</p>
              </div>
            </li>
          ))}
        </ul>

        <DataCredits />
      </div>
    </main>
  );
}
