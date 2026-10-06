/**
 * What the full and the light tier each build and draw. The light tier is the same picture,
 * cheaper: the same mountain, trail, light, camera and Hiker, with a coarser ground, fewer
 * pines and stars, and a lower pixel ratio. Nothing else differs.
 */

export type Quality = "full" | "light";

export interface QualitySettings {
  /** Cells of the ground grid along x and along z; each cell is two triangles. */
  cells: { x: number; z: number };
  /** Every n-th pine is kept: 1 keeps all of them. */
  pineEvery: number;
  /** Points of light in the night sky. */
  stars: number;
  /** The most device pixels drawn per CSS pixel. */
  maxPixelRatio: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  full: {
    cells: { x: 160, z: 180 },
    pineEvery: 1,
    stars: 2200,
    maxPixelRatio: 1.5,
  },
  light: {
    cells: { x: 96, z: 108 },
    pineEvery: 2,
    stars: 1100,
    maxPixelRatio: 1,
  },
};
