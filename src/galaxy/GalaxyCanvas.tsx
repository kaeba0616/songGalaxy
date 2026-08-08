"use client";

/**
 * 구형 3D 은하 렌더러 (이슈 #4)
 * - 3만 곡을 GPU 포인트 2겹(코어+헤일로 글로우)으로 렌더링
 * - 3단계 LOD 라벨: 멀리=성단 12개 / 접근=세부 테마 / 진입=곡 제목
 * - 클릭 드릴다운: 성단 라벨 → 성단 인기곡 카드, 세부 장르 라벨 → 그 장르 곡 카드
 * - 카드: 앨범아트 + 30초 미리듣기(iTunes 캐시), 곡 선택 시 가수 정보(MusicBrainz 캐시)
 * 좌표는 서버가 준 값 그대로 사용한다 (좌표 불변 — 카메라만 움직인다).
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
/** 하단 카드 캐러셀에 띄우는 최대 곡 수 (인기순) */
const CARD_LIMIT = 150;
/** 한 번에 보강 요청할 카드 수 (/api/enrich의 MAX_IDS와 일치) */
const ENRICH_BATCH = 12;

interface SelectedSong {
  title: string;
  artist: string;
}

interface ArtistInfo {
  type: string | null;
  country: string | null;
  beginYear: string | null;
  tags: string[] | null;
}

interface CardSong {
  index: number;
  id: number;
  title: string;
  artist: string;
  popularity: number;
}

interface CardData {
  title: string;
  subtitle: string;
  color: string;
  songs: CardSong[];
}

interface Media {
  artworkUrl: string | null;
  previewUrl: string | null;
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

export default function GalaxyCanvas({ initialSongId }: { initialSongId?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const cardScrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const flySongRef = useRef<((index: number) => void) | null>(null);
  const enrichRequested = useRef<Set<number>>(new Set());
  /** 오디오 onended 콜백에서 최신 상태를 읽기 위한 미러 (stale closure 방지) */
  const mediaRef = useRef<Record<number, Media>>({});
  const cardsRef = useRef<CardData | null>(null);
  const [selected, setSelected] = useState<SelectedSong | null>(null);
  const [artistInfo, setArtistInfo] = useState<ArtistInfo | null>(null);
  const [cards, setCards] = useState<CardData | null>(null);
  const [media, setMedia] = useState<Record<number, Media>>({});
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [songCount, setSongCount] = useState(0);

  /** 곡 id 목록의 앨범아트/미리듣기를 서버 캐시에서 가져온다 (중복 요청 방지, await 가능) */
  const fetchMedia = useCallback(async (ids: number[]): Promise<void> => {
    const fresh = ids.filter((id) => !enrichRequested.current.has(id)).slice(0, ENRICH_BATCH);
    if (fresh.length === 0) return;
    fresh.forEach((id) => enrichRequested.current.add(id));
    try {
      const r = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: fresh }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Record<number, Media>;
      mediaRef.current = { ...mediaRef.current, ...data };
      setMedia((prev) => ({ ...prev, ...data }));
    } catch {
      fresh.forEach((id) => enrichRequested.current.delete(id));
    }
  }, []);

  /** 카드 스크롤 시 화면에 들어온 카드들을 보강 */
  const onCardScroll = useCallback(() => {
    const el = cardScrollRef.current;
    if (!el || !cards) return;
    const cardWidth = 172; // w-40(160px) + gap 12px
    const first = Math.max(0, Math.floor(el.scrollLeft / cardWidth) - 1);
    const visible = cards.songs.slice(first, first + ENRICH_BATCH).map((s) => s.id);
    void fetchMedia(visible);
  }, [cards, fetchMedia]);

  /** 재생 중인 카드가 보이도록 캐러셀 스크롤 */
  const scrollToCard = useCallback((index: number) => {
    const el = cardScrollRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, []);

  /** 미리듣기가 끝나면 다음 곡으로 자동 진행 (미리듣기 없는 곡은 건너뜀) */
  const playNextRef = useRef<(afterId: number) => Promise<void>>(async () => {});

  const playSong = useCallback((songId: number, previewUrl: string) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 0.8;
    }
    const audio = audioRef.current;
    audio.src = previewUrl;
    void audio.play();
    audio.onended = () => void playNextRef.current(songId);
    setPlayingId(songId);
  }, []);

