import { describe, expect, it } from "vitest";

import { createSlowWatch } from "./frameWatch";

/** Feed `count` frames; returns the index of the frame that tripped it, or -1. */
function run(
  watch: ReturnType<typeof createSlowWatch>,
  ms: number,
  count: number,
  scrolling = true,
) {
  for (let i = 0; i < count; i++) if (watch.push(ms, scrolling)) return i;
  return -1;
}

describe("noticing slow frames", () => {
  it("stays quiet at a steady 60 frames a second", () => {
    expect(run(createSlowWatch(), 16.7, 500)).toBe(-1);
  });

  it("trips when frames stay slow while scrolling", () => {
    expect(run(createSlowWatch(), 90, 100)).toBeGreaterThan(-1);
  });

  it("does not trip on slow frames when the Visitor is not scrolling", () => {
    expect(run(createSlowWatch(), 90, 200, false)).toBe(-1);
  });

  it("ignores the first frames, which compile shaders", () => {
    const watch = createSlowWatch({ warmup: 6, window: 4, needed: 4 });
    expect(run(watch, 200, 6)).toBe(-1);
    expect(run(watch, 200, 4)).toBe(3);
  });

  it("ignores a stall of over a second, which says nothing about the device", () => {
    expect(run(createSlowWatch(), 2500, 200)).toBe(-1);
  });

  it("does not trip on an occasional slow frame", () => {
    const watch = createSlowWatch();
    let tripped = false;
    for (let i = 0; i < 400; i++) {
      tripped ||= watch.push(i % 8 === 0 ? 120 : 16, true);
    }
    expect(tripped).toBe(false);
  });

  it("forgives a slow patch that recovers", () => {
    const watch = createSlowWatch({ warmup: 0 });
    run(watch, 90, 10);
    expect(run(watch, 16, 100)).toBe(-1);
  });
});
