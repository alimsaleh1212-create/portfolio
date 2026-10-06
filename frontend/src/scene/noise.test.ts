import { describe, expect, it } from "vitest";

import { createNoise, fbm, mulberry32, ridged } from "./noise";

describe("seeded randomness", () => {
  it("gives the same sequence for the same seed, and a different one for another", () => {
    const a = mulberry32(9);
    const b = mulberry32(9);
    const c = mulberry32(10);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });

  it("stays in [0, 1)", () => {
    const random = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("noise", () => {
  it("is the same for the same seed and different for another", () => {
    const a = createNoise(1);
    const b = createNoise(1);
    const c = createNoise(2);
    expect(a(3.3, 4.1)).toBe(b(3.3, 4.1));
    expect(a(3.3, 4.1)).not.toBe(c(3.3, 4.1));
  });

  it("is continuous and bounded", () => {
    const noise = createNoise(5);
    let last = noise(0, 0);
    for (let i = 1; i < 2000; i++) {
      const v = noise(i * 0.01, i * 0.007);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(v - last)).toBeLessThan(0.1);
      last = v;
    }
  });

  it("layers and creases stay in range", () => {
    const noise = createNoise(8);
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(fbm(noise, i * 0.3, i * 0.1, 4))).toBeLessThanOrEqual(
        1.5,
      );
      const r = ridged(noise, i * 0.3, i * 0.1, 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
