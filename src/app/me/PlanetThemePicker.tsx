"use client";

/**
 * 행성 테마 고르기.
 *
 * 서버 액션으로 저장하는 것은 그대로지만, 저장만 하면 뒤에 떠 있는 은하는
 * 처음 받아온 별 데이터(`/api/stars`)의 옛 테마를 그대로 들고 있어서 밤하늘 색이
 * 바뀌지 않았다 — 새로고침해야 보였다. 그래서 저장과 동시에 공용 상태
 * (`likes-context`)에도 알린다. 은하는 그 값을 보고 바로 다시 칠한다.
 */
import { useTransition } from "react";
import { PLANET_THEMES } from "@/config/planet-themes";
import { useLikes } from "@/likes/likes-context";
import { setPlanetThemeAction } from "./actions";

export default function PlanetThemePicker({ current }: { current: string }) {
  const { auth, setPlanetTheme } = useLikes();
  const [pending, startTransition] = useTransition();
  // 저장이 끝나기 전에도 고른 것이 눌린 상태로 보이게 — 서버 왕복을 기다리지 않는다
  const selected = auth.planetTheme ?? current;

  return (
    <div className="flex flex-wrap gap-3">
      {PLANET_THEMES.map((theme) => (
        <button
          key={theme.slug}
          type="button"
          disabled={pending}
          aria-pressed={selected === theme.slug}
          onClick={() => {
            setPlanetTheme(theme.slug);
            const fd = new FormData();
            fd.set("theme", theme.slug);
            startTransition(() => void setPlanetThemeAction(fd));
          }}
          className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition disabled:opacity-60 ${
            selected === theme.slug
              ? "border-amber-200/60 bg-white/10"
              : "border-white/10 bg-white/[0.03] hover:bg-white/10"
          }`}
        >
          <span
            className="h-8 w-8 rounded-full border border-white/20"
            style={{
              background: `linear-gradient(to bottom, ${theme.zenith} 0%, ${theme.horizon} 55%, ${theme.glow} 68%, ${theme.ground} 72%)`,
            }}
          />
          <span className="text-sm">{theme.label}</span>
        </button>
      ))}
    </div>
  );
}
