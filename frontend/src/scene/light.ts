import { Color, Vector3 } from "three";

import { lerp } from "./noise";
import type { SceneColorName, SceneColors } from "./palette";
import { SUN_AZIMUTH } from "./terrain";

/**
 * The light at one point of the journey, as plain values the scene copies onto its sky,
 * fog and lamps. `u` runs 0 (the opening screen) to 6 (the Summit), with the five Stages
 * at 1 to 5 (see journey.ts).
 */
export interface SceneLight {
  top: Color;
  horizon: Color;
  glow: Color;
  fog: Color;
  mist: Color;
  /** Where the sun is, as a direction from the viewer. Below the horizon until late. */
  sunDirection: Vector3;
  glowStrength: number;
  /** The sun's disc, once it clears the far ranges. */
  discStrength: number;
  stars: number;
  /** The lamp that lights the mountain: moonlit blue first, then warming to sunrise. */
  keyColor: Color;
  keyIntensity: number;
  keyDirection: Vector3;
  fillColor: Color;
  fillIntensity: number;
  skyAmbient: Color;
  groundAmbient: Color;
  ambientIntensity: number;
  /** How thick the mist lies in the valleys, 0 to 1. */
  mistAmount: number;
  /** First light on the Summit's snow, 0 to 1. */
  summitGlow: number;
}

interface LightKey {
  top: SceneColorName;
  horizon: SceneColorName;
  /** How far the horizon is lifted toward the cool of the snow: the pale band of the blue hour. */
  lift: number;
  /** How far the horizon's glow is pulled toward the colour of the sun, 0 to 1. */
  warmth: number;
  sunElevation: number;
  glowStrength: number;
  disc: number;
  stars: number;
  keyIntensity: number;
  /** The cool lamp from the camera's side that lights the faces the sun cannot reach. */
  fillIntensity: number;
  ambientIntensity: number;
  mist: number;
  summitGlow: number;
}

/**
 * One key per place on the journey: the opening screen, the five Stages, the Summit. Every
 * colour is named after a token; the sky overhead is the Stage's `light-*` and the horizon its
 * `ember-*`, the same pair that tints the page behind the text.
 */
const KEYS: LightKey[] = [
  {
    top: "light-trailhead",
    horizon: "ember-trailhead",
    lift: 0.62,
    warmth: 0,
    sunElevation: -0.3,
    glowStrength: 0.55,
    disc: 0,
    stars: 1,
    keyIntensity: 1.7,
    fillIntensity: 2.63,
    ambientIntensity: 1.5,
    mist: 0.5,
    summitGlow: 0.12,
  },
  {
    top: "light-trailhead",
    horizon: "ember-trailhead",
    lift: 0.52,
    warmth: 0.1,
    sunElevation: -0.26,
    glowStrength: 0.65,
    disc: 0,
    stars: 0.95,
    keyIntensity: 1.8,
    fillIntensity: 2.48,
    ambientIntensity: 1.45,
    mist: 0.5,
    summitGlow: 0.14,
  },
  {
    top: "light-long-approach",
    horizon: "ember-long-approach",
    lift: 0.32,
    warmth: 0.16,
    sunElevation: -0.2,
    glowStrength: 0.75,
    disc: 0,
    stars: 0.75,
    keyIntensity: 1.9,
    fillIntensity: 2.17,
    ambientIntensity: 1.4,
    mist: 0.6,
    summitGlow: 0.18,
  },
  {
    top: "light-steep-switch",
    horizon: "ember-steep-switch",
    lift: 0.18,
    warmth: 0.28,
    sunElevation: -0.14,
    glowStrength: 0.82,
    disc: 0,
    stars: 0.45,
    keyIntensity: 1.9,
    fillIntensity: 1.78,
    ambientIntensity: 1.25,
    mist: 0.6,
    summitGlow: 0.25,
  },
  {
    top: "light-ridge",
    horizon: "ember-ridge",
    lift: 0.08,
    warmth: 0.42,
    sunElevation: -0.08,
    glowStrength: 0.92,
    disc: 0,
    stars: 0.18,
    keyIntensity: 1.8,
    fillIntensity: 1.47,
    ambientIntensity: 1.15,
    mist: 0.55,
    summitGlow: 0.5,
  },
  {
    top: "light-high-camp",
    horizon: "ember-high-camp",
    lift: 0,
    warmth: 0.6,
    sunElevation: -0.02,
    glowStrength: 1,
    disc: 0.5,
    stars: 0,
    keyIntensity: 2.1,
    fillIntensity: 1.24,
    ambientIntensity: 1.05,
    mist: 0.5,
    summitGlow: 0.85,
  },
  {
    top: "light-summit",
    horizon: "ember-high-camp",
    lift: 0,
    warmth: 0.85,
    sunElevation: 0.03,
    glowStrength: 1.2,
    disc: 1,
    stars: 0,
    keyIntensity: 2.4,
    fillIntensity: 1.08,
    ambientIntensity: 1,
    mist: 0.45,
    summitGlow: 1,
  },
];