  playNextRef.current = async (afterId: number) => {
    const cardData = cardsRef.current;
    if (!cardData) {
      setPlayingId(null);
      return;
    }
    const idx = cardData.songs.findIndex((s) => s.id === afterId);
    if (idx < 0) {
      setPlayingId(null);
      return;
    }
    for (let i = idx + 1; i < cardData.songs.length; i++) {
      const song = cardData.songs[i];
      let m: Media | undefined = mediaRef.current[song.id];
      if (!m) {
        // 다음 곡들의 미리듣기 URL을 그 자리에서 로드
        await fetchMedia(cardData.songs.slice(i, i + ENRICH_BATCH).map((s) => s.id));
        m = mediaRef.current[song.id];
      }
      // 대기 중 카드 목록이 바뀌었으면 진행 중단
      if (cardsRef.current !== cardData) return;
      if (m?.previewUrl) {
        scrollToCard(i);
        playSong(song.id, m.previewUrl);
        return;
      }
    }
    setPlayingId(null); // 목록 끝 — 자동 재생 종료
  };

  /** 미리듣기 토글 (한 번에 한 곡만, 끝나면 다음 곡 자동 재생) */
  const togglePreview = useCallback(
    (songId: number, previewUrl: string) => {
      if (playingId === songId) {
        audioRef.current?.pause();
        setPlayingId(null);
        return;
      }
      playSong(songId, previewUrl);
    },
    [playingId, playSong],
  );

  // 카드 목록 미러 + 카드가 닫히면 재생도 정지
  useEffect(() => {
    cardsRef.current = cards;
    if (!cards) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
  }, [cards]);

