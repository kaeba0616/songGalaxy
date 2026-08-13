/**
 * 꾸미기 오브젝트의 실제 도형. three 기본 도형만 쓴다 —
 * 모델 파일을 받아오지 않는 이유는 저장소도 로더도 늘리지 않기 위해서고,
 * 지금 행성이 전부 이 방식(언덕은 sin 합성, 별은 Points)이라 톤도 맞는다.
 *
 * 무엇이 있는지(카탈로그)와 어디에 놓이는지(자리)는 src/config/planet-decor.ts가 원본이다.
 * 여기는 "그 slug가 어떻게 생겼나"만 안다.
 */
import * as THREE from "three";
import { PLANET_DECOR, decorPlacement, groundHeightOffset } from "@/config/planet-decor";
import type { PlanetTheme } from "@/config/planet-themes";
import { hashString, mulberry32 } from "@/lib/layout-math";

/** 하늘 돔 위 오브젝트가 놓이는 반경 — 곡 별과 같다 */
const SKY_RADIUS = 430;

/**
 * 지면 오브젝트가 지면에 파묻히지 않는 최소 밝기(사람 눈 기준 휘도).
 * 지면은 어느 테마에서도 거의 검정(#0a141c 등, 휘도 0.08 미만)이고 씬에 조명이
 * 없어서, 이 아래로 내려가면 "색이 있는데 안 보이는" 상태가 된다. 실제로 예전에
 * theme.ground를 밝기만 달리해 쓰다가 오브젝트가 통째로 안 보이는 버그가 났다.
 */
const MIN_LUMA = 0.34;

/** 사람 눈 기준 휘도 — 같은 밝기라도 초록이 파랑보다 밝게 보이는 것을 반영한다 */
function luma(c: THREE.Color): number {
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
}

/**
 * 꾸미기 오브젝트의 색.
 *
 * 예전에는 전부 `theme.glow`를 밝기만 달리해 만들었다. 지면에 안 묻히는 건
 * 해결됐지만 나무도 바위도 호수도 전부 한 가지 색이라 단색으로 보였다.
 * 그래서 **사물의 고유색(base)을 쓰되** 두 가지를 건다:
 *
 * 1. `tint`만큼 테마색 쪽으로 섞는다 — 행성마다 색조가 달라 한 화면에서 따로 놀지 않는다
 * 2. 휘도가 MIN_LUMA 아래면 색조(hue)는 그대로 두고 밝기만 끌어올린다 —
 *    고유색을 주면서도 "지면에 묻혀 안 보이는" 옛 버그로 돌아가지 않게 하는 안전장치
 */
function decorTone(
  theme: PlanetTheme,
  base: string,
  opts: { tint?: number; mul?: number } = {},
): THREE.Color {
  const { tint = 0.26, mul = 1 } = opts;
  const c = new THREE.Color(base).lerp(new THREE.Color(theme.glow), tint).multiplyScalar(mul);
  const l = luma(c);
  if (l < MIN_LUMA) c.multiplyScalar(MIN_LUMA / Math.max(l, 0.001));
  return c;
}

function decorMat(
  theme: PlanetTheme,
  base: string,
  opts: { tint?: number; mul?: number } = {},
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: decorTone(theme, base, opts) });
}

/** 같은 종류라도 개체마다 색조를 조금씩 흔든다 — 마인크래프트·동물의 숲의 그 느낌 */
function jitter(hex: string, rng: () => number, amount = 0.06): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + (rng() - 0.5) * amount + 1) % 1,
    Math.min(1, Math.max(0, hsl.s + (rng() - 0.5) * 0.18)),
    Math.min(1, Math.max(0, hsl.l + (rng() - 0.5) * 0.14)),
  );
  return `#${c.getHexString()}`;
}

/** 나무 — 갈색 줄기 + 2단 초록 잎, 그루마다 초록이 조금씩 다르다.
 *  줄기는 처음에 짙은 갈색(#7a4f2e)이었는데, 그 밝기로는 MIN_LUMA에 걸려
 *  통째로 끌어올려지면서 분홍빛으로 떴다 — 어두운 색을 밝히면 색조가 뜬다.
 *  애초에 하한을 넘는 밝은 갈색을 쓰고 테마 혼합도 줄여 갈색으로 남긴다. */
const TRUNK = "#a06a3c";
const LEAF = "#4c9e46";
/** 발치의 들꽃 — 초록 사이에서 튀라고 일부러 채도 높은 색만 쓴다 */
const FLOWERS = ["#e8617d", "#f2c53d", "#f3f0e6", "#8f6fd6"];

