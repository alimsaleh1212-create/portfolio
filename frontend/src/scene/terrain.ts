import { createNoise, lerp, mulberry32, smoothstep } from "./noise";
import { drain, type Steps } from "./steps";
import type { Landform } from "./landform";

/** The ground's extent in scene units. The Summit's side is far away so the massif has room. */
export const BOUNDS = { minX: -170, maxX: 170, minZ: -230, maxZ: 150 };
/** Cells along x and along z. Each cell is two triangles. */
export const CELLS = { x: 160, z: 180 };

/** The direction the light comes from, flat on the ground: it dawns off to the left, behind the Summit. */
export const SUN_AZIMUTH = { x: -0.55, z: -0.83 };

export interface TrailBench {
  /** Samples along the trail on the ground: x, z, y, repeated. */
  samples: Float32Array;
  /** How wide the cut is, from the trail's centre to where the ground is untouched. */
  inner: number;
  outer: number;
}

export interface Terrain {
  cellsX: number;
  cellsZ: number;
  /** Vertex positions on the grid, x y z, row by row: (cellsX + 1) * (cellsZ + 1) of them. */
  vertices: Float32Array;
  /** 0 to 1 per vertex: how far it lies in the shade of higher ground while the sun is low. */
  shade: Float32Array;
  /** The ground's height under any point, exactly as the drawn triangles have it. */
  heightAt: (x: number, z: number) => number;
  /** The triangle diagonals: 1 where a cell is split from its first to its last corner. */
  diagonals: Uint8Array;
}

const stride = (cellsX: number) => cellsX + 1;

/**
 * The ground as a grid of slightly shifted vertices (so the triangles are not in rows),
 * with the trail's bench cut into it. Pure and seeded: the same input gives the same ground.
 */
export function createTerrain(
  landform: Landform,
  seed: number,
  bench: TrailBench | null,
  cellsX = CELLS.x,
  cellsZ = CELLS.z,
): Terrain {
  return drain(terrainSteps(landform, seed, bench, cellsX, cellsZ));
}

/** `createTerrain` as pausable work, for building without freezing the page (see `steps.ts`). */
export function* terrainSteps(
  landform: Landform,
  seed: number,
  bench: TrailBench | null,
  cellsX = CELLS.x,
  cellsZ = CELLS.z,
): Steps<Terrain> {
  const { minX, maxX, minZ, maxZ } = BOUNDS;
  const dx = (maxX - minX) / cellsX;
  const dz = (maxZ - minZ) / cellsZ;
  const random = mulberry32(seed + 7);
  const width = stride(cellsX);
  const count = width * (cellsZ + 1);
  const vertices = new Float32Array(count * 3);
  const jitter = 0.36;

  const lookup = bench ? benchIndex(bench) : null;

  for (let j = 0; j <= cellsZ; j++) {
    if (j % 6 === 0) yield;
    for (let i = 0; i <= cellsX; i++) {
      const edge = i === 0 || j === 0 || i === cellsX || j === cellsZ;
      const x = minX + (i + (edge ? 0 : (random() * 2 - 1) * jitter)) * dx;
      const z = minZ + (j + (edge ? 0 : (random() * 2 - 1) * jitter)) * dz;
      let y = landform.height(x, z);
      if (bench && lookup) {
        const near = lookup(x, z);
        if (near) {
          const weight =
            1 - smoothstep(bench.inner, bench.outer, near.distance);
          y = lerp(y, near.y, weight);
        }
      }
      const o = (j * width + i) * 3;
      vertices[o] = x;
      vertices[o + 1] = y;
      vertices[o + 2] = z;
    }
  }

  // Split each cell along the diagonal that follows the shape of the ground more closely.
  const diagonals = new Uint8Array(cellsX * cellsZ);
  for (let j = 0; j < cellsZ; j++) {
    for (let i = 0; i < cellsX; i++) {
      const a = vertices[(j * width + i) * 3 + 1];
      const b = vertices[(j * width + i + 1) * 3 + 1];
      const c = vertices[((j + 1) * width + i) * 3 + 1];
      const d = vertices[((j + 1) * width + i + 1) * 3 + 1];
      diagonals[j * cellsX + i] = Math.abs(a - d) <= Math.abs(b - c) ? 1 : 0;
    }
  }

  const terrain: Terrain = {
    cellsX,
    cellsZ,
    vertices,
    diagonals,
    shade: new Float32Array(count),
    heightAt: () => 0,
  };
  terrain.heightAt = (x, z) => heightOnMesh(terrain, x, z, landform);
  terrain.shade.set(yield* bakeShade(terrain));
  return terrain;
}

