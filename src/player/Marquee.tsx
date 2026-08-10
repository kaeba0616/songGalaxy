"use client";

/**
 * 폭이 고정된 한 줄 텍스트. 글자가 폭을 넘칠 때만 오른쪽 → 왼쪽으로 흐른다.
 *
 * 알약(미니플레이어)의 크기가 곡 제목 길이에 따라 들쭉날쭉하지 않도록,
 * 자리는 고정해 두고 넘치는 글자만 움직인다.
 * 같은 글자를 두 벌 이어 붙이고 정확히 절반만큼 밀어 끊김 없이 반복한다.
 *
 * 재생 목록처럼 수십 줄에 함께 쓰이므로, 화면에 보이는 줄만 재고 움직인다.
 * 태그가 span인 것은 <button> 안(재생 목록 항목)에서도 올바른 마크업이 되게 하기 위함.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** 반복 시 두 벌 사이의 간격(px) — tailwind pr-8과 맞춘다 */
const GAP = 32;
/** 흐르는 속도 (px/초) — 읽을 수 있을 만큼 느리게 */
const SPEED = 30;

export default function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  /** 0이면 넘치지 않아 움직이지 않는다 */
  const [duration, setDuration] = useState(0);
  /** 화면 밖 줄은 재지도, 움직이지도 않는다 (목록 150줄 대비) */
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      rootMargin: "64px",
    });
    io.observe(box);
    return () => io.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
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
  }, [text, visible]);

  const animating = duration > 0 && visible;

  return (
    <span ref={boxRef} className={`block overflow-hidden whitespace-nowrap ${className}`}>
      <span
        className={`flex w-max ${animating ? "animate-marquee" : ""}`}
        style={animating ? { animationDuration: `${duration}s` } : undefined}
      >
        <span ref={textRef} className={animating ? "pr-8" : "block max-w-full truncate"}>
          {text}
        </span>
        {animating && (
          <span className="pr-8" aria-hidden>
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
