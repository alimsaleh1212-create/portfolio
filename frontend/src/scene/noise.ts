/**
 * Seeded randomness and gradient noise, so the mountain is identical on every load.
 * Nothing here uses Math.random or the clock.
 */

/** A small, fast generator: the same seed always gives the same sequence in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 2D gradient noise in about [-1, 1], built from a seed. */
export function createNoise(seed: number): (x: number, y: number) => number {
  const random = mulberry32(seed);
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];

  const angles = new Float32Array(256);
  for (let i = 0; i < 256; i++) angles[i] = random() * Math.PI * 2;

  const dot = (hash: number, x: number, y: number) => {
    const angle = angles[hash];
    return Math.cos(angle) * x + Math.sin(angle) * y;
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = xi & 255;
    const y0 = yi & 255;
    const aa = perm[perm[x0] + y0];
    const ab = perm[perm[x0] + y0 + 1];
    const ba = perm[perm[x0 + 1] + y0];
    const bb = perm[perm[x0 + 1] + y0 + 1];
    const u = fade(xf);
    const v = fade(yf);
    const top = dot(aa, xf, yf) * (1 - u) + dot(ba, xf - 1, yf) * u;
    const bottom = dot(ab, xf, yf - 1) * (1 - u) + dot(bb, xf - 1, yf - 1) * u;
    return (top * (1 - v) + bottom * v) * 1.4;
  };
}

export type Noise = ReturnType<typeof createNoise>;

/** Layered noise: each octave doubles the frequency and halves the weight. Result in about [-1, 1]. */
export function fbm(
  noise: Noise,
  x: number,
  y: number,
  octaves: number,
  gain = 0.5,
): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency + i * 17.3, y * frequency - i * 9.1) * weight;
    total += weight;
    weight *= gain;
    frequency *= 2;
  }
  return sum / total;
}

/** Creased noise in [0, 1]: sharp ridges where the base noise crosses zero. */
export function ridged(
  noise: Noise,
  x: number,
  y: number,
  octaves: number,
): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  let frequency = 1;
  let previous = 1;
  for (let i = 0; i < octaves; i++) {
    let n =
      1 - Math.abs(noise(x * frequency + i * 31.7, y * frequency + i * 5.3));
    n *= n;
    sum += n * weight * (i === 0 ? 1 : previous);
    total += weight;
    previous = Math.min(1, n * 1.6);
    weight *= 0.5;
    frequency *= 2.05;
  }
  return Math.min(1, sum / total);
}

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
