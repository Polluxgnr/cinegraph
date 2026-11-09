/** Small dense linear algebra for in-browser learning (dimensions <= 64). */

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function normalise(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Solve A x = b for symmetric positive-definite A (n x n, row-major) via Cholesky. */
export function solveSPD(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Inverse of an SPD matrix (for posterior covariances), via n Cholesky solves. */
export function inverseSPD(A: Float64Array, n: number): Float64Array {
  const inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    e.fill(0);
    e[j] = 1;
    const col = solveSPD(A, e, n);
    for (let i = 0; i < n; i++) inv[i * n + j] = col[i];
  }
  return inv;
}

/** Deterministic Gaussian random projection (seeded), so reduced vectors are stable across visits. */
export function projection(inDim: number, outDim: number, seed = 42): Float32Array {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const P = new Float32Array(inDim * outDim);
  for (let i = 0; i < P.length; i += 2) {
    const u = Math.max(rnd(), 1e-12);
    const v = rnd();
    const r = Math.sqrt(-2 * Math.log(u));
    P[i] = (r * Math.cos(2 * Math.PI * v)) / Math.sqrt(outDim);
    if (i + 1 < P.length) P[i + 1] = (r * Math.sin(2 * Math.PI * v)) / Math.sqrt(outDim);
  }
  return P;
}

/** Beta(a, b) sample via two Gamma draws (Marsaglia–Tsang). */
export function sampleBeta(a: number, b: number, rnd: () => number = Math.random): number {
  const x = sampleGamma(a, rnd);
  const y = sampleGamma(b, rnd);
  return x / (x + y);
}

function sampleGamma(k: number, rnd: () => number): number {
  if (k < 1) return sampleGamma(k + 1, rnd) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = Math.max(rnd(), 1e-12);
      const u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
