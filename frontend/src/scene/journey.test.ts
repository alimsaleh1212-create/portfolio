import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import {
  fieldOfView,
  journeyAt,
  keepInFrame,
  poseAt,
  POSE_KEYS,
  progressAt,
  settle,
  stepJourney,
  trailTAt,
} from "./journey";
import { STAGE_KEYS, STAGE_TRAIL_T } from "./trail";

// Stages measured from a page whose Ridge is long: places along the Climb, 0 to 1.
const stages = [
  { key: "trailhead", position: 0 },
  { key: "long-approach", position: 0.2 },
  { key: "steep-switch", position: 0.4 },
  { key: "ridge", position: 0.8 },
  { key: "high-camp", position: 1 },
];

const at = (progress: number, lead = 1, tail = 0) => ({
  progress,
  lead,
  tail,
  stages,
});

describe("the journey", () => {
  it("is 0 at the top of the page and 1 at the Trailhead, through the opening screen", () => {
    expect(journeyAt(at(0, 0))).toBe(0);
    expect(journeyAt(at(0, 0.5))).toBe(0.5);
    expect(journeyAt(at(0, 1))).toBe(1);
  });

  it("is 1 to 5 across the Stages, by where each really sits on the page", () => {
    expect(journeyAt(at(0.0001))).toBeCloseTo(1, 2);
    expect(journeyAt(at(0.2))).toBeCloseTo(2, 6);
    expect(journeyAt(at(0.4))).toBeCloseTo(3, 6);
    expect(journeyAt(at(0.6))).toBeCloseTo(3.5, 6);
    expect(journeyAt(at(0.8))).toBeCloseTo(4, 6);
    expect(journeyAt(at(1))).toBeCloseTo(5, 6);
  });

  it("is 5 to 6 across the Summit's stretch", () => {
    expect(journeyAt(at(1, 1, 0))).toBe(5);
    expect(journeyAt(at(1, 1, 0.5))).toBe(5.5);
    expect(journeyAt(at(1, 1, 1))).toBe(6);
  });

  it("has no jump at the joins between the opening, the Stages and the Summit", () => {
    expect(journeyAt(at(0, 1))).toBeCloseTo(journeyAt(at(0.0001)), 2);
    expect(journeyAt(at(0.9999))).toBeCloseTo(journeyAt(at(1, 1, 0)), 2);
  });

  it("falls back to even Stages before the page has measured them", () => {
    const unmeasured = { progress: 0.5, lead: 1, tail: 0, stages: [] };
    expect(journeyAt(unmeasured)).toBeCloseTo(3, 6);
  });

  it("maps back to the progress value and to a place on the trail", () => {
    for (const u of [1, 2, 3, 3.5, 4, 5]) {
      const progress = progressAt(u, stages);
      expect(journeyAt(at(progress))).toBeCloseTo(u, 6);
    }
    expect(progressAt(0.5, stages)).toBe(0);
    expect(progressAt(6, stages)).toBe(1);
    expect(trailTAt(0, stages)).toBe(0);
    expect(trailTAt(1, stages)).toBe(1);
    expect(trailTAt(0.2, stages)).toBeCloseTo(
      STAGE_TRAIL_T["long-approach"],
      6,
    );
    expect(trailTAt(0.8, stages)).toBeCloseTo(STAGE_TRAIL_T.ridge, 6);
    expect(STAGE_KEYS).toHaveLength(5);
  });
});

describe("settling", () => {
  it("is the identity at each Stage, and eases between them", () => {
    for (let u = 0; u <= 6; u++) expect(settle(u)).toBeCloseTo(u, 9);
    expect(settle(0.5)).toBeCloseTo(0.5, 9);
    expect(settle(0.1)).toBeLessThan(0.1);
    expect(settle(0.9)).toBeGreaterThan(0.9);
  });

  it("is slow near a Stage and quick between", () => {
    const near = settle(2.05) - settle(2);
    const between = settle(2.55) - settle(2.5);
    expect(near).toBeLessThan(between / 4);
  });

  it("never goes backward as the journey advances", () => {
    let last = -1;
    for (let u = 0; u <= 6; u += 0.01) {
      expect(settle(u)).toBeGreaterThanOrEqual(last);
      last = settle(u);
    }
  });
});