export const JOURNEY_LENGTH = KEYS.length - 1;

const MOON_ELEVATION = 0.5;
const SUNRISE_ELEVATION = 0.16;

/** The light at `u`, mixed from the two keys either side of it. */
export function lightAt(u: number, colors: SceneColors): SceneLight {
  const clamped = Math.min(JOURNEY_LENGTH, Math.max(0, u));
  const index = Math.min(JOURNEY_LENGTH - 1, Math.floor(clamped));
  const f = clamped - index;
  const a = KEYS[index];
  const b = KEYS[index + 1];
  const mix = (x: number, y: number) => lerp(x, y, f);

  const blend = (key: (k: LightKey) => SceneColorName, warm: boolean) => {
    const color = colors[key(a)].clone().lerp(colors[key(b)], f);
    if (warm) color.lerp(colors["first-light"], mix(a.warmth, b.warmth));
    return color;
  };

  const top = blend((k) => k.top, false);
  const horizonLift = mix(a.lift, b.lift);
  const horizon = blend((k) => k.horizon, false).lerp(
    colors.scree,
    horizonLift,
  );
  const glow = blend((k) => k.horizon, true).lerp(
    colors.scree,
    horizonLift * 0.5,
  );
  const warmth = mix(a.warmth, b.warmth);
  const sunElevation = mix(a.sunElevation, b.sunElevation);

  const fog = horizon.clone().lerp(top, 0.2).multiplyScalar(0.8);
  const mist = horizon.clone().lerp(top, 0.1).multiplyScalar(0.92);

  const cosElevation = Math.cos(sunElevation);
  const sunDirection = new Vector3(
    SUN_AZIMUTH.x * cosElevation,
    Math.sin(sunElevation),
    SUN_AZIMUTH.z * cosElevation,
  ).normalize();

  // The lamp is moonlight at first, then the low sun. It never shines from below the ground.
  const lift = Math.min(1, Math.max(0, (sunElevation + 0.3) / 0.33));
  const keyElevation = lerp(MOON_ELEVATION, SUNRISE_ELEVATION, lift);
  const keyDirection = new Vector3(
    SUN_AZIMUTH.x * Math.cos(keyElevation),
    Math.sin(keyElevation),
    SUN_AZIMUTH.z * Math.cos(keyElevation),
  ).normalize();
  const keyColor = colors.snow
    .clone()
    .lerp(colors["first-light"], Math.min(1, warmth * 1.1));

  return {
    top,
    horizon,
    glow,
    fog,
    mist,
    sunDirection,
    glowStrength: mix(a.glowStrength, b.glowStrength),
    discStrength: mix(a.disc, b.disc),
    stars: mix(a.stars, b.stars),
    keyColor,
    keyIntensity: mix(a.keyIntensity, b.keyIntensity),
    keyDirection,
    fillColor: top.clone().lerp(colors.snow, 0.62).lerp(horizon, 0.25),
    fillIntensity: mix(a.fillIntensity, b.fillIntensity),
    skyAmbient: top.clone().lerp(horizon, 0.5).lerp(colors.snow, 0.25),
    groundAmbient: colors["light-ground"].clone().lerp(horizon, 0.25),
    ambientIntensity: mix(a.ambientIntensity, b.ambientIntensity),
    mistAmount: mix(a.mist, b.mist),
    summitGlow: mix(a.summitGlow, b.summitGlow),
  };
}