function trees(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const h = 8 + rng() * 6;
    const trunkMat = decorMat(theme, jitter(TRUNK, rng, 0.03), { tint: 0.07 });
    // 잎은 위가 밝고 아래가 어둡다 — 조명이 없어도 덩어리감이 생긴다
    const leafTop = decorMat(theme, jitter(LEAF, rng, 0.1), { mul: 1.12 });
    const leafLow = decorMat(theme, jitter(LEAF, rng, 0.1), { mul: 0.82 });
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, h * 0.45, 6), trunkMat);
    const low = new THREE.Mesh(new THREE.ConeGeometry(h * 0.34, h * 0.42, 7), leafLow);
    const top = new THREE.Mesh(new THREE.ConeGeometry(h * 0.25, h * 0.4, 7), leafTop);
    t.position.y = h * 0.225;
    low.position.y = h * 0.52;
    top.position.y = h * 0.78;
    const one = new THREE.Group();
    one.add(t, low, top);
    one.position.set((rng() - 0.5) * 26, 0, (rng() - 0.5) * 26);
    g.add(one);
  }
  // 들꽃 몇 송이 — 초록·갈색만 있으면 밤에 한 덩어리로 보인다
  for (let i = 0; i < 7; i++) {
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 6, 5),
      decorMat(theme, FLOWERS[Math.floor(rng() * FLOWERS.length)], { tint: 0.12, mul: 1.15 }),
    );
    petal.position.set((rng() - 0.5) * 30, 0.5, (rng() - 0.5) * 30);
    g.add(petal);
  }
  return g;
}

/** 바위 — 푸른기 도는 회색 돌, 덩어리마다 색이 조금씩 다르다 */
const STONE = "#8b929c";
const MOSS = "#6aa84f";

function rocks(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 3 + rng() * 3;
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      decorMat(theme, jitter(STONE, rng, 0.05), { tint: 0.3 }),
    );
    m.position.set((rng() - 0.5) * 18, r * 0.4, (rng() - 0.5) * 18);
    m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    // 위쪽에 낀 이끼 한 조각 — 회색만 있으면 돌이 아니라 그냥 덩어리로 보인다
    const moss = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r * 0.55, 0),
      decorMat(theme, jitter(MOSS, rng, 0.08), { tint: 0.18 }),
    );
    moss.position.set(m.position.x + r * 0.25, m.position.y + r * 0.62, m.position.z - r * 0.2);
    moss.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(m, moss);
  }
  return g;
}

function obelisk(theme: PlanetTheme): THREE.Object3D {
  // 반드시 Group으로 감싸 돌려준다 — buildDecor가 반환값의 position을 통째로 덮어쓰므로,
  // 메시를 그대로 돌려주면 아래에서 준 y 오프셋이 사라져 오브젝트가 지면에 반쯤 묻힌다
  const g = new THREE.Group();
  const h = 24;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 2.4, h, 4),
    decorMat(theme, "#cbb185", { tint: 0.22 }),   // 사암
  );
  m.position.y = h / 2;
  m.rotation.y = Math.PI / 4;
  // 꼭대기만 테마색 — 멀리서도 "저 행성의 것"으로 읽히는 표식
  const cap = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.1, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glow).multiplyScalar(1.35) }),
  );
  cap.position.y = h + 1.4;
  g.add(m, cap);
  return g;
}

function lighthouse(theme: PlanetTheme): THREE.Object3D {
  const g = new THREE.Group();
  const h = 28;
  // 흰-빨강 가로줄 등대 — 단색 기둥이면 오벨리스크와 실루엣이 구분되지 않는다.
  // 원기둥을 4토막으로 나눠 번갈아 칠한다(밑이 굵은 형태는 그대로 유지)
  const BANDS = 4;
  const tower = new THREE.Group();
  for (let i = 0; i < BANDS; i++) {
    const y0 = (h / BANDS) * i;
    const rAt = (y: number) => 3.2 + (1.6 - 3.2) * (y / h); // 밑 3.2 → 위 1.6
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(rAt(y0 + h / BANDS), rAt(y0), h / BANDS, 10),
      decorMat(theme, i % 2 === 0 ? "#f2efe6" : "#cf4a3f", { tint: 0.14 }),
    );
    seg.position.y = y0 + h / BANDS / 2;
    tower.add(seg);
  }
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glow).multiplyScalar(1.3) }),
  );
  lamp.position.y = h + 1.5;
  // 천천히 도는 빛줄기 — 애니메이션은 GalaxyCanvas의 프레임 루프가 돌린다
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 40, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.glow),
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(20, h + 1.5, 0);
  const spin = new THREE.Group();
  spin.add(beam);
  spin.name = "decor-spin"; // 프레임 루프가 이 이름으로 찾아 돌린다
  g.add(tower, lamp, spin);
  return g;
}

