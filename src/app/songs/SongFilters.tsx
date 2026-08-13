"use client";

/**
 * 곡 목록의 검색·필터 바.
 *
 * 원래는 일반 GET 폼이었는데, 폼 제출이 문서를 통째로 새로 열어서
 * 전역 플레이어(PlayerProvider)가 사라지고 듣던 노래가 꺼졌다.
 * 라우터로 URL만 바꿔 클라이언트 이동을 하면 재생이 끊기지 않는다.
 *
 * 셀렉트는 고르는 즉시 적용하고, 검색어는 엔터나 버튼으로 적용한다.
 * URL에 조건이 그대로 남으므로 새로고침·공유는 예전과 같다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface FilterState {
  q: string;
  field: string;
  cluster: string;
  genre?: string;
  sort: string;
}

export default function SongFilters({
  current,
  clusters,
}: {
  current: FilterState;
  clusters: { slug: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(current.q);

  /** 조건을 바꿔 이동한다. 필터가 바뀌면 항상 1페이지부터 다시 본다 */
  const apply = (overrides: Partial<FilterState>) => {
    const merged = { ...current, q, ...overrides };
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) sp.set(key, String(value));
    }
    sp.set("page", "1");
    // replace: 검색·필터는 새 목적지가 아니라 같은 목록을 좁히는 것이다.
    // push로 쌓으면 겹쳐 띄운 화면의 ✕(뒤로 가기 한 칸)를 그만큼 더 눌러야 한다
    startTransition(() => router.replace(`/songs?${sp.toString()}`));
  };

  const selectClass =
    "rounded-full border border-white/15 bg-[#0d0f1e] px-3 py-2 text-sm transition disabled:opacity-50";

  return (
    <form
      className={`mb-5 flex flex-wrap gap-2 transition-opacity ${pending ? "opacity-60" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        apply({});
      }}
    >
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="곡 제목이나 가수 검색"
        className="min-w-48 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
      />
      <select
        value={current.field}
        disabled={pending}
        onChange={(e) => apply({ field: e.target.value })}
        className={selectClass}
        aria-label="검색 대상"
      >
        <option value="">제목+가수</option>
        <option value="title">제목만</option>
        <option value="artist">가수만</option>
      </select>
      <select
        value={current.cluster}
        disabled={pending}
        // 성단이 바뀌면 이전 성단의 세부 장르는 의미가 없으므로 함께 지운다
        onChange={(e) => apply({ cluster: e.target.value, genre: undefined })}
        className={selectClass}
        aria-label="성단"
      >
        <option value="">모든 성단</option>
        {clusters.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        value={current.sort}
        disabled={pending}
        onChange={(e) => apply({ sort: e.target.value })}
        className={selectClass}
        aria-label="정렬"
      >
        <option value="popularity">인기순</option>
        <option value="recent">최신순</option>
        <option value="title">제목순</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20 disabled:opacity-50"
      >
        검색
      </button>
    </form>
  );
}
