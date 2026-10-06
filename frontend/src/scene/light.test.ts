import { describe, expect, it } from "vitest";
import type { Color } from "three";

import { readTokens } from "../design/tokens";
import { JOURNEY_LENGTH, lightAt } from "./light";
import { readSceneColors, SCENE_COLOR_NAMES } from "./palette";

const tokens = readTokens();
const colors = readSceneColors((name) => tokens.get(`--color-${name}`) ?? "");

const apart = (a: Color, b: Color) =>
  Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

const STAGES = [
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
] as const;

describe("the scene's colours", () => {
  it("are all design tokens in the stylesheet", () => {
    for (const name of SCENE_COLOR_NAMES) {
      expect(tokens.has(`--color-${name}`), name).toBe(true);
    }
  });

  it("are refused when a token is missing, rather than drawn wrong", () => {
    expect(() => readSceneColors(() => "")).toThrow(/--color-/);
  });
});

describe("the light", () => {
  it("is the Stage's own sky overhead at each Stage, the same colour as the page behind the text", () => {
    STAGES.forEach((stage, i) => {
      const light = lightAt(i + 1, colors);
      expect(light.top.getHex()).toBe(colors[`light-${stage}`].getHex());
    });
    expect(lightAt(JOURNEY_LENGTH, colors).top.getHex()).toBe(
      colors["light-summit"].getHex(),
    );
  });

  it("is pre-dawn at the Trailhead: stars out, the sun well below the horizon, no first light", () => {
    const light = lightAt(0, colors);
    expect(light.stars).toBe(1);
    expect(light.sunDirection.y).toBeLessThan(-0.2);
    expect(light.discStrength).toBe(0);
    expect(light.summitGlow).toBeLessThan(0.2);
  });

  it("is sunrise at High Camp: no stars, the Summit lit, the sun at the horizon", () => {
    const light = lightAt(5, colors);
    expect(light.stars).toBe(0);
    expect(light.summitGlow).toBeGreaterThan(0.8);
    expect(Math.abs(light.sunDirection.y)).toBeLessThan(0.1);
    expect(light.horizon.getHex()).toBe(colors["ember-high-camp"].getHex());
  });

  it("changes at every Stage, not only at the end", () => {
    for (let u = 0; u < JOURNEY_LENGTH; u++) {
      const a = lightAt(u, colors);
      const b = lightAt(u + 1, colors);
      const moved =
        Math.abs(a.stars - b.stars) +
        Math.abs(a.glowStrength - b.glowStrength) +
        Math.abs(a.summitGlow - b.summitGlow) +
        apart(a.horizon, b.horizon) +
        apart(a.top, b.top);
      expect(moved, `between ${u} and ${u + 1}`).toBeGreaterThan(0.05);
    }
  });

  it("warms and brightens one way as the Climb goes on: stars fade, the glow and the Summit's light grow", () => {
    let stars = 2;
    let glow = -1;
    let summit = -1;
    for (let u = 0; u <= JOURNEY_LENGTH; u += 0.1) {
      const light = lightAt(u, colors);
      expect(light.stars).toBeLessThanOrEqual(stars + 1e-9);
      expect(light.glowStrength).toBeGreaterThanOrEqual(glow - 1e-9);
      expect(light.summitGlow).toBeGreaterThanOrEqual(summit - 1e-9);
      stars = light.stars;
      glow = light.glowStrength;
      summit = light.summitGlow;
    }
  });

  it("never lights the mountain from below the ground", () => {
    for (let u = 0; u <= JOURNEY_LENGTH; u += 0.25) {
      expect(lightAt(u, colors).keyDirection.y).toBeGreaterThan(0.1);
    }
  });

  it("is a pure function of where the journey is", () => {
    expect(lightAt(2.4, colors).fog.getHex()).toBe(
      lightAt(2.4, colors).fog.getHex(),
    );
    expect(lightAt(-3, colors).stars).toBe(lightAt(0, colors).stars);
    expect(lightAt(9, colors).stars).toBe(lightAt(6, colors).stars);
  });
});
