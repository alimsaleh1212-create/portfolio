import { useSyncExternalStore } from "react";
import type { Vector3 } from "three";

import type { Trail } from "./trail";

/**
 * What the scene offers to the rest of the app, and to later work (the Hiker, the Expedition
 * game), so nothing has to reach into its internals.
 */
export interface SceneStage {
  /** The Stage's key, as in CONTEXT.md. */
  key: string;
  /** Where the Stage sits along the trail, 0 (Trailhead) to 1 (High Camp). */
  trailT: number;
  /** The Stage's place on the trail in scene space. */
  position: Vector3;
}

export interface ClimbScene {
  /** The seed the mountain was made from. */
  seed: number;
  /** The trail from the Trailhead to High Camp. */
  trail: Trail;
  /** The five Stages with their places on the trail. */
  stages: SceneStage[];
  /** The ground's height under (x, z), exactly as drawn: stand a foot on this. */
  heightAt: (x: number, z: number) => number;
  /** The Summit's top, which the trail never reaches. */
  summit: Vector3;
  /** The one progress value, 0 to 1, as the camera has eased to it: 0 at the Trailhead, 1 at High Camp. */
  progress: () => number;
  /** Where on the trail (0 to 1) that progress puts the Hiker. */
  trailT: () => number;
  /** Call `listener` whenever the rendered progress changes. Returns the function that stops it. */
  subscribe: (listener: () => void) => () => void;
}

let current: ClimbScene | null = null;
const listeners = new Set<() => void>();

/** The scene, once it has mounted; null before that, and wherever no scene is drawn. */
export function getClimbScene(): ClimbScene | null {
  return current;
}

export function subscribeClimbScene(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by the scene when it mounts. Returns the function that withdraws it. */
export function registerClimbScene(scene: ClimbScene): () => void {
  current = scene;
  for (const listener of [...listeners]) listener();
  return () => {
    if (current === scene) current = null;
    for (const listener of [...listeners]) listener();
  };
}

/** The scene, in React. Re-renders when it mounts or goes away, not as progress changes. */
export function useClimbScene(): ClimbScene | null {
  return useSyncExternalStore(subscribeClimbScene, getClimbScene, () => null);
}
