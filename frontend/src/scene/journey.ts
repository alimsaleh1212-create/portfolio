import { CatmullRomCurve3, Vector3 } from "three";

import type { ClimbState } from "../climb/climb";
import { JOURNEY_LENGTH } from "./light";
import { lerp } from "./noise";
import { STAGE_KEYS, STAGE_TRAIL_T } from "./trail";

/**
 * The journey is one number, `u`: 0 on the opening screen, 1 to 5 at the five Stages and 6
 * at the Summit. The camera and the light are both pure functions of it.
 */

/** Spacing for the Stages when the page has not measured them yet. */
const EVEN = STAGE_KEYS.map((_, i) => i / (STAGE_KEYS.length - 1));

/**
 * Where the Visitor is on the journey, from the Climb's position. The opening screen is 0 to
 * 1 (`lead`), the Stages 1 to 5 by where each really sits on the page, and the Summit's
 * stretch 5 to 6 (`tail`). Continuous at the joins, so scrolling back reverses it exactly.
 */
export function journeyAt(
  climb: Pick<ClimbState, "progress" | "lead" | "tail" | "stages">,
): number {
  const { progress } = climb;
  if (progress <= 0) return climb.lead;
  if (progress >= 1) return STAGE_KEYS.length + climb.tail;
  const marks = marksOf(climb.stages);
  for (let i = 0; i < marks.length - 1; i++) {
    if (progress <= marks[i + 1]) {
      const span = marks[i + 1] - marks[i];
      return 1 + i + (span > 0 ? (progress - marks[i]) / span : 0);
    }
  }
  return STAGE_KEYS.length;
}

/** The Stages' progress values, falling back to even spacing before the page is measured. */
function marksOf(stages: ClimbState["stages"]): number[] {
  return stages.length === STAGE_KEYS.length
    ? stages.map((s) => s.position)
    : EVEN;
}

/** The progress value for a point on the journey: the inverse of `journeyAt` across the Stages. */
export function progressAt(u: number, stages: ClimbState["stages"]): number {
  if (u <= 1) return 0;
  if (u >= STAGE_KEYS.length) return 1;
  const marks = marksOf(stages);
  const i = Math.min(marks.length - 2, Math.floor(u - 1));
  return lerp(marks[i], marks[i + 1], u - 1 - i);
}

/** Where on the trail (0 to 1) the Hiker is for a progress value, through the Stages' places. */
export function trailTAt(
  progress: number,
  stages: ClimbState["stages"],
): number {
  const marks = marksOf(stages);
  const ts = STAGE_KEYS.map((key) => STAGE_TRAIL_T[key]);
  if (progress <= marks[0]) return ts[0];
  if (progress >= marks[marks.length - 1]) return ts[ts.length - 1];
  for (let i = 0; i < marks.length - 1; i++) {
    if (progress <= marks[i + 1]) {
      const span = marks[i + 1] - marks[i];
      return lerp(
        ts[i],
        ts[i + 1],
        span > 0 ? (progress - marks[i]) / span : 0,
      );
    }
  }
  return ts[ts.length - 1];
}

/**
 * Slows the camera to a stop at each Stage: within each leg the journey is eased in and out,
 * so a Visitor reading a Stage sees a settled view and the camera spends its travel between them.
 */
export function settle(u: number): number {
  const clamped = Math.min(JOURNEY_LENGTH, Math.max(0, u));
  const i = Math.min(JOURNEY_LENGTH - 1, Math.floor(clamped));
  const f = clamped - i;
  return i + f * f * (3 - 2 * f);
}

/**
 * Moves `current` toward `target` by an exponential ease: quick enough that the camera never
 * trails the scroll by much, soft enough never to jerk. Lands exactly on the target, so the
 * view at rest depends only on where the page is, not on how it got there.
 */
export function stepJourney(
  current: number,
  target: number,
  seconds: number,
  rate = 11,
): number {
  const gap = target - current;
  if (Math.abs(gap) < 0.0004) return target;
  return current + gap * (1 - Math.exp(-rate * Math.min(seconds, 0.25)));
}

/** A view of the mountain: where the camera is, what it looks at, how wide, and how the picture is framed. */
export interface Pose {
  position: Vector3;
  target: Vector3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Slides the picture sideways and up, as a fraction of the screen: where the mountain's interest falls. */
  shift: { x: number; y: number };
}

interface PoseKey {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** Shift on screens wide enough for a text column beside the scene. */
  wide: [number, number];
  /** Shift on narrow screens, where the text runs across. */
  narrow: [number, number];
}

/**
 * The composition at the opening screen, the five Stages and the Summit. The text column
 * alternates sides (left, right, left, left, right), so the mountain's interest goes to the
 * other side by shifting the picture. Positions are in scene units.
 */
export const POSE_KEYS: PoseKey[] = [
  {
    position: [-3.2, 12.7, 157.4],
    target: [14, 60, -110],
    fov: 44,
    wide: [0.22, -0.02],
    narrow: [0, -0.14],
  },
  {
    position: [-12.3, 6.9, 158.9],
    target: [12, 64, -100],
    fov: 44,
    wide: [0.2, -0.03],
    narrow: [0, -0.18],
  },
  {
    position: [-10.8, 10.1, 66.3],
    target: [-6, 58, -90],
    fov: 50,
    wide: [-0.22, 0],
    narrow: [-0.16, -0.1],
  },
  {
    position: [6.9, 20.1, 7.5],
    target: [4, 56, -76],
    fov: 56,
    wide: [0.23, 0],
    narrow: [0, -0.04],
  },
  {
    position: [35.7, 25.3, -28.5],
    target: [8, 78, -112],
    fov: 58,
    wide: [0.14, -0.04],
    narrow: [0, 0.1],
  },
  {
    position: [-3.8, 44.8, -56.4],
    target: [2, 96, -112],
    fov: 52,
    wide: [-0.22, 0.03],
    narrow: [0.32, -0.06],
  },
  {
    position: [-9.6, 21.3, -26.4],
    target: [8, 103.1, -131],
    fov: 38.9,
    wide: [0.16, 0.14],
    narrow: [0, 0.18],
  },
];

const positionCurve = new CatmullRomCurve3(
  POSE_KEYS.map((k) => new Vector3(...k.position)),
  false,
  "centripetal",
);
const targetCurve = new CatmullRomCurve3(
  POSE_KEYS.map((k) => new Vector3(...k.target)),
  false,
  "centripetal",
);

/** The camera's view at `u` on the journey. `narrow` picks the framing for screens with no side column. */
export function poseAt(u: number, narrow: boolean): Pose {
  const s = settle(u);
  const i = Math.min(JOURNEY_LENGTH - 1, Math.floor(s));
  const f = s - i;
  const a = POSE_KEYS[i];
  const b = POSE_KEYS[i + 1];
  const pick = (k: PoseKey) => (narrow ? k.narrow : k.wide);
  return {
    position: positionCurve.getPoint(s / JOURNEY_LENGTH),
    target: targetCurve.getPoint(s / JOURNEY_LENGTH),
    fov: lerp(a.fov, b.fov, f),
    shift: {
      x: lerp(pick(a)[0], pick(b)[0], f),
      y: lerp(pick(a)[1], pick(b)[1], f),
    },
  };
}

/** A narrow screen is shown a wider view, so the mountain is not cropped to a sliver. */
export function fieldOfView(fov: number, aspect: number): number {
  const minHorizontal = (36 * Math.PI) / 180;
  const needed =
    (2 * Math.atan(Math.tan(minHorizontal / 2) / Math.max(aspect, 0.2)) * 180) /
    Math.PI;
  return Math.max(fov, needed);
}
