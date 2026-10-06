import { beforeAll, describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { poseAt, POSE_KEYS } from "./journey";
import { createLandform, MOUNTAIN_SEED } from "./landform";
import { BOUNDS } from "./terrain";
import { STAGE_KEYS, STAGE_TRAIL_T } from "./trail";
import { createWorld, type World } from "./world";

/** A cheap fingerprint of the ground: its vertices, summed with weights. */
function fingerprint(world: World): number {
  let sum = 0;
  const v = world.terrain.vertices;
  for (let i = 0; i < v.length; i += 7) sum += v[i] * (1 + (i % 13)) * 0.001;
  return sum;
}

describe("the mountain", () => {
  let world: World;
  beforeAll(() => {
    world = createWorld(MOUNTAIN_SEED);
  });

  it("is identical every time it is made from the same seed", () => {
    const again = createWorld(MOUNTAIN_SEED);
    expect(again.terrain.vertices).toEqual(world.terrain.vertices);
    expect(again.terrain.shade).toEqual(world.terrain.shade);
    expect(again.landform.summit).toEqual(world.landform.summit);
    expect(again.trail.length).toBe(world.trail.length);
    expect(fingerprint(again)).toBe(fingerprint(world));
  });

  it("is a different mountain from a different seed", () => {
    const other = createWorld(MOUNTAIN_SEED + 1);
    expect(fingerprint(other)).not.toBe(fingerprint(world));
  });

  it("has a Summit that is the highest ground, well above the trail", () => {
    let highest = -Infinity;
    for (let i = 1; i < world.terrain.vertices.length; i += 3) {
      highest = Math.max(highest, world.terrain.vertices[i]);
    }
    const top = world.landform.summit.y;
    expect(top).toBeGreaterThanOrEqual(highest - 8);
    const camp = world.trail.pointAt(1);
    expect(top).toBeGreaterThan(camp.y + 60);
  });

  it("gives heights that match the drawn triangles at their corners", () => {
    const { vertices, cellsX } = world.terrain;
    const width = cellsX + 1;
    for (const [i, j] of [
      [10, 10],
      [80, 90],
      [120, 40],
      [30, 150],
    ]) {
      const o = (j * width + i) * 3;
      expect(world.terrain.heightAt(vertices[o], vertices[o + 2])).toBeCloseTo(
        vertices[o + 1],
        3,
      );
    }
  });

  it("keeps the landform inside the ground it is drawn on", () => {
    expect(BOUNDS.minX).toBeLessThan(-100);
    const landform = createLandform(MOUNTAIN_SEED);
    expect(landform.height(0, 90)).toBeLessThan(6);
  });
});

describe("the trail", () => {
  let world: World;
  beforeAll(() => {
    world = createWorld(MOUNTAIN_SEED);
  });

  it("starts low in the meadow and climbs to High Camp", () => {
    const start = world.trail.pointAt(0);
    const end = world.trail.pointAt(1);
    expect(start.y).toBeLessThan(6);
    expect(end.y).toBeGreaterThan(50);
    let last = -Infinity;
    for (let t = 0; t <= 1; t += 0.02) {
      const y = world.trail.pointAt(t).y;
      expect(y).toBeGreaterThan(last - 1.5);
      last = y;
    }
  });

  it("lies on the ground it was cut into, all the way", () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const p = world.trail.pointAt(t);
      expect(Math.abs(world.terrain.heightAt(p.x, p.z) - p.y)).toBeLessThan(
        1.6,
      );
    }
  });

  it("has the Stages in order along it, each at its own place", () => {
    const places = STAGE_KEYS.map((key) => STAGE_TRAIL_T[key]);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(places[0]).toBe(0);
    expect(places[places.length - 1]).toBe(1);
  });

  it("gives a direction of travel that is a unit vector", () => {
    const tangent = world.trail.tangentAt(0.5, new Vector3());
    expect(tangent.length()).toBeCloseTo(1, 5);
  });
});

describe("the camera's path", () => {
  let world: World;
  beforeAll(() => {
    world = createWorld(MOUNTAIN_SEED);
  });

  it("stays above the ground all the way, and never reaches the Summit's height", () => {
    for (let u = 0; u <= 6.0001; u += 0.05) {
      const { position } = poseAt(u, false);
      const ground = world.terrain.heightAt(position.x, position.z);
      expect(position.y).toBeGreaterThan(ground + 1);
      expect(position.y).toBeLessThan(world.landform.summit.y - 30);
    }
  });

  it("has the Summit above the camera and in front of it at High Camp and at the Summit", () => {
    for (const u of [5, 6]) {
      const { position, target } = poseAt(u, false);
      const summit = new Vector3(
        world.landform.summit.x,
        world.landform.summit.y,
        world.landform.summit.z,
      );
      expect(summit.y).toBeGreaterThan(position.y + 20);
      const forward = target.clone().sub(position).normalize();
      const toSummit = summit.clone().sub(position).normalize();
      expect(forward.dot(toSummit)).toBeGreaterThan(0.9);
    }
  });

  it("keeps each key's camera clear of the ground", () => {
    for (const key of POSE_KEYS) {
      const [x, y, z] = key.position;
      expect(y).toBeGreaterThan(world.terrain.heightAt(x, z) + 2);
    }
  });
});
