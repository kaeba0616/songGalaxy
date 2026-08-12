"use client";

/**
 * 모바일 가상 조이스틱 — 밤하늘에서 걸어다닐 때만 쓴다.
 *
 * 씬을 모른다. 어느 방향이 눌린 상태인지만 알려주고, 그걸 행성 회전으로
 * 옮기는 일은 GalaxyCanvas의 프레임 루프가 한다 (SSOT: src/galaxy/planet-walk.ts).
 * 방향을 각도가 아니라 네 개의 불리언으로 넘기는 이유는 키보드와 같은 통로를
 * 쓰기 위해서다 — 둘을 따로 두면 이동 규칙이 두 벌이 된다.
 */
import { useEffect, useRef, useState } from "react";

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

export default function WalkStick({ onChange }: { onChange: (v: StickValue) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  // 최신 onChange를 언마운트 클린업에서 쓰기 위한 참조 — 클린업은 마운트 때의
  // 클로저를 그대로 들고 있어서, deps 없이 최신 콜백을 참조하려면 ref가 필요하다.
  // 렌더 중에는 ref를 쓰지 않는다 — 이펙트에서만 갱신한다
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    return () => {
      // 조이스틱을 누른 채로 화면이 사라지면(행성→행성 바로 이동 등)
      // pointerup/cancel이 이 엘리먼트에 오지 못한다 — 언마운트 때도 반드시
      // 비워야 다음 행성에 도착하자마자 안 누른 방향으로 계속 걷지 않는다
      onChangeRef.current(NONE);
    };
  }, []);

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

  return (
    <div
      ref={baseRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="행성 위 이동"
      /* touch-none: 없으면 브라우저가 스크롤 제스처로 가져가 조작이 끊긴다 */
      className="absolute bottom-4 left-4 z-10 grid h-28 w-28 touch-none place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur sm:hidden"
    >
      <div
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        className="h-12 w-12 rounded-full border border-white/25 bg-white/20"
      />
    </div>
  );
}
