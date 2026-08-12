/**
 * 꾸미기 오브젝트의 실제 도형. three 기본 도형만 쓴다 —
 * 모델 파일을 받아오지 않는 이유는 저장소도 로더도 늘리지 않기 위해서고,
 * 지금 행성이 전부 이 방식(언덕은 sin 합성, 별은 Points)이라 톤도 맞는다.
 *
 * 무엇이 있는지(카탈로그)와 어디에 놓이는지(자리)는 src/config/planet-decor.ts가 원본이다.
 * 여기는 "그 slug가 어떻게 생겼나"만 안다.
 */
import * as THREE from "three";
import { decorPlacement, groundHeightOffset } from "@/config/planet-decor";
import type { PlanetTheme } from "@/config/planet-themes";

/** 하늘 돔 위 오브젝트가 놓이는 반경 — 곡 별과 같다 */
const SKY_RADIUS = 430;

function ground(theme: PlanetTheme, mul: number): THREE.MeshBasicMaterial {
  // 조명이 없는 씬이라 MeshBasic을 쓴다. 테마 지면색을 밝기만 달리해 실루엣을 만든다
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.ground).multiplyScalar(mul) });
}

function trees(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const trunkMat = ground(theme, 0.7);
  const leafMat = ground(theme, 1.6);
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const h = 8 + rng() * 6;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, h * 0.45, 6), trunkMat);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(h * 0.32, h * 0.7, 7), leafMat);
    t.position.y = h * 0.225;
    leaf.position.y = h * 0.6;
    const one = new THREE.Group();
    one.add(t, leaf);
    one.position.set((rng() - 0.5) * 26, 0, (rng() - 0.5) * 26);
    g.add(one);
  }
  return g;
}

function rocks(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = ground(theme, 1.35);
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 3 + rng() * 3;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    m.position.set((rng() - 0.5) * 18, r * 0.4, (rng() - 0.5) * 18);
    m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(m);
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
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glow).multiplyScalar(0.75) }),
  );
  m.position.y = h / 2;
  m.rotation.y = Math.PI / 4;
  g.add(m);
  return g;
}

function lighthouse(theme: PlanetTheme): THREE.Object3D {
  const g = new THREE.Group();
  const h = 28;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.2, h, 10), ground(theme, 1.5));
  tower.position.y = h / 2;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glow) }),
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

function lake(theme: PlanetTheme, rng: () => number): THREE.Object3D {
  // obelisk와 같은 이유로 Group으로 감싼다 (buildDecor가 position을 덮어쓴다)
  const g = new THREE.Group();
  const r = 25 + rng() * 15;
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.glow).multiplyScalar(0.5),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.2; // 지면과 z-파이팅하지 않게 살짝 띄운다
  g.add(m);
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
  // 도형 안에서 쓰는 흔들림도 같은 자리 값에서 파생시켜 재현성을 지킨다
  let t = place.angle * 1000 + place.distance;
  const rng = () => {
    t = (t * 9301 + 49297) % 233280;
    return t / 233280;
  };

  let obj: THREE.Object3D | null = null;
  let sky = false;
  switch (slug) {
    case "trees": obj = trees(theme, rng); break;
    case "rocks": obj = rocks(theme, rng); break;
    case "obelisk": obj = obelisk(theme); break;
    case "lighthouse": obj = lighthouse(theme); break;
    case "lake": obj = lake(theme, rng); break;
    case "moon": obj = moon(theme); sky = true; break;
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
