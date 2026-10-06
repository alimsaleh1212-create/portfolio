import { Color } from "three";

/**
 * The scene's colours. Every one is a design token, read from the stylesheet when the scene
 * starts, so index.css stays the single source and the scene always matches the page.
 */
export const SCENE_COLOR_NAMES = [
  "ground",
  "light-trailhead",
  "light-long-approach",
  "light-steep-switch",
  "light-ridge",
  "light-high-camp",
  "light-summit",
  "light-ground",
  "ember-trailhead",
  "ember-long-approach",
  "ember-steep-switch",
  "ember-ridge",
  "ember-high-camp",
  "first-light",
  "rock-deep",
  "rock",
  "scree",
  "snow",
  "trail",
  "pine",
  "star",
] as const;

export type SceneColorName = (typeof SCENE_COLOR_NAMES)[number];
export type SceneColors = Record<SceneColorName, Color>;

/** Reads `--color-<name>` from the page. */
export function readCssColor(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${name}`)
    .trim();
}

/** The palette for the scene, from a reader of token values (the page's stylesheet by default). */
export function readSceneColors(
  read: (name: string) => string = readCssColor,
): SceneColors {
  const colors = {} as SceneColors;
  for (const name of SCENE_COLOR_NAMES) {
    const value = read(name);
    if (!value) throw new Error(`The colour token --color-${name} is missing`);
    colors[name] = new Color(value);
  }
  return colors;
}