/** The corner indexes of a cell's two triangles, as vertex indexes into the grid. */
export function cellTriangles(
  terrain: Pick<Terrain, "cellsX" | "diagonals">,
  i: number,
  j: number,
): [number, number, number, number, number, number] {
  const width = stride(terrain.cellsX);
  const a = j * width + i;
  const b = a + 1;
  const c = a + width;
  const d = c + 1;
  return terrain.diagonals[j * terrain.cellsX + i]
    ? [a, c, d, a, d, b]
    : [a, c, b, b, c, d];
}

/** The height of the drawn surface at a point: the triangle that holds it, interpolated. */
function heightOnMesh(
  terrain: Terrain,
  x: number,
  z: number,
  landform: Landform,
): number {
  const { minX, maxX, minZ, maxZ } = BOUNDS;
  if (x < minX || x > maxX || z < minZ || z > maxZ)
    return landform.height(x, z);
  const dx = (maxX - minX) / terrain.cellsX;
  const dz = (maxZ - minZ) / terrain.cellsZ;
  const ci = Math.floor((x - minX) / dx);
  const cj = Math.floor((z - minZ) / dz);
  const v = terrain.vertices;
  for (
    let j = Math.max(0, cj - 1);
    j <= Math.min(terrain.cellsZ - 1, cj + 1);
    j++
  ) {
    for (
      let i = Math.max(0, ci - 1);
      i <= Math.min(terrain.cellsX - 1, ci + 1);
      i++
    ) {
      const t = cellTriangles(terrain, i, j);
      for (let k = 0; k < 6; k += 3) {
        const p0 = t[k] * 3;
        const p1 = t[k + 1] * 3;
        const p2 = t[k + 2] * 3;
        const d =
          (v[p1 + 2] - v[p2 + 2]) * (v[p0] - v[p2]) +
          (v[p2] - v[p1]) * (v[p0 + 2] - v[p2 + 2]);
        if (d === 0) continue;
        const l0 =
          ((v[p1 + 2] - v[p2 + 2]) * (x - v[p2]) +
            (v[p2] - v[p1]) * (z - v[p2 + 2])) /
          d;
        const l1 =
          ((v[p2 + 2] - v[p0 + 2]) * (x - v[p2]) +
            (v[p0] - v[p2]) * (z - v[p2 + 2])) /
          d;
        const l2 = 1 - l0 - l1;
        const slack = -1e-6;
        if (l0 >= slack && l1 >= slack && l2 >= slack) {
          return l0 * v[p0 + 1] + l1 * v[p1 + 1] + l2 * v[p2 + 1];
        }
      }
    }
  }
  return landform.height(x, z);
}

/** A lookup for the nearest trail sample, on a coarse grid so each query is cheap. */
function benchIndex(bench: TrailBench) {
  const cell = 8;
  const buckets = new Map<number, number[]>();
  const key = (cx: number, cz: number) => cx * 4096 + cz;
  const { samples } = bench;
  for (let s = 0; s < samples.length; s += 3) {
    const k = key(
      Math.floor(samples[s] / cell),
      Math.floor(samples[s + 1] / cell),
    );
    const list = buckets.get(k);
    if (list) list.push(s);
    else buckets.set(k, [s]);
  }
  return (x: number, z: number): { distance: number; y: number } | null => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = Infinity;
    let bestY = 0;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = buckets.get(key(cx + a, cz + b));
        if (!list) continue;
        for (const s of list) {
          const d = Math.hypot(x - samples[s], z - samples[s + 1]);
          if (d < best) {
            best = d;
            bestY = samples[s + 2];
          }
        }
      }
    }
    return best < bench.outer ? { distance: best, y: bestY } : null;
  };
}