function lake(theme: PlanetTheme, rng: () => number, distance: number): THREE.Object3D {
  // obelisk와 같은 이유로 Group으로 감싼다 (buildDecor가 position을 덮어쓴다)
  const g = new THREE.Group();
  // 절대 크기로 두면 배치 거리(flat 항목 밴드 10~30, decorPlacement 참고)보다 커질 수
  // 있어 카메라가 호수 안에 서게 된다 — 그래서 반경을 거리의 비율로 정한다. buildDecor가
  // 여기에 place.scale(최대 1.25)을 한 번 더 곱하므로, 비율 상한(0.45)은 그 곱까지
  // 감안해도 거리를 넘지 않게 잡았다 (0.45 * 1.25 = 0.5625, 즉 최악의 경우도 거리의
  // 56%까지만 차오른다)
  const r = distance * (0.3 + rng() * 0.15);
  // 반투명이라 뒤의(거의 검정인) 지면과 섞인 결과로 보인다 — 불투명도를 낮추면
  // 섞이고 나서 지면과 몇 단만 차이 나 안 보인다. 물빛을 쓰되 불투명도는 높게 유지한다
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 32),
    new THREE.MeshBasicMaterial({
      color: decorTone(theme, "#3f9fd4", { tint: 0.32 }),
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.2; // 지면과 z-파이팅하지 않게 살짝 띄운다
  // 물가 — 모래 테두리가 있어야 물이 "고여 있는 것"으로 읽힌다
  const shore = new THREE.Mesh(
    new THREE.RingGeometry(r, r * 1.13, 32),
    new THREE.MeshBasicMaterial({
      color: decorTone(theme, "#d9c08a", { tint: 0.2 }),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = 0.15;
  g.add(shore, m);
  return g;
}

function moon(theme: PlanetTheme): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(16, 24, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#f4ecd8") }),
  );
  // 은은한 달무리 — 하늘 색과 섞이도록 더하기 블렌딩
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(26, 20, 14),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.glow),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  g.add(body, halo);
  return g;
}

/**
 * slug 하나를 그 사람의 행성 위 제자리에 놓인 오브젝트로 만든다.
 * 카탈로그에 없는 slug면 null (호출부가 조용히 건너뛴다).
 * 반환된 객체는 반드시 `skyGroup`에 넣어야 한다 — 그래야 행성을 나갈 때 함께 dispose된다.
 */
export function buildDecor(
  slug: string,
  userId: number,
  C: THREE.Vector3,
  theme: PlanetTheme,
): THREE.Object3D | null {
  const place = decorPlacement(userId, slug);
  // 도형 안에서 쓰는 흔들림은 자리 계산과 다른 시드를 써야 한다 — SSOT 시드 유틸
  // (mulberry32/hashString, src/lib/layout-math.ts)을 그대로 쓴다. 재현성은
  // 결정적 시드로 지켜지고, 자리와 시드가 갈라져 있어도 userId+slug가 같으면 늘 같다
  const rng = mulberry32(hashString(`decorshape:${userId}:${slug}`));

  // 어디에 놓이는지(하늘/지면)는 카탈로그가 정한다 — 여기서 다시 판단하면 두 번째
  // 진실의 원본이 생긴다. 다음에 sky 항목을 추가하고 이 switch에 표시를 깜빡해도
  // 지면에 놓일 뿐 에러가 안 나므로(그리고 짧은 오브젝트는 지평선 아래라 안 보인다),
  // 이 판단만큼은 카탈로그 read-through로 고정한다
  const sky = PLANET_DECOR.find((d) => d.slug === slug)?.place === "sky";

  let obj: THREE.Object3D | null = null;
  switch (slug) {
    case "trees": obj = trees(theme, rng); break;
    case "rocks": obj = rocks(theme, rng); break;
    case "obelisk": obj = obelisk(theme); break;
    case "lighthouse": obj = lighthouse(theme); break;
    case "lake": obj = lake(theme, rng, place.distance); break;
    case "moon": obj = moon(theme); break;
    default: return null;
  }

  obj.scale.setScalar(place.scale);
  if (sky) {
    const el = (place.elevation * Math.PI) / 180;
    obj.position.set(
      C.x + SKY_RADIUS * Math.cos(el) * Math.cos(place.angle),
      C.y + SKY_RADIUS * Math.sin(el),
      C.z + SKY_RADIUS * Math.cos(el) * Math.sin(place.angle),
    );
  } else {
    obj.position.set(
      C.x + place.distance * Math.cos(place.angle),
      C.y + groundHeightOffset(place.distance),
      C.z + place.distance * Math.sin(place.angle),
    );
  }
  return obj;
}