  // 곡 선택 시 가수 정보 조회 (MusicBrainz 캐시)
  useEffect(() => {
    setArtistInfo(null);
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/artist?name=${encodeURIComponent(selected.artist)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info: ArtistInfo | null) => {
        if (!cancelled && info && (info.type || info.country || info.beginYear)) {
          setArtistInfo(info);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // 카드가 열리면 첫 배치 보강
  useEffect(() => {
    if (cards) void fetchMedia(cards.songs.slice(0, ENRICH_BATCH).map((s) => s.id));
  }, [cards, fetchMedia]);

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

    // 원경 배경 별 (장식용, 데이터와 무관) — 각자 위상이 다른 반짝임 (#8 미학)
    let bgStarsMat: THREE.ShaderMaterial | null = null;
    {
      const n = 1600;
      const pos = new Float32Array(n * 3);
      const phase = new Float32Array(n);
      const rng = () => Math.random() * 2 - 1;
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(rng(), rng(), rng()).normalize().multiplyScalar(7000 + Math.random() * 5000);
        pos.set([v.x, v.y, v.z], i * 3);
        phase[i] = Math.random() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
      bgStarsMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aPhase;
          varying float vPhase;
          void main() {
            vPhase = aPhase;
            gl_PointSize = 2.2;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying float vPhase;
          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            if (length(uv) > 0.5) discard;
            float twinkle = 0.25 + 0.4 * (0.5 + 0.5 * sin(uTime * 1.6 + vPhase));
            gl_FragColor = vec4(0.62, 0.68, 0.82, twinkle);
          }
        `,
        transparent: true,
        depthWrite: false,
      });
      scene.add(new THREE.Points(geo, bgStarsMat));
    }

    // 라벨 DOM 유틸 (onClick이 있으면 클릭 가능한 내비게이션 라벨)
    interface Label {
      el: HTMLDivElement;
      pos: THREE.Vector3;
      theme?: GalaxyTheme;
    }
    const makeLabel = (
      text: string,
      cls: string,
      color?: string,
      onClick?: () => void,
    ): HTMLDivElement => {
      const el = document.createElement("div");
      el.textContent = text;
      el.className = `galaxy-label ${cls}`;
      if (color) el.style.color = color;
      if (onClick) {
        el.classList.add("clickable");
        el.addEventListener("click", onClick);
      }
      labelLayer.appendChild(el);
      return el;
    };

    const clusterLabels: (Label & { theme: GalaxyTheme })[] = [];
    const subLabels: (Label & { theme: GalaxyTheme; parent: GalaxyTheme })[] = [];
    const songLabels: { el: HTMLDivElement; index: number }[] = [];
    let payload: GalaxyPayload | null = null;
    let positions: Float32Array | null = null;
    let points: THREE.Points | null = null;
    let haloMat: THREE.ShaderMaterial | null = null;
    let minimapClusters: GalaxyTheme[] = [];

    /** 미니맵(XZ 평면 투영): 성단 배치 + 현재 카메라 위치·방향 (#8 길잃음 방지) */
    const drawMinimap = () => {
      const canvas = minimapRef.current;
      if (!canvas || minimapClusters.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const size = canvas.width;
      const half = size / 2;
      const scale = (half - 10) / 950; // 은하 반경 + 여유
      ctx.clearRect(0, 0, size, size);
      // 은하 외곽
      ctx.beginPath();
      ctx.arc(half, half, 950 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.stroke();
      // 성단
      for (const c of minimapClusters) {
        ctx.beginPath();
        ctx.arc(half + c.x * scale, half + c.z * scale, Math.max(3, c.radius * scale * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = `${c.color}55`;
        ctx.fill();
      }
      // 카메라 위치(점) + 바라보는 방향(선)
      const cx = half + Math.max(-half + 4, Math.min(half - 4, camera.position.x * scale));
      const cz = half + Math.max(-half + 4, Math.min(half - 4, camera.position.z * scale));
      const dir = controls.target.clone().sub(camera.position).normalize();
      ctx.beginPath();
      ctx.moveTo(cx, cz);
      ctx.lineTo(cx + dir.x * 12, cz + dir.z * 12);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cz, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    };

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
      setCards(null);
      flyTo(new THREE.Vector3(0, 0, 0), OVERVIEW_DISTANCE);
    };
    flySongRef.current = (index: number) => {
      if (!positions || !payload) return;
      setSelected({ title: payload.songs.title[index], artist: payload.songs.artist[index] });
      flyTo(new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]), 45);
    };

    /** 특정 테마(성단 또는 세부 장르)에 속한 곡 인덱스를 인기순 카드 데이터로 만든다 */
    const collectSongs = (match: (subThemeId: number) => boolean): CardSong[] => {
      if (!payload) return [];
      const items: CardSong[] = [];
      for (let i = 0; i < payload.songs.id.length; i++) {
        if (match(payload.songs.themeId[i])) {
          items.push({
            index: i,
            id: payload.songs.id[i],
            title: payload.songs.title[i],
            artist: payload.songs.artist[i],
            popularity: payload.songs.popularity[i],
          });
        }
      }
      items.sort((a, b) => b.popularity - a.popularity);
      return items.slice(0, CARD_LIMIT);
    };

    /** 성단 클릭 → 성단 전체 인기곡 카드. 세부 장르 라벨이 보이는 거리(1.5R)까지 진입 */
    const openCluster = (cluster: GalaxyTheme) => {
      if (!payload) return;
      flyTo(new THREE.Vector3(cluster.x, cluster.y, cluster.z), cluster.radius * 1.5);
      const childIds = new Set(
        payload.themes.filter((t) => t.parentId === cluster.id).map((t) => t.id),
      );
      const songs = collectSongs((id) => childIds.has(id));
      setSelected(null);
      setCards({
        title: cluster.label,
        subtitle: `성단 전체 인기곡 · ${songs.length}곡`,
        color: cluster.color,
        songs,
      });
      cardScrollRef.current?.scrollTo({ left: 0 });
    };

    /** 세부 장르 클릭 → 그 장르 곡 카드 */
    const openTheme = (theme: GalaxyTheme, parent: GalaxyTheme) => {
      if (!payload) return;
      flyTo(new THREE.Vector3(theme.x, theme.y, theme.z), theme.radius * 2.4);
      const songs = collectSongs((id) => id === theme.id);
      setSelected(null);
      setCards({
        title: theme.label,
        subtitle: `${parent.label} · ${songs.length}곡`,
        color: theme.color,
        songs,
      });
      cardScrollRef.current?.scrollTo({ left: 0 });
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
      const hit = raycaster.intersectObject(points)[0];
      if (hit?.index == null) return;
      flySongRef.current?.(hit.index);
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
        haloMat = halo.material as THREE.ShaderMaterial;
        scene.add(halo, points);
        minimapClusters = data.themes.filter((t) => t.level === 1);

        for (const t of data.themes) {
          if (t.level === 1) {
            clusterLabels.push({
              el: makeLabel(t.label, "lv1", t.color, () => openCluster(t)),
              pos: new THREE.Vector3(t.x, t.y, t.z),
              theme: t,
            });
          } else {
            const parent = data.themes.find((p) => p.id === t.parentId);
            if (parent) {
              subLabels.push({
                el: makeLabel(t.label, "lv2", t.color, () => openTheme(t, parent)),
                pos: new THREE.Vector3(t.x, t.y, t.z),
                theme: t,
                parent,
              });
            }
          }
        }
        for (let i = 0; i < SONG_LABEL_POOL; i++) {
          songLabels.push({ el: makeLabel("", "song"), index: -1 });
        }
        setStatus("ready");
        // /songs/[id]의 "은하에서 보기" 딥링크 (?song=ID) → 해당 곡으로 비행
        if (initialSongId != null) {
          const idx = data.songs.id.indexOf(initialSongId);
          if (idx >= 0) flySongRef.current?.(idx);
        }
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
        el.style.pointerEvents = "none";
        return;
      }
      el.style.opacity = String(Math.min(1, opacity));
      el.style.pointerEvents = el.classList.contains("clickable") ? "auto" : "none";
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
          const r = l.theme.radius;
          // 멀면 보이고, 성단 클릭 도착 지점(1.5R)부터는 사라져 세부 장르에 자리를 내준다
          placeLabel(l.el, l.pos, (d - r * 1.5) / (r * 1.1));
        }
        for (const l of subLabels) {
          const dParent = camera.position.distanceTo(new THREE.Vector3(l.parent.x, l.parent.y, l.parent.z));
          const d = camera.position.distanceTo(l.pos);
          const near = 1 - (dParent - l.parent.radius * 0.6) / (l.parent.radius * 1.8); // 성단 접근도 (2.4R부터 서서히)
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

      // 미학 폴리시 (#8): 배경 별 반짝임 + 성운 글로우의 느린 숨쉬기
      const t = now / 1000;
      if (bgStarsMat) bgStarsMat.uniforms.uTime.value = t;
      if (haloMat) haloMat.uniforms.uAlpha.value = 0.055 + 0.02 * Math.sin(t * 0.7);
      if (frame % 10 === 0) drawMinimap();

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
      audioRef.current?.pause();
    };
  }, []);

  const scrollCards = (dir: -1 | 1) => {
    const el = cardScrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

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
          <p className="text-xs text-white/50">{songCount.toLocaleString()}곡이 떠 있는 은하 · 장르를 클릭해 들어가보세요</p>
        )}
      </div>

      <div className="absolute right-4 top-4 flex gap-2">
        <a
          href="/songs"
          className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white/90 backdrop-blur transition hover:bg-white/20"
        >
          곡 목록
        </a>
        <button
          type="button"
          onClick={() => resetRef.current?.()}
          className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white/90 backdrop-blur transition hover:bg-white/20"
        >
          전체 보기
        </button>
      </div>

      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-4 text-white/70">
            <span className="galaxy-pulse text-3xl">✦</span>
            <span className="text-sm tracking-widest">은하를 불러오는 중…</span>
          </div>
        </div>
      )}

      {/* 미니맵 — 성단 배치와 내 위치 (모바일에서는 숨김) */}
      <canvas
        ref={minimapRef}
        width={140}
        height={140}
        className="pointer-events-none absolute bottom-4 left-4 hidden rounded-full border border-white/10 bg-black/40 backdrop-blur sm:block"
      />

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center text-red-300">
          은하 데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
        </div>
      )}

      {/* 선택된 곡 패널 (카드 캐러셀이 열려 있으면 그 위로 올림) */}
      {selected && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 rounded-xl border border-white/15 bg-black/60 px-5 py-3 text-white backdrop-blur ${cards ? "bottom-64" : "bottom-6"}`}
        >
          <p className="max-w-xs truncate text-sm font-medium">{selected.title}</p>
          <p className="max-w-xs truncate text-xs text-white/60">{selected.artist}</p>
          {artistInfo && (
            <p className="mt-1 max-w-xs truncate text-[11px] text-white/40">
              {[
                artistInfo.type === "Group" ? "그룹" : artistInfo.type === "Person" ? "솔로" : artistInfo.type,
                artistInfo.country,
                artistInfo.beginYear && `${artistInfo.beginYear}~`,
                artistInfo.tags?.slice(0, 3).join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* 하단 곡 카드 캐러셀 (성단/세부 장르 클릭 시) */}
      {cards && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent pb-4 pt-8">
          <div className="mb-2 flex items-center justify-between px-5">
            <p className="text-sm text-white/90">
              <span className="font-semibold" style={{ color: cards.color }}>
                {cards.title}
              </span>
              <span className="ml-2 text-white/50">{cards.subtitle}</span>
            </p>
            <button
              type="button"
              onClick={() => setCards(null)}
              className="rounded-full px-2 text-white/60 transition hover:text-white"
              aria-label="곡 목록 닫기"
            >
              ✕
            </button>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => scrollCards(-1)}
              className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/60 px-2.5 py-1.5 text-white/80 backdrop-blur transition hover:bg-black/80"
              aria-label="이전 곡들"
            >
              ‹
            </button>
            <div
              ref={cardScrollRef}
              onScroll={onCardScroll}
              className="scrollbar-none flex snap-x gap-3 overflow-x-auto scroll-smooth px-10"
            >
              {cards.songs.map((song) => {
                const m = media[song.id];
                const isPlaying = playingId === song.id;
                return (
                  <div
                    key={song.id}
                    className="relative w-40 shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-white/5 text-left backdrop-blur transition hover:border-white/30 hover:bg-white/10"
                  >
                    {/* 카드 클릭 → 곡 상세 페이지 */}
                    <a href={`/songs/${song.id}`} className="block" aria-label={`${song.title} 상세 보기`}>
                      <div className="relative h-24 w-full bg-white/5">
                        {m?.artworkUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 이미지, 최적화 프록시 불필요
                          <img
                            src={m.artworkUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="grid h-full w-full place-items-center text-2xl"
                            style={{ color: cards.color }}
                          >
                            ✦
                          </div>
                        )}
                      </div>
                      <div className="p-2.5 pb-8">
                        <p className="truncate text-sm font-medium text-white">{song.title}</p>
                        <p className="truncate text-xs text-white/50">{song.artist}</p>
                        <p className="mt-0.5 text-[10px] text-white/35">인기도 {song.popularity}</p>
                      </div>
                    </a>
                    <div className="absolute bottom-2 right-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => flySongRef.current?.(song.index)}
                        className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-white/10 text-xs text-white/70 transition hover:bg-white/20"
                        aria-label={`${song.title} 별로 이동`}
                        title="은하에서 이 별로 이동"
                      >
                        ✦
                      </button>
                      {m?.previewUrl && (
                        <button
                          type="button"
                          onClick={() => togglePreview(song.id, m.previewUrl!)}
                          className={`grid h-7 w-7 place-items-center rounded-full border text-xs transition ${isPlaying ? "border-white/60 bg-white/25 text-white" : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20"}`}
                          aria-label={isPlaying ? "미리듣기 정지" : "30초 미리듣기"}
                          title="30초 미리듣기"
                        >
                          {isPlaying ? "❚❚" : "▶"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => scrollCards(1)}
              className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/60 px-2.5 py-1.5 text-white/80 backdrop-blur transition hover:bg-black/80"
              aria-label="다음 곡들"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
