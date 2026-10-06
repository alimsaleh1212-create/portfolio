import { createLandform, MOUNTAIN_SEED, type Landform } from "./landform";
import { createTerrain, type Terrain } from "./terrain";
import { planTrail, type Trail } from "./trail";

export interface World {
  seed: number;
  landform: Landform;
  terrain: Terrain;
  trail: Trail;
}

/**
 * Everything the scene stands on, built from one seed: the landform, the trail planned over
 * it, and the ground with the trail's bench cut in. Deterministic, so every load (and every
 * test) gets the same mountain.
 */
export function createWorld(seed = MOUNTAIN_SEED): World {
  const landform = createLandform(seed);
  const { trail, bench } = planTrail(landform);
  const terrain = createTerrain(landform, seed, bench);
  return { seed, landform, terrain, trail };
}
