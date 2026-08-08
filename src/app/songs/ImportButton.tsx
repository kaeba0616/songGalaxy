"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * "은하에 추가" 제출 버튼 — 누르면 편입이 끝나 화면이 갱신될 때까지
 * 펄스로 진행 중임을 보여준다. useFormStatus의 pending이 리렌더로 일찍
 * 풀리는 경우가 있어 클릭 로컬 상태로 한 번 켜지면 유지한다.
 */
export default function ImportButton() {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  const busy = pending || clicked;
  return (
    <button
      type="submit"
      onClick={() => {
        setClicked(true);
        // 편입 실패(외부 API 오류) 시 버튼이 영영 갇히지 않게 잠시 후 복구
        setTimeout(() => setClicked(false), 15_000);
      }}
      disabled={busy}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition ${
        busy
          ? "animate-pulse border-amber-200/40 bg-amber-100/10 text-amber-100"
          : "border-white/25 bg-white/10 hover:bg-white/20"
      }`}
    >
      {busy ? "✦ 추가하는 중…" : "✦ 은하에 추가"}
    </button>
  );
}
