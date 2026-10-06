/**
 * How the camera keys in `frontend/src/scene/journey.ts` were derived (ticket #16).
 *
 * For one journey position it searches small changes to the camera's position and the wide
 * layout's picture shift so that the Hiker (standing where `trailT` puts it) lands in a free
 * region of the screen, at a sensible size, in plain view of the camera (no ridge in the way),
 * while moving the camera as little as it can. The free regions are measured from the page
 * (see `scripts/scan.py`: the text and the cards at that position) and written in `REGIONS`.
 * Narrow screens are not solved: their keys are set by hand from the scan's Hiker positions,
 * since text covers the whole width there (the Hiker sits in the free band, or is out of frame).
 *
 * Run: copy this file to `frontend/src/scene/solve.tmp.test.ts` (it imports the scene's
 * modules), set `U`, run `npx vitest run src/scene/solve.tmp.test.ts --testTimeout=600000`,
 * read the printed best change, add it to the key, and delete the copy.
 */
import { PerspectiveCamera, Vector3 } from "three";
import { it } from "vitest";

import { fieldOfView, POSE_KEYS } from "./journey";
import { HIKER_HEIGHT } from "./hiker";
import { STAGE_KEYS, STAGE_TRAIL_T } from "./trail";
import { createWorld } from "./world";

const U = Number(process.env.SOLVE_U ?? 4);
const SIZE: [number, number] = [1280, 800];
/** Free regions for the Hiker's box at 1280 by 800, by journey position, and its height range. */
const REGIONS: Record<number, { l: number; r: number; t: number; b: number; hMin: number; hMax: number }> = {
  4: { l: 50, r: 470, t: 430, b: 720, hMin: 60, hMax: 90 },
  5: { l: 60, r: 540, t: 360, b: 640, hMin: 64, hMax: 100 },
};

const world = createWorld();
const trailT = U >= 6 ? 1 : STAGE_TRAIL_T[STAGE_KEYS[Math.max(1, U) - 1]];

function evaluate(v: number[]) {
  const key = POSE_KEYS[U];
  const [w, h] = SIZE;
  const hiker = world.trail.pointAt(trailT);
  hiker.y = world.terrain.heightAt(hiker.x, hiker.z);
  const camera = new PerspectiveCamera(50, w / h, 0.5, 1800);
  const eye = new Vector3(key.position[0] + v[0], key.position[1] + v[1], key.position[2] + v[2]);
  eye.y = Math.max(eye.y, world.terrain.heightAt(eye.x, eye.z) + 2.5);
  camera.position.copy(eye);
  camera.fov = fieldOfView(key.fov, w / h);
  camera.lookAt(new Vector3(...key.target));
  camera.setViewOffset(w, h, -(key.wide[0] + v[3]) * w, (key.wide[1] + v[4]) * h, w, h);
  camera.updateMatrixWorld();
  const foot = hiker.clone().project(camera);
  const top = hiker.clone().setY(hiker.y + HIKER_HEIGHT).project(camera);
  const x = ((foot.x + 1) / 2) * w;
  const footY = ((1 - foot.y) / 2) * h;
  const height = footY - ((1 - top.y) / 2) * h;
  const box = { l: x - height * 0.3, r: x + height * 0.3, t: footY - height, b: footY };
  const R = REGIONS[U];
  let cost = 0;
  cost += Math.max(0, R.l - box.l) * 30 + Math.max(0, box.r - R.r) * 30;
  cost += Math.max(0, R.t - box.t) * 30 + Math.max(0, box.b - R.b) * 30;
  cost += Math.max(0, R.hMin - height) * 20 + Math.max(0, height - R.hMax) * 20;
  // A clear line of sight: no ground between the eye and the Hiker's head.
  const head = hiker.clone().setY(hiker.y + HIKER_HEIGHT * 0.8);
  for (let i = 1; i < 80; i++) {
    const p = eye.clone().lerp(head, i / 80);
    const g = world.terrain.heightAt(p.x, p.z);
    if (g > p.y - 0.5) cost += 300 + (g - p.y) * 100;
  }
  cost += Math.hypot(v[0], v[1], v[2]) * 1.5 + (Math.abs(v[3]) + Math.abs(v[4])) * 800;
  return { cost, x, footY, height };
}

function random(seed: number) {
  let a = seed;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
}

it("finds the smallest change that puts the Hiker in its region", () => {
  const rnd = random(11);
  let best = [0, 0, 0, 0, 0];
  let bestCost = evaluate(best).cost;
  for (let i = 0; i < 150000; i++) {
    const scale = i < 50000 ? 1 : i < 100000 ? 0.25 : 0.06;
    const base = i < 20000 ? [0, 0, 0, 0, 0] : best;
    const v = base.map((x, j) => x + (rnd() - 0.5) * 2 * (j < 3 ? 45 : 0.12) * scale);
    const cost = evaluate(v).cost;
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  const r = evaluate(best);
  console.log(`U=${U} change [dx dy dz shiftX shiftY] = ${best.map((x) => x.toFixed(2)).join(" ")} cost ${bestCost.toFixed(0)} hiker x ${r.x.toFixed(0)} footY ${r.footY.toFixed(0)} height ${r.height.toFixed(0)}`);
}, 600000);
