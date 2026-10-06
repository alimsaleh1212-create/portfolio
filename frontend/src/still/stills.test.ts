import { describe, expect, it } from "vitest";

import { media, stillsItem } from "../test/fixtures";
import {
  sourcesFor,
  STILL_POSITIONS,
  stillOpacity,
  stillsWanted,
} from "./stills";

describe("which pictures are showing", () => {
  it("shows the opening picture alone at the top", () => {
    expect(STILL_POSITIONS.map((_, k) => stillOpacity(0, k, false))).toEqual([
      1, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("rests on a Stage's picture at the Stage, and has the earlier ones under it", () => {
    expect(STILL_POSITIONS.map((_, k) => stillOpacity(3, k, false))).toEqual([
      1, 1, 1, 1, 0, 0, 0,
    ]);
  });

  it("fades the next picture in through the middle of the way, not at the ends", () => {
    expect(stillOpacity(2.2, 3, false)).toBe(0);
    expect(stillOpacity(2.5, 3, false)).toBeCloseTo(0.5);
    expect(stillOpacity(2.8, 3, false)).toBe(1);
    const steps = [2.3, 2.4, 2.5, 2.6, 2.7].map((u) =>
      stillOpacity(u, 3, false),
    );
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it("changes without a fade when reduced motion is requested", () => {
    const seen = new Set<number>();
    for (let u = 0; u <= 6; u += 0.05) {
      for (let k = 0; k < 7; k++) seen.add(stillOpacity(u, k, true));
    }
    expect([...seen].sort()).toEqual([0, 1]);
    expect(stillOpacity(2.4, 3, true)).toBe(0);
    expect(stillOpacity(2.6, 3, true)).toBe(1);
  });

  it("reverses exactly when scrolling back", () => {
    expect(stillOpacity(2.6, 3, false)).toBe(stillOpacity(2.6, 3, false));
    expect(stillOpacity(2.0, 3, false)).toBe(0);
  });
});

describe("which pictures are asked for", () => {
  it("asks for the opening picture and the next, and no further", () => {
    expect(stillsWanted(0)).toEqual([0, 1]);
    expect(stillsWanted(2.5)).toEqual([0, 1, 2, 3, 4]);
    expect(stillsWanted(6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("a picture's sources", () => {
  it("has no sources where the pictures were not seeded", () => {
    expect(sourcesFor(media, "ridge", "wide")).toBeNull();
  });

  it("lists each format narrowest first, and falls back to the widest JPEG", () => {
    const sources = sourcesFor([...media, stillsItem], "ridge", "wide");
    expect(sources?.sources.map((source) => source.type)).toEqual([
      "image/avif",
      "image/webp",
      "image/jpeg",
    ]);
    expect(sources?.sources[0].srcSet).toBe(
      "/media/ridge-wide-w640-avif 640w, /media/ridge-wide-w1024-avif 1024w, /media/ridge-wide-w1600-avif 1600w",
    );
    expect(sources?.fallback.width).toBe(1600);
  });

  it("keeps the narrow composition's own sizes", () => {
    const sources = sourcesFor([...media, stillsItem], "ridge", "narrow");
    expect(sources?.fallback.width).toBe(585);
  });
});
