import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  Color,
  Float32BufferAttribute,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { createNoise, lerp, mulberry32, ridged, smoothstep } from "./noise";
import type { SceneColors } from "./palette";
import { drain, type Steps } from "./steps";
import { BOUNDS, cellTriangles, faceNoise, type Terrain } from "./terrain";
import type { World } from "./world";

/** Where snow starts, in scene units of height, and where the Summit is. */
export const SNOW_LINE = 84;

/**
 * The ground as flat-shaded triangles, each its own colour: dark rock low down, lighter scree
 * above, snow on the gentler faces above the snow line. `shade` is carried per vertex so the
 * shader can darken what lies in the shadow of higher ground.
 */
export function buildTerrainGeometry(
  terrain: Terrain,
  colors: SceneColors,
): BufferGeometry {
  return drain(terrainGeometrySteps(terrain, colors));
}

/** `buildTerrainGeometry` as pausable work (see `steps.ts`). */
export function* terrainGeometrySteps(
  terrain: Terrain,
  colors: SceneColors,
): Steps<BufferGeometry> {
  const { cellsX, cellsZ, vertices } = terrain;
  const faces = cellsX * cellsZ * 2;
  const positions = new Float32Array(faces * 9);
  const colorData = new Float32Array(faces * 9);
  const shades = new Float32Array(faces * 3);
  const normals = new Float32Array(faces * 9);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const base = new Color();
  const grass = colors.pine.clone().lerp(colors["rock-deep"], 0.55);

  let f = 0;
  for (let j = 0; j < cellsZ; j++) {
    if (j % 6 === 0) yield;
    for (let i = 0; i < cellsX; i++) {
      const tri = cellTriangles(terrain, i, j);
      for (let k = 0; k < 6; k += 3) {
        const i0 = tri[k];
        const i1 = tri[k + 1];
        const i2 = tri[k + 2];
        a.fromArray(vertices, i0 * 3);
        b.fromArray(vertices, i1 * 3);
        c.fromArray(vertices, i2 * 3);
        n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
        if (n.y < 0) n.negate();

        const height = (a.y + b.y + c.y) / 3;
        const cx = (a.x + b.x + c.x) / 3;
        const cz = (a.z + b.z + c.z) / 3;
        const grain = faceNoise(cx * 0.9, cz * 0.9);
        const patch = faceNoise(cx * 0.06 + 11, cz * 0.06);

        // Rock by altitude.
        const low = smoothstep(14, 34, height + patch * 6);
        const high = smoothstep(46, 92, height + patch * 8);
        base.copy(grass).lerp(colors["rock-deep"], low);
        base.lerp(colors.rock, smoothstep(0.1, 0.9, low) * 0.7);
        base.lerp(colors.scree, high * 0.9);
        // Snow settles on gentle faces above the snow line, and clings lower in the hollows.
        const line = SNOW_LINE + patch * 10 + grain * 4;
        const cover =
          smoothstep(line - 4, line + 12, height) *
          smoothstep(0.4, 0.72, n.y + grain * 0.08);
        base.lerp(colors.snow, cover);
        // Face by face variation is what makes it low poly.
        base.multiplyScalar(1 + grain * 0.26);

        const shade =
          (terrain.shade[i0] + terrain.shade[i1] + terrain.shade[i2]) / 3;
        for (const [slot, p] of [a, b, c].entries()) {
          const o = f * 9 + slot * 3;
          positions[o] = p.x;
          positions[o + 1] = p.y;
          positions[o + 2] = p.z;
          colorData[o] = base.r;
          colorData[o + 1] = base.g;
          colorData[o + 2] = base.b;
          normals[o] = n.x;
          normals[o + 1] = n.y;
          normals[o + 2] = n.z;
          shades[f * 3 + slot] = shade;
        }
        f++;
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setAttribute("color", new BufferAttribute(colorData, 3));
  geometry.setAttribute("shade", new BufferAttribute(shades, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The trail as a ribbon lying on the ground it was cut into: a little above the surface,
 * the colour of packed dirt, so it can be followed with the eye all the way up.
 */
export function buildTrailGeometry(world: World): BufferGeometry {
  const { trail, terrain } = world;
  // Fine steps along and across, each point set on the drawn ground, so the ribbon follows every facet.
  const steps = Math.ceil(trail.length / 0.6);
  const across = 4;
  const half = 1.15;
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  const tangent = new Vector3();
  const normal = new Vector3();
  const row = across + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    trail.pointAt(t, point);
    trail.tangentAt(t, tangent);
    normal.set(-tangent.z, 0, tangent.x).normalize();
    for (let k = 0; k <= across; k++) {
      const side = (k / across) * 2 - 1;
      const x = point.x + normal.x * half * side;
      const z = point.z + normal.z * half * side;
      positions.push(x, terrain.heightAt(x, z) + 0.14, z);
    }
    if (s > 0) {
      for (let k = 0; k < across; k++) {
        const a = (s - 1) * row + k;
        const b = a + 1;
        const c = s * row + k;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The layers of far mountains: how far, how tall, and how much of the haze they wear. */
const RANGES = [
  { z: -340, height: 170, depth: 100, seed: 1, mix: 0.0 },
  { z: -540, height: 215, depth: 120, seed: 2, mix: 0.45 },
  { z: -780, height: 260, depth: 140, seed: 3, mix: 0.8 },
];

/**
 * The distant ranges as one geometry: three rows of jagged ridges behind the massif, each
 * paler than the one in front, so the picture has depth. Wide enough to fill the view from
 * anywhere on the trail.
 */
export function buildRangeGeometry(colors: SceneColors): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const stepX = 26;
  const rows = 6;
  for (const range of RANGES) {
    const noise = createNoise(range.seed * 977);
    const columns = Math.round(1700 / stepX);
    const positions: number[] = [];
    const vertexColors: number[] = [];
    const heightAt = (ix: number, row: number) => {
      const x = -850 + ix * stepX;
      const across = row / rows;
      const envelope = Math.sin(across * Math.PI) ** 0.8;
      const ridge = ridged(
        noise,
        x * 0.011,
        range.seed * 3.1 + across * 1.3,
        4,
      );
      const swell = 0.55 + 0.45 * Math.sin(x * 0.0035 + range.seed * 2.3);
      return range.height * envelope * (0.18 + 0.82 * ridge) * swell;
    };
    const near = colors["rock-deep"].clone().lerp(colors.rock, 0.5);
    const far = colors["light-ground"].clone().lerp(colors.rock, 0.25);
    const paint = near.clone().lerp(far, range.mix);
    const snowy = paint.clone().lerp(colors.snow, 0.35);
    const vertex = (ix: number, row: number) => {
      const x = -850 + ix * stepX + (row % 2) * stepX * 0.5;
      const z = range.z + (row / rows - 0.5) * range.depth;
      return new Vector3(x, heightAt(ix, row), z);
    };
    for (let row = 0; row < rows; row++) {
      for (let ix = 0; ix < columns; ix++) {
        const p00 = vertex(ix, row);
        const p10 = vertex(ix + 1, row);
        const p01 = vertex(ix, row + 1);
        const p11 = vertex(ix + 1, row + 1);
        for (const tri of [
          [p00, p01, p10],
          [p10, p01, p11],
        ]) {
          const y = (tri[0].y + tri[1].y + tri[2].y) / 3;
          const color = paint.clone().lerp(snowy, smoothstep(40, 110, y));
          color.multiplyScalar(
            1 + faceNoise(tri[0].x * 0.3, tri[0].z * 0.3) * 0.14,
          );
          for (const p of tri) {
            positions.push(p.x, p.y - 30, p.z);
            vertexColors.push(color.r, color.g, color.b);
          }
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(vertexColors, 3));
    geometry.computeVertexNormals();
    parts.push(geometry);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  merged.computeBoundingSphere();
  return merged;
}

export interface TreePlan {
  /** Per tree: x, y, z, height, width, tint. */
  data: Float32Array;
  count: number;
}

/** Where the pines stand: the low, gentle ground, in clusters, never on the trail. */
export function planTrees(world: World, trailKeepOut = 5): TreePlan {
  return drain(treePlanSteps(world, trailKeepOut));
}

/** `planTrees` as pausable work (see `steps.ts`). */
export function* treePlanSteps(
  world: World,
  trailKeepOut = 5,
): Steps<TreePlan> {
  const random = mulberry32(world.seed * 31 + 5);
  const forest = createNoise(world.seed + 909);
  const { terrain, trail } = world;
  const path: Vector3[] = trail.curve.getSpacedPoints(
    Math.ceil(trail.length / 3),
  );
  const out: number[] = [];
  const { minX, maxX } = BOUNDS;
  for (let attempt = 0; attempt < 5200 && out.length < 6 * 640; attempt++) {
    if (attempt % 400 === 0) yield;
    const x = lerp(minX + 20, maxX - 20, random());
    const z = lerp(-30, 124, random());
    const clump =
      forest(x * 0.022, z * 0.022) + 0.55 * forest(x * 0.07, z * 0.07);
    if (clump < 0.12) continue;
    const y = terrain.heightAt(x, z);
    if (y > 26) continue;
    const slope =
      Math.abs(terrain.heightAt(x + 2, z) - y) +
      Math.abs(terrain.heightAt(x, z + 2) - y);
    if (slope > 2.6) continue;
    let near = Infinity;
    for (const p of path) near = Math.min(near, Math.hypot(p.x - x, p.z - z));
    if (near < trailKeepOut) continue;
    // Thin out toward the treeline.
    if (random() > 1 - smoothstep(14, 26, y)) continue;
    const size =
      lerp(0.8, 1.4, random()) * lerp(1, 0.65, smoothstep(10, 26, y));
    out.push(x, y - 0.2, z, 4.4 * size, 1.6 * size, random());
  }
  return { data: new Float32Array(out), count: out.length / 6 };
}

/** One low-poly pine: two stacked cones, open at the bottom, base at the origin. */
export function buildPineGeometry(): BufferGeometry {
  const lower = new ConeGeometry(1, 2.6, 5, 1, true);
  lower.translate(0, 1.9, 0);
  const upper = new ConeGeometry(0.7, 2.2, 5, 1, true);
  upper.translate(0, 3.2, 0);
  const merged = mergeGeometries([lower, upper], false);
  lower.dispose();
  upper.dispose();
  return merged;
}

/** Stars as points on a far dome, with a size and a brightness each. */
export function buildStarGeometry(count = 2200, seed = 4): BufferGeometry {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const levels = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Uniform on the upper sky, kept off the horizon where the haze would hide them.
    const y = lerp(0.04, 1, Math.sqrt(random()));
    const angle = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(angle) * r * 900;
    positions[i * 3 + 1] = y * 900;
    positions[i * 3 + 2] = Math.sin(angle) * r * 900;
    const bright = random() ** 3;
    sizes[i] = lerp(1.6, 4.2, bright);
    levels[i] = lerp(0.5, 1, bright);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("size", new BufferAttribute(sizes, 1));
  geometry.setAttribute("level", new BufferAttribute(levels, 1));
  return geometry;
}

/** Where High Camp is pitched: the end of the trail, and which way the tents face. */
export function campSite(world: World): { x: number; y: number; z: number } {
  const end = world.trail.pointAt(1);
  return { x: end.x, y: world.terrain.heightAt(end.x, end.z), z: end.z };
}

/**
 * High Camp: two small A-frame tents beside the end of the trail, each a coloured prism
 * resting on the ground. Two geometries' worth of triangles, merged into one draw.
 */
export function buildCampGeometry(
  world: World,
  colors: SceneColors,
): BufferGeometry {
  const site = campSite(world);
  const tents = [
    {
      dx: -4.8,
      dz: 2.2,
      turn: 0.5,
      size: 1,
      color: colors["ember-high-camp"].clone().lerp(colors.snow, 0.15),
    },
    {
      dx: 4.4,
      dz: -1.6,
      turn: -0.35,
      size: 0.82,
      color: colors["ember-ridge"].clone().lerp(colors["first-light"], 0.25),
    },
  ];
  const positions: number[] = [];
  const vertexColors: number[] = [];
  for (const tent of tents) {
    const cx = site.x + tent.dx;
    const cz = site.z + tent.dz;
    const half = 1.6 * tent.size;
    const length = 2.3 * tent.size;
    const rise = 2.3 * tent.size;
    const cos = Math.cos(tent.turn);
    const sin = Math.sin(tent.turn);
    const at = (lx: number, ly: number, lz: number) => {
      const x = cx + lx * cos - lz * sin;
      const z = cz + lx * sin + lz * cos;
      return new Vector3(x, world.terrain.heightAt(x, z) + ly - 0.15, z);
    };
    const base = world.terrain.heightAt(cx, cz);
    const corner = (lx: number, lz: number) => {
      const p = at(lx, 0, lz);
      p.y = base - 0.15;
      return p;
    };
    const a = corner(-half, -length);
    const b = corner(half, -length);
    const c = corner(half, length);
    const d = corner(-half, length);
    const top0 = at(0, rise, -length);
    top0.y = base + rise;
    const top1 = at(0, rise, length);
    top1.y = base + rise;
    const faces: Vector3[][] = [
      [a, top0, b],
      [d, c, top1],
      [a, d, top1, top0],
      [b, top0, top1, c],
    ];
    for (const face of faces) {
      const tris =
        face.length === 3
          ? [face]
          : [
              [face[0], face[1], face[2]],
              [face[0], face[2], face[3]],
            ];
      for (const tri of tris) {
        for (const p of tri) positions.push(p.x, p.y, p.z);
        for (let k = 0; k < 3; k++)
          vertexColors.push(tent.color.r, tent.color.g, tent.color.b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(vertexColors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
