"use client";

/**
 * 폭이 고정된 한 줄 텍스트. 글자가 폭을 넘칠 때만 오른쪽 → 왼쪽으로 흐른다.
 *
 * 알약(미니플레이어)의 크기가 곡 제목 길이에 따라 들쭉날쭉하지 않도록,
 * 자리는 고정해 두고 넘치는 글자만 움직인다.
 * 같은 글자를 두 벌 이어 붙이고 정확히 절반만큼 밀어 끊김 없이 반복한다.
 */
import { useLayoutEffect, useRef, useState } from "react";

/** 반복 시 두 벌 사이의 간격(px) — tailwind pr-8과 맞춘다 */
const GAP = 32;
/** 흐르는 속도 (px/초) — 읽을 수 있을 만큼 느리게 */
const SPEED = 30;

export default function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  /** 0이면 넘치지 않아 움직이지 않는다 */
  const [duration, setDuration] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const box = boxRef.current;
      const span = textRef.current;
      if (!box || !span) return;
      const textWidth = span.scrollWidth;
      // 2px 여유 — 반올림 오차로 멀쩡한 글자가 흐르는 것을 막는다
      setDuration(textWidth > box.clientWidth + 2 ? (textWidth + GAP) / SPEED : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text]);

  return (
    <div ref={boxRef} className={`overflow-hidden ${className}`}>
      <div
        className={`flex w-max ${duration ? "animate-marquee" : ""}`}
        style={duration ? { animationDuration: `${duration}s` } : undefined}
      >
        <span ref={textRef} className={duration ? "pr-8" : ""}>
          {text}
        </span>
        {duration > 0 && (
          <span className="pr-8" aria-hidden>
            {text}
          </span>
        )}
      </div>
    </div>
  );
}
