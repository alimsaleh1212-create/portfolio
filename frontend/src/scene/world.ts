import { createLandform, MOUNTAIN_SEED, type Landform } from "./landform";
import { QUALITY, type Quality } from "./quality";
import { drain, type Steps } from "./steps";
import { terrainSteps, type Terrain } from "./terrain";
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
 * test) gets the same mountain. The light tier has a coarser ground; the landform and the
 * trail are the same.
 */
export function createWorld(
  seed = MOUNTAIN_SEED,
  quality: Quality = "full",
): World {
  return drain(worldSteps(seed, quality));
}

/** `createWorld` as pausable work (see `steps.ts`). */
export function* worldSteps(
  seed = MOUNTAIN_SEED,
  quality: Quality = "full",
): Steps<World> {
  const landform = createLandform(seed);
  yield;
  const { trail, bench } = planTrail(landform);
  yield;
  const { cells } = QUALITY[quality];
  const terrain = yield* terrainSteps(landform, seed, bench, cells.x, cells.z);
  return { seed, landform, terrain, trail };
}