describe("easing toward the page", () => {
  it("moves toward the target, never past it, and lands on it exactly", () => {
    let u = 0;
    for (let i = 0; i < 400; i++) {
      u = stepJourney(u, 3, 1 / 60);
      expect(u).toBeLessThanOrEqual(3);
    }
    expect(u).toBe(3);
  });

  it("does not trail far behind: most of the way within a quarter of a second", () => {
    let u = 0;
    for (let i = 0; i < 15; i++) u = stepJourney(u, 1, 1 / 60);
    expect(u).toBeGreaterThan(0.7);
  });

  it("comes back to exactly where it was when the page does", () => {
    let u = 2;
    for (let i = 0; i < 500; i++) u = stepJourney(u, 4.25, 1 / 60);
    for (let i = 0; i < 500; i++) u = stepJourney(u, 2, 1 / 60);
    expect(u).toBe(2);
    expect(poseAt(u, false).position.toArray()).toEqual(
      poseAt(2, false).position.toArray(),
    );
  });
});

describe("the camera", () => {
  it("is at each key's composition at the opening screen, each Stage and the Summit", () => {
    POSE_KEYS.forEach((key, u) => {
      const pose = poseAt(u, false);
      expect(
        pose.position.distanceTo(new Vector3(...key.position)),
      ).toBeLessThan(1e-6);
      expect(pose.target.distanceTo(new Vector3(...key.target))).toBeLessThan(
        1e-6,
      );
      expect(pose.fov).toBeCloseTo(key.fov, 9);
      expect(pose.shift.x).toBeCloseTo(key.wide[0], 9);
    });
    expect(POSE_KEYS).toHaveLength(7);
  });

  it("moves the mountain to the free side: the text is left, right, left, left, right", () => {
    const shifts = [1, 2, 3, 4, 5].map((u) => poseAt(u, false).shift.x);
    expect(Math.sign(shifts[0])).toBe(1);
    expect(Math.sign(shifts[1])).toBe(-1);
    expect(Math.sign(shifts[2])).toBe(1);
    expect(Math.sign(shifts[3])).toBe(1);
    expect(Math.sign(shifts[4])).toBe(-1);
  });

  it("shifts only slightly sideways on narrow screens, where the text runs across", () => {
    // Only to put the Hiker out of frame at a Stage where text fills the width (see CLAUDE.md).
    for (let u = 0; u <= 6; u++)
      expect(Math.abs(poseAt(u, true).shift.x)).toBeLessThanOrEqual(0.35);
  });

  it("climbs: each Stage's camera is higher than the one before", () => {
    const heights = [1, 2, 3, 4, 5].map((u) => poseAt(u, false).position.y);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });

  it("is a smooth path: no jump between nearby points", () => {
    let last = poseAt(0, false).position;
    for (let u = 0.02; u <= 6; u += 0.02) {
      const p = poseAt(u, false).position;
      expect(p.distanceTo(last)).toBeLessThan(8);
      last = p;
    }
  });

  it("is a wider view on a narrow screen", () => {
    expect(fieldOfView(50, 1.6)).toBe(50);
    expect(fieldOfView(50, 0.5)).toBeGreaterThan(50);
  });
});

describe("keepInFrame", () => {
  const bounds = { x: [-0.5, 0.5], y: [-0.7, 0.2] } as const;
  it("leaves a shift alone while the Hiker stays inside the bounds", () => {
    expect(keepInFrame({ x: 0.1, y: -0.2 }, { x: 0.1, y: 0 }, bounds)).toEqual({
      x: 0.1,
      y: 0,
    });
  });
  it("pulls a Hiker that is off to the left back to the edge", () => {
    const shift = keepInFrame({ x: -1.4, y: 0 }, { x: 0, y: 0 }, bounds);
    expect(-1.4 + 2 * shift.x).toBeCloseTo(-0.5);
  });
  it("lifts a Hiker that is below the screen and lowers one above it", () => {
    expect(
      -1.3 + 2 * keepInFrame({ x: 0, y: -1.3 }, { x: 0, y: 0 }, bounds).y,
    ).toBeCloseTo(-0.7);
    expect(
      0.9 + 2 * keepInFrame({ x: 0, y: 0.9 }, { x: 0, y: 0 }, bounds).y,
    ).toBeCloseTo(0.2);
  });
});
