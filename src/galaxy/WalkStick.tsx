"use client";

/**
 * 모바일 가상 조이스틱 — 밤하늘에서 걸어다닐 때만 쓴다.
 *
 * 씬을 모른다. 어느 방향이 눌린 상태인지만 알려주고, 그걸 행성 회전으로
 * 옮기는 일은 GalaxyCanvas의 프레임 루프가 한다 (SSOT: src/galaxy/planet-walk.ts).
 * 방향을 각도가 아니라 네 개의 불리언으로 넘기는 이유는 키보드와 같은 통로를
 * 쓰기 위해서다 — 둘을 따로 두면 이동 규칙이 두 벌이 된다.
 */
import { useRef, useState, useSyncExternalStore } from "react";

export interface StickValue {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

const NONE: StickValue = { forward: false, back: false, left: false, right: false };
/** 이만큼 밀어야 걷기 시작한다 — 손가락을 얹기만 해도 걸어가면 안 된다 */
const DEAD_ZONE = 12;
/** 손잡이가 밖으로 나가지 않는 반경 */
const MAX_PULL = 44;

// matchMedia는 서버에 없다 — useSyncExternalStore로 읽으면 SSR·hydration 첫 렌더는
// 항상 getServerSnapshot(false)을 쓰고, 실제 값은 hydration 직후에 반영되어
// 서버·클라이언트 첫 렌더가 어긋나는 mismatch가 나지 않는다. 값이 바뀌는 걸
// 구독하지는 않는다 — GalaxyCanvas의 (pointer: coarse) 판정도 최초 1회만 읽는다
const subscribeNoop = () => () => {};
const getIsCoarseSnapshot = () => window.matchMedia("(pointer: coarse)").matches;
const getIsCoarseServerSnapshot = () => false;

export default function WalkStick({ onChange }: { onChange: (v: StickValue) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  // (pointer: coarse)는 주 포인터 기준이라 터치스크린 노트북(주 포인터가
  // 트랙패드라 fine)에서는 그대로 숨어 키보드 경로를 쓴다
  const isCoarse = useSyncExternalStore(subscribeNoop, getIsCoarseSnapshot, getIsCoarseServerSnapshot);

  const send = (v: StickValue) => onChange(v);

  const update = (clientX: number, clientY: number) => {
    const o = originRef.current;
    if (!o) return;
    let dx = clientX - o.x;
    let dy = clientY - o.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_PULL) {
      dx = (dx / d) * MAX_PULL;
      dy = (dy / d) * MAX_PULL;
    }
    setKnob({ x: dx, y: dy });
    if (d < DEAD_ZONE) {
      send(NONE);
      return;
    }
    // 화면 위쪽이 앞이다 (dy가 음수)
    send({
      forward: dy < -DEAD_ZONE / 2,
      back: dy > DEAD_ZONE / 2,
      left: dx < -DEAD_ZONE / 2,
      right: dx > DEAD_ZONE / 2,
    });
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = baseRef.current?.getBoundingClientRect();
    if (!r) return;
    originRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!originRef.current) return;
    update(e.clientX, e.clientY);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!originRef.current) return;
    originRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setKnob({ x: 0, y: 0 });
    // 손을 떼면 반드시 멈춘다 — 안 비우면 마지막 방향으로 계속 걸어간다
    send(NONE);
  };

  // SSR·hydration 직후(false)거나 주 포인터가 fine이면(마우스/트랙패드 = 키보드 있음) 그리지 않는다
  if (!isCoarse) return null;

  return (
    <div
      ref={baseRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="행성 위 이동"
      /* touch-none: 없으면 브라우저가 스크롤 제스처로 가져가 조작이 끊긴다.
         bottom-24(96px): 알약형 미니플레이어(MiniPlayer.tsx)가 기본 위치(bottom-4)에서
         높이 약 56px(테두리 2px + 상하 패딩 16px + 내용부 36px)로 뜨므로 위쪽 끝이
         화면 바닥에서 약 72px다. z-index를 올려 알약 위로 덮으면 알약의 ♥/+/⏮/▶/⏭
         버튼이 조이스틱의 투명한 박스에 가려 눌리지 않으므로, 겹치지 않도록 세로로
         띄운다(24px 여유) — MiniPlayer는 fixed z-40이라 GalaxyCanvas 컨테이너의
         relative(z-index: auto) 안에서 이 조이스틱의 z-10과 그냥 겹친다 */
      className="absolute bottom-24 left-4 z-10 grid h-28 w-28 touch-none place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur"
    >
      <div
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        className="h-12 w-12 rounded-full border border-white/25 bg-white/20"
      />
    </div>
  );
}
