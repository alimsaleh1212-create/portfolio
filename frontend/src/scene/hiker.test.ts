import { describe, expect, it } from "vitest";

import {
  headingOf,
  lanternAmount,
  phaseAt,
  turnBetween,
  type Gait,
} from "./hiker";

describe("the Hiker's heading", () => {
  it("looks along a direction on the ground, 0 facing +z", () => {
    expect(headingOf(0, 1)).toBeCloseTo(0);
    expect(headingOf(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(headingOf(0, -1))).toBeCloseTo(Math.PI);
  });

  it("turns the short way round, never more than a half turn", () => {
    expect(turnBetween(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(turnBetween(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(Math.abs(turnBetween(0, 3 * Math.PI))).toBeCloseTo(Math.PI);
    expect(turnBetween(1, 1)).toBeCloseTo(0);
  });

  it("turns around when the way reverses", () => {
    const up = headingOf(0.3, -1);
    const back = headingOf(-0.3, 1);
    expect(Math.abs(turnBetween(up, back))).toBeCloseTo(Math.PI);
  });
});

describe("the walk against the ground", () => {
  // A cycle whose planted foot moves unevenly: fast at first, slow at the end.
  const gait: Gait = { stride: 1, travel: [0, 0.5, 0.8, 0.9, 1] };

  it("starts at the start of the cycle and wraps after each stride", () => {
    expect(phaseAt(gait, 0)).toBeCloseTo(0);
    expect(phaseAt(gait, 1)).toBeCloseTo(0);
    expect(phaseAt(gait, 2.25)).toBeCloseTo(phaseAt(gait, 0.25));
  });

  it("spends little of the cycle where the foot covers a lot of ground", () => {
    // Half the stride's ground is covered in the first quarter of the cycle.
    expect(phaseAt(gait, 0.5)).toBeCloseTo(0.25);
    expect(phaseAt(gait, 0.9)).toBeCloseTo(0.75);
  });

  it("only moves forward as the ground goes by", () => {
    let before = -1;
    for (let ground = 0; ground < 0.999; ground += 0.01) {
      const phase = phaseAt(gait, ground);
      expect(phase).toBeGreaterThanOrEqual(before);
      before = phase;
    }
  });

  it("stands still for a model with no walk to measure", () => {
    expect(phaseAt({ stride: 0, travel: [0, 0] }, 3)).toBe(0);
  });
});

describe("the lantern", () => {
  it("burns while stars show and is out by day", () => {
    expect(lanternAmount(1)).toBe(1);
    expect(lanternAmount(0.45)).toBeGreaterThan(0.5);
    expect(lanternAmount(0)).toBe(0);
  });
});
