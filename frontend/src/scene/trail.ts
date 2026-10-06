import { CatmullRomCurve3, Vector3 } from "three";

import type { Landform } from "./landform";
import type { TrailBench } from "./terrain";

/** The five Stages, in Climb order. These are CONTEXT.md's Stage keys. */
export const STAGE_KEYS = [
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

/**
 * Where the trail goes on the ground, as x and z. It leaves the meadow, rolls through the
 * foothills, switches back up the steep wall, follows the ridge and ends at High Camp.
 */
const WAYPOINTS: Array<[number, number]> = [
  [-6, 98],
  [-14, 84],
  [-2, 70],
  [12, 58],
  [4, 44],
  [-16, 32],
  [-26, 18],
  [-12, 6],
  [12, -4],
  [24, -16],
  [8, -26],
  [-16, -32],
  [14, -40],
  [-18, -48],
  [12, -56],
  [-14, -64],
  [10, -72],
  [-12, -80],
  [6, -88],
];

/** Where each Stage sits along the trail, 0 at the Trailhead and 1 at High Camp. */
export const STAGE_TRAIL_T: Record<StageKey, number> = {
  trailhead: 0,
  "long-approach": 0.24,
  "steep-switch": 0.5,
  ridge: 0.76,
  "high-camp": 1,
};

export interface Trail {
  /** The path the Hiker walks, from the Trailhead to High Camp. Parameter 0 to 1 by arc length. */
  curve: CatmullRomCurve3;
  /** Its length in scene units. */
  length: number;
  /** A point on the trail, `t` from 0 (Trailhead) to 1 (High Camp). */
  pointAt: (t: number, target?: Vector3) => Vector3;
  /** The direction of travel at `t`, as a unit vector. */
  tangentAt: (t: number, target?: Vector3) => Vector3;
}

/** Smooth a series with a moving average, keeping its ends where they are. */
function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const index = Math.min(values.length - 1, Math.max(0, i + k));
      const w = radius + 1 - Math.abs(k);
      sum += values[index] * w;
      weight += w;
    }
    return sum / weight;
  });
}

/** Plan the trail over the ground, before the trail is cut into it. */
export function planTrail(landform: Landform): {
  trail: Trail;
  bench: TrailBench;
} {
  // The path in x and z, smooth, then its heights from the ground, smoothed so the grade is gentle.
  const flat = new CatmullRomCurve3(
    WAYPOINTS.map(([x, z]) => new Vector3(x, 0, z)),
    false,
    "centripetal",
  );
  const count = Math.ceil(flat.getLength() / 1.5);
  const rough = flat.getSpacedPoints(count);
  const ys = smooth(
    rough.map((p) => landform.height(p.x, p.z) + 0.1),
    10,
  );
  const points = rough.map((p, i) => new Vector3(p.x, ys[i], p.z));
  // Fewer control points make a smoother curve than every sample would.
  const control = points.filter(
    (_, i) => i % 4 === 0 || i === points.length - 1,
  );
  const curve = new CatmullRomCurve3(control, false, "centripetal");
  const length = curve.getLength();

  const trail: Trail = {
    curve,
    length,
    pointAt: (t, target = new Vector3()) =>
      curve.getPointAt(Math.min(1, Math.max(0, t)), target),
    tangentAt: (t, target = new Vector3()) =>
      curve.getTangentAt(Math.min(1, Math.max(0, t)), target),
  };

  const along = curve.getSpacedPoints(Math.ceil(length / 1.2));
  const samples = new Float32Array(along.length * 3);
  along.forEach((p, i) => {
    samples[i * 3] = p.x;
    samples[i * 3 + 1] = p.z;
    samples[i * 3 + 2] = p.y;
  });
  return { trail, bench: { samples, inner: 2.2, outer: 6.5 } };
}
