import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";

import {
  getClimbScene,
  registerClimbScene,
  subscribeClimbScene,
  type ClimbScene,
} from "./registry";
import { createWorld } from "./world";

function sceneFor(world = createWorld()): ClimbScene {
  return {
    seed: world.seed,
    trail: world.trail,
    stages: [
      { key: "trailhead", trailT: 0, position: world.trail.pointAt(0) },
      { key: "high-camp", trailT: 1, position: world.trail.pointAt(1) },
    ],
    heightAt: world.terrain.heightAt,
    summit: new Vector3(0, 0, 0),
    progress: () => 0.25,
    trailT: () => 0.2,
    subscribe: () => () => {},
  };
}

let withdraw: (() => void) | null = null;
afterEach(() => withdraw?.());

describe("the scene's interface for later work", () => {
  it("is absent until a scene is mounted, and gone when it leaves", () => {
    expect(getClimbScene()).toBeNull();
    const scene = sceneFor();
    withdraw = registerClimbScene(scene);
    expect(getClimbScene()).toBe(scene);
    withdraw();
    withdraw = null;
    expect(getClimbScene()).toBeNull();
  });

  it("tells listeners when it comes and goes", () => {
    const listener = vi.fn();
    const stop = subscribeClimbScene(listener);
    withdraw = registerClimbScene(sceneFor());
    expect(listener).toHaveBeenCalledTimes(1);
    withdraw();
    withdraw = null;
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("offers the trail, the Stages' places, the ground's height and one progress value", () => {
    const scene = sceneFor();
    withdraw = registerClimbScene(scene);
    const offered = getClimbScene()!;
    expect(offered.trail.pointAt(0).y).toBeLessThan(offered.trail.pointAt(1).y);
    expect(offered.stages.map((stage) => stage.key)).toEqual([
      "trailhead",
      "high-camp",
    ]);
    expect(offered.stages[1].position.y).toBeGreaterThan(
      offered.stages[0].position.y,
    );
    const p = offered.trail.pointAt(0.5);
    expect(Number.isFinite(offered.heightAt(p.x, p.z))).toBe(true);
    expect(offered.progress()).toBeGreaterThanOrEqual(0);
    expect(offered.progress()).toBeLessThanOrEqual(1);
  });

  it("does not let an old scene withdraw a newer one", () => {
    const first = sceneFor();
    const second = sceneFor();
    const stopFirst = registerClimbScene(first);
    withdraw = registerClimbScene(second);
    stopFirst();
    expect(getClimbScene()).toBe(second);
  });
});
