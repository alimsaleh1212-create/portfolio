import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { computeFingerprint } from "../../scripts/stills-fingerprint.mjs";

const root = resolve(__dirname, "../../..");
const STILLS = resolve(root, "content/stills");

describe("the still images", () => {
  it("are in step with the scene they were captured from", () => {
    const recorded = JSON.parse(
      readFileSync(resolve(STILLS, "stills.json"), "utf8"),
    ) as { fingerprint: string };
    // If this fails the scene, the Hiker's model, the scene's colours or the capture script
    // changed since the pictures were taken. Start the stack, run `npm run stills` in
    // frontend/, look at the new pictures and commit content/stills/.
    expect(
      computeFingerprint(root),
      "The scene changed since the stills were captured: run `npm run stills` (stack up) and commit content/stills/",
    ).toBe(recorded.fingerprint);
  });

  it("are all there: the opening screen, five Stages and the Summit, wide and narrow", () => {
    const names = [
      "opening",
      "trailhead",
      "long-approach",
      "steep-switch",
      "ridge",
      "high-camp",
      "summit",
    ].flatMap((position) =>
      ["wide", "narrow"].map((side) => `${position}-${side}.png`),
    );
    expect(names).toHaveLength(14);
    for (const name of names) {
      expect(existsSync(resolve(STILLS, name)), name).toBe(true);
    }
  });
});