/**
 * How much each vertex lies in the shade of higher ground while the sun is low and off to
 * the left. A ray goes toward the sun; the more ground rises above it, the darker.
 */
function* bakeShade(terrain: Terrain): Steps<Float32Array> {
  const { cellsX, cellsZ, vertices } = terrain;
  const width = stride(cellsX);
  const { minX, maxX, minZ, maxZ } = BOUNDS;
  const dx = (maxX - minX) / cellsX;
  const dz = (maxZ - minZ) / cellsZ;
  const out = new Float32Array(width * (cellsZ + 1));
  const rise = Math.tan((9 * Math.PI) / 180);
  const sample = (x: number, z: number) => {
    const fx = Math.min(cellsX - 1.001, Math.max(0, (x - minX) / dx));
    const fz = Math.min(cellsZ - 1.001, Math.max(0, (z - minZ) / dz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const a = fx - i;
    const b = fz - j;
    const h = (ii: number, jj: number) => vertices[(jj * width + ii) * 3 + 1];
    return (
      h(i, j) * (1 - a) * (1 - b) +
      h(i + 1, j) * a * (1 - b) +
      h(i, j + 1) * (1 - a) * b +
      h(i + 1, j + 1) * a * b
    );
  };
  // Shade changes slowly across the ground, so it is cast from every other vertex and the rest
  // are interpolated: a quarter of the rays for the same picture.
  const step = 3;
  let highest = -Infinity;
  for (let k = 1; k < vertices.length; k += 3)
    highest = Math.max(highest, vertices[k]);
  const skip = 2;
  const columns = Math.ceil(cellsX / skip) + 1;
  const rows = Math.ceil(cellsZ / skip) + 1;
  const coarse = new Float32Array(columns * rows);
  for (let cj = 0; cj < rows; cj++) {
    if (cj % 3 === 0) yield;
    for (let ci = 0; ci < columns; ci++) {
      const i = Math.min(cellsX, ci * skip);
      const j = Math.min(cellsZ, cj * skip);
      const o = (j * width + i) * 3;
      const x = vertices[o];
      const y = vertices[o + 1];
      const z = vertices[o + 2];
      let worst = 0;
      for (let s = 1; s <= 56; s++) {
        const d = s * step;
        const rayY = y + 1.2 + rise * d;
        if (rayY > highest) break;
        const px = x + SUN_AZIMUTH.x * d;
        const pz = z + SUN_AZIMUTH.z * d;
        if (px < minX || px > maxX || pz < minZ || pz > maxZ) break;
        const over = sample(px, pz) - rayY;
        if (over > worst) worst = over;
      }
      coarse[cj * columns + ci] = smoothstep(0, 7, worst);
    }
  }
  for (let j = 0; j <= cellsZ; j++) {
    for (let i = 0; i <= cellsX; i++) {
      const fi = i / skip;
      const fj = j / skip;
      const i0 = Math.min(columns - 2, Math.floor(fi));
      const j0 = Math.min(rows - 2, Math.floor(fj));
      const a = fi - i0;
      const b = fj - j0;
      const c = (jj: number, ii: number) => coarse[jj * columns + ii];
      out[j * width + i] =
        c(j0, i0) * (1 - a) * (1 - b) +
        c(j0, i0 + 1) * a * (1 - b) +
        c(j0 + 1, i0) * (1 - a) * b +
        c(j0 + 1, i0 + 1) * a * b;
    }
  }
  return out;
}

/** The noise used to vary the ground's colour from one face to the next. */
export const faceNoise = createNoise(331);
