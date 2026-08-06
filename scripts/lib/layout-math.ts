/**
 * 좌표 산출용 수학 유틸 (이슈 #3, #7에서 공용)
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 구면 위에 n개의 점을 고르게 분산 (피보나치 구) */
export function fibonacciSphere(n: number, radius: number): Vec3[] {
  const points: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const y = 1 - 2 * t; // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push({
      x: Math.cos(theta) * r * radius,
      y: y * radius,
      z: Math.sin(theta) * r * radius,
    });
  }
  return points;
}

/** 결정적 시드 RNG (mulberry32). 같은 시드 → 같은 수열 (좌표 재현성) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 문자열 → 32bit 해시 (시드용, FNV-1a) */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 각 열을 z-score 정규화한 행렬을 반환 (표준편차 0인 열은 0) */
export function zscore(matrix: number[][]): number[][] {
  const rows = matrix.length;
  if (rows === 0) return [];
  const cols = matrix[0].length;
  const mean = new Array(cols).fill(0);
  const std = new Array(cols).fill(0);
  for (const row of matrix) for (let j = 0; j < cols; j++) mean[j] += row[j];
  for (let j = 0; j < cols; j++) mean[j] /= rows;
  for (const row of matrix) for (let j = 0; j < cols; j++) std[j] += (row[j] - mean[j]) ** 2;
  for (let j = 0; j < cols; j++) std[j] = Math.sqrt(std[j] / rows);
  return matrix.map((row) =>
    row.map((v, j) => (std[j] > 1e-9 ? (v - mean[j]) / std[j] : 0)),
  );
}

/**
 * PCA 상위 k개 주성분 점수 (멱반복법 + 수축).
 * 행=샘플, 열=특징. 반환: 각 샘플의 k차원 점수.
 */
export function pcaScores(matrix: number[][], k: number): number[][] {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return matrix.map(() => new Array(k).fill(0));

  // 공분산 행렬
  const cov: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  for (const row of matrix) {
    for (let i = 0; i < cols; i++) {
      for (let j = i; j < cols; j++) cov[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = i; j < cols; j++) {
      cov[i][j] /= rows;
      cov[j][i] = cov[i][j];
    }
  }

  const components: number[][] = [];
  const rng = mulberry32(42);
  for (let c = 0; c < k; c++) {
    let v = Array.from({ length: cols }, () => rng() - 0.5);
    for (let iter = 0; iter < 60; iter++) {
      const next = new Array(cols).fill(0);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < cols; j++) next[i] += cov[i][j] * v[j];
      }
      const norm = Math.hypot(...next) || 1;
      v = next.map((x) => x / norm);
    }
    components.push(v);
    // 수축: 찾은 성분 방향 제거
    let lambda = 0;
    for (let i = 0; i < cols; i++) {
      let s = 0;
      for (let j = 0; j < cols; j++) s += cov[i][j] * v[j];
      lambda += s * v[i];
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) cov[i][j] -= lambda * v[i] * v[j];
    }
  }

  return matrix.map((row) =>
    components.map((comp) => row.reduce((sum, x, i) => sum + x * comp[i], 0)),
  );
}

/** 값 배열을 [-1, 1]로 스케일 (95퍼센타일 기준, 이상치 클램프) */
export function scaleToUnit(values: number[]): number[] {
  const sorted = [...values].map(Math.abs).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 1;
  return values.map((v) => Math.max(-1, Math.min(1, v / p95)));
}
