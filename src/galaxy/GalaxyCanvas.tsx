"use client";

/**
 * 구형 3D 은하 렌더러 (이슈 #4)
 * - 3만 곡을 GPU 포인트 2겹(코어+헤일로 글로우)으로 렌더링
 * - 3단계 LOD 라벨: 멀리=성단 12개 / 접근=세부 테마 / 진입=곡 제목
 * - 곡 클릭 시 fly-to + 정보 패널, "전체 보기" 리셋
 * 좌표는 서버가 준 값 그대로 사용한다 (좌표 불변 — 카메라만 움직인다).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GalaxyPayload, GalaxyTheme } from "./types";

const GALAXY_BG = "#05060f";
/** 카메라 초기/리셋 거리 (전체 보기) */
const OVERVIEW_DISTANCE = 2600;
/** 곡 제목 라벨이 보이기 시작하는 카메라-곡 거리 */
const SONG_LABEL_DISTANCE = 130;
/** 동시에 띄우는 곡 라벨 수 */
const SONG_LABEL_POOL = 24;

interface SelectedSong {
  title: string;
  artist: string;
}

const CORE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (260.0 / -mv.z), 1.0, 28.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const CORE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  uniform float uAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float falloff = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, falloff * uAlpha);
  }
`;

function makePointsLayer(
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  alpha: number,
): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: CORE_VERTEX,
    fragmentShader: CORE_FRAGMENT,
    uniforms: { uAlpha: { value: alpha } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

export default function GalaxyCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const [selected, setSelected] = useState<SelectedSong | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [songCount, setSongCount] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const labelLayer = labelLayerRef.current;
    if (!container || !labelLayer) return;

    let disposed = false;
    let frameId = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(GALAXY_BG);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 1, 20000);
    camera.position.set(0, OVERVIEW_DISTANCE * 0.35, OVERVIEW_DISTANCE);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 20;
    controls.maxDistance = 6000;
    controls.zoomToCursor = true; // 휠 줌이 커서가 가리키는 성단 쪽으로 파고들게

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    // 원경 배경 별 (장식용, 데이터와 무관)
    {
      const n = 1600;
      const pos = new Float32Array(n * 3);
      const rng = () => Math.random() * 2 - 1;
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(rng(), rng(), rng()).normalize().multiplyScalar(7000 + Math.random() * 5000);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0x8899bb, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.5 });
      scene.add(new THREE.Points(geo, mat));
    }

    // 라벨 DOM 유틸
    interface Label {
      el: HTMLDivElement;
      pos: THREE.Vector3;
      theme?: GalaxyTheme;
    }
    const makeLabel = (text: string, cls: string, color?: string): HTMLDivElement => {
      const el = document.createElement("div");
      el.textContent = text;
      el.className = `galaxy-label ${cls}`;
      if (color) el.style.color = color;
      labelLayer.appendChild(el);
      return el;
    };

    const clusterLabels: Label[] = [];
    const subLabels: (Label & { theme: GalaxyTheme; parent: GalaxyTheme })[] = [];
    const songLabels: { el: HTMLDivElement; index: number }[] = [];
    let payload: GalaxyPayload | null = null;
    let positions: Float32Array | null = null;
    let points: THREE.Points | null = null;

    // fly-to 애니메이션 상태
    let fly: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number } | null = null;
    const flyTo = (target: THREE.Vector3, distance: number) => {
      const dir = camera.position.clone().sub(target).normalize();
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1).normalize();
      fly = {
        fromPos: camera.position.clone(),
        toPos: target.clone().add(dir.multiplyScalar(distance)),
        fromTarget: controls.target.clone(),
        toTarget: target.clone(),
        start: performance.now(),
      };
    };
    resetRef.current = () => {
      setSelected(null);
      flyTo(new THREE.Vector3(0, 0, 0), OVERVIEW_DISTANCE);
    };

    // 클릭(드래그 아님) → 곡 선택
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 6;
    let downAt: [number, number] | null = null;
    const onPointerDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
    const onPointerUp = (e: PointerEvent) => {
      if (!downAt || !points || !payload) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(points);
      const hit = hits[0];
      if (hit?.index == null) return;
      const i = hit.index;
      setSelected({ title: payload.songs.title[i], artist: payload.songs.artist[i] });
      flyTo(new THREE.Vector3(positions![i * 3], positions![i * 3 + 1], positions![i * 3 + 2]), 45);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // 데이터 로드 → 씬 구성
    fetch("/api/galaxy")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GalaxyPayload>;
      })
      .then((data) => {
        if (disposed) return;
        payload = data;
        const n = data.songs.id.length;
        setSongCount(n);
        positions = new Float32Array(data.songs.pos);
        const colors = new Float32Array(n * 3);
        const sizes = new Float32Array(n);
        const haloSizes = new Float32Array(n);
        const themeById = new Map(data.themes.map((t) => [t.id, t]));
        const tmp = new THREE.Color();
        for (let i = 0; i < n; i++) {
          tmp.set(themeById.get(data.songs.themeId[i])?.color ?? "#ffffff");
          colors.set([tmp.r, tmp.g, tmp.b], i * 3);
          const pop = data.songs.popularity[i] / 100;
          sizes[i] = 1.6 + pop * 3.2;
          haloSizes[i] = sizes[i] * 4.5;
        }
        points = makePointsLayer(positions, colors, sizes, 0.95);
        const halo = makePointsLayer(positions, colors, haloSizes, 0.06); // 성운 느낌의 글로우층
        scene.add(halo, points);

        for (const t of data.themes) {
          if (t.level === 1) {
            clusterLabels.push({ el: makeLabel(t.label, "lv1", t.color), pos: new THREE.Vector3(t.x, t.y, t.z), theme: t });
          } else {
            const parent = data.themes.find((p) => p.id === t.parentId);
            if (parent) {
              subLabels.push({ el: makeLabel(t.label, "lv2", t.color), pos: new THREE.Vector3(t.x, t.y, t.z), theme: t, parent });
            }
          }
        }
        for (let i = 0; i < SONG_LABEL_POOL; i++) {
          songLabels.push({ el: makeLabel("", "song"), index: -1 });
        }
        setStatus("ready");
      })
      .catch((err) => {
        console.error("galaxy payload load failed", err);
        if (!disposed) setStatus("error");
      });

    // 라벨 화면 투영
    const proj = new THREE.Vector3();
    const placeLabel = (el: HTMLDivElement, pos: THREE.Vector3, opacity: number) => {
      proj.copy(pos).project(camera);
      const behind = proj.z > 1;
      if (behind || opacity <= 0.02) {
        el.style.opacity = "0";
        return;
      }
      el.style.opacity = String(Math.min(1, opacity));
      el.style.transform = `translate(-50%, -50%) translate(${((proj.x + 1) / 2) * 100}cqw, ${((1 - proj.y) / 2) * 100}cqh)`;
    };

    let frame = 0;
    const animate = (now: number) => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);

      if (fly) {
        const t = Math.min(1, (now - fly.start) / 1300);
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // easeInOutCubic
        camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
        controls.target.lerpVectors(fly.fromTarget, fly.toTarget, e);
        if (t >= 1) fly = null;
      }
      controls.update();

      // LOD 라벨 (매 2프레임)
      if (frame % 2 === 0) {
        for (const l of clusterLabels) {
          const d = camera.position.distanceTo(l.pos);
          const r = l.theme!.radius;
          // 멀면 보이고, 성단에 접근하면 사라진다
          placeLabel(l.el, l.pos, (d - r * 1.15) / (r * 1.2));
        }
        for (const l of subLabels) {
          const dParent = camera.position.distanceTo(new THREE.Vector3(l.parent.x, l.parent.y, l.parent.z));
          const d = camera.position.distanceTo(l.pos);
          const near = 1 - (dParent - l.parent.radius * 0.4) / (l.parent.radius * 1.6); // 성단 접근도
          const notInside = (d - l.theme.radius * 0.5) / (l.theme.radius * 0.8); // 세부 테마 진입 시 페이드
          placeLabel(l.el, l.pos, Math.min(near, notInside));
        }
      }
      // 곡 제목 라벨 (매 12프레임, 가장 가까운 곡)
      if (frame % 12 === 0 && positions && payload) {
        const nearest: { d: number; i: number }[] = [];
        const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        const maxD2 = SONG_LABEL_DISTANCE * SONG_LABEL_DISTANCE;
        for (let i = 0; i < payload.songs.id.length; i++) {
          const dx = positions[i * 3] - cx, dy = positions[i * 3 + 1] - cy, dz = positions[i * 3 + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < maxD2) nearest.push({ d: d2, i });
        }
        nearest.sort((a, b) => a.d - b.d);
        for (let k = 0; k < songLabels.length; k++) {
          const slot = songLabels[k];
          const pick = nearest[k];
          slot.index = pick ? pick.i : -1;
          if (pick) slot.el.textContent = payload.songs.title[pick.i];
        }
      }
      if (positions) {
        for (const slot of songLabels) {
          if (slot.index < 0) {
            slot.el.style.opacity = "0";
            continue;
          }
          const p = new THREE.Vector3(positions[slot.index * 3], positions[slot.index * 3 + 1], positions[slot.index * 3 + 2]);
          const d = camera.position.distanceTo(p);
          placeLabel(slot.el, p, 1 - d / SONG_LABEL_DISTANCE);
        }
      }

      renderer.render(scene, camera);
      frame++;
    };
    frameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Points) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
      labelLayer.replaceChildren();
    };
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden" style={{ background: GALAXY_BG }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div
        ref={labelLayerRef}
        className="pointer-events-none absolute inset-0"
        style={{ containerType: "size" }}
      />

      {/* 상단 오버레이 */}
      <div className="pointer-events-none absolute left-4 top-4 text-white/90">
        <h1 className="text-lg font-semibold tracking-wide">songGalaxy</h1>
        {status === "ready" && (
          <p className="text-xs text-white/50">{songCount.toLocaleString()}곡이 떠 있는 은하</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => resetRef.current?.()}
        className="absolute right-4 top-4 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white/90 backdrop-blur transition hover:bg-white/20"
      >
        전체 보기
      </button>

      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center text-white/70">
          은하를 불러오는 중…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center text-red-300">
          은하 데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
        </div>
      )}

      {/* 선택된 곡 패널 */}
      {selected && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-white/15 bg-black/60 px-5 py-3 text-white backdrop-blur">
          <p className="max-w-xs truncate text-sm font-medium">{selected.title}</p>
          <p className="max-w-xs truncate text-xs text-white/60">{selected.artist}</p>
        </div>
      )}
    </div>
  );
}
