import {
  createNoise,
  fbm,
  lerp,
  ridged,
  smoothstep,
  type Noise,
} from "./noise";

/** The seed that makes the Climb's mountain. Change it and every load changes with it. */
export const MOUNTAIN_SEED = 15;

/** A peak of the massif: where it stands, how high and how wide. */
interface Peak {
  x: number;
  z: number;
  height: number;
  radius: number;
  /** How hard the slope steepens toward the top: higher is a sharper peak. */
  sharp: number;
}

/** The Summit first, then the peaks that crowd around it and make the massif. */
const PEAKS: Peak[] = [
  { x: 10, z: -134, height: 100, radius: 104, sharp: 1.55 },
  { x: -66, z: -100, height: 52, radius: 60, sharp: 1.4 },
  { x: 74, z: -90, height: 52, radius: 52, sharp: 1.35 },
  { x: -26, z: -186, height: 88, radius: 84, sharp: 1.45 },
  { x: 66, z: -168, height: 72, radius: 66, sharp: 1.45 },
];

export interface Landform {
  /** Height of the ground at a point, before the trail is cut into it. */
  height: (x: number, z: number) => number;
  /** The top of the Summit. */
  summit: { x: number; y: number; z: number };
}

/** A smooth union of the peaks: the tallest wins, but where two meet they blend. */
function massif(noise: Noise, x: number, z: number): number {
  let sum = 0;
  PEAKS.forEach((peak, index) => {
    const dx = x - peak.x;
    const dz = z - peak.z;
    const distance = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    // Buttresses: the peak's reach changes with direction, so ridges run down its flanks.
    const reach =
      peak.radius *
      (0.62 +
        0.38 *
          (0.5 +
            0.5 *
              fbm(
                noise,
                Math.cos(angle) * 1.5 + index * 7.7,
                Math.sin(angle) * 1.5 + index * 3.1,
                2,
              )));
    const c = 1 - distance / reach;
    if (c <= 0) return;
    sum += Math.pow(peak.height * Math.pow(c, peak.sharp), 3);
  });
  return Math.cbrt(sum);
}

/** The ground: a valley floor, foothills, and the massif with crags cut into it. */
export function createLandform(seed: number): Landform {
  const shape = createNoise(seed);
  const crags = createNoise(seed + 101);
  const rolling = createNoise(seed + 202);

  const height = (x: number, z: number): number => {
    const rise = massif(shape, x, z);
    // Foothills swell up toward the mountain; the valley in front stays low.
    const foothills =
      50 *
      Math.pow(smoothstep(104, -96, z), 1.45) *
      (0.62 + 0.38 * fbm(rolling, x * 0.018, z * 0.018, 3));
    const valley = 2.5 + 3 * fbm(rolling, x * 0.011 + 40, z * 0.011, 3);
    let h = valley + foothills + rise;
    // Crags: creases and faces, strongest on the mountain's body, absent on the meadow.
    const body = smoothstep(3, 40, rise);
    h +=
      (ridged(crags, x * 0.03, z * 0.03, 4) - 0.42) *
      40 *
      body *
      (0.55 + 0.45 * smoothstep(20, 90, rise));
    h +=
      (ridged(crags, x * 0.075 + 9, z * 0.075, 3) - 0.45) *
      9 *
      smoothstep(0, 24, rise + foothills * 0.5);
    h += 2.4 * fbm(rolling, x * 0.13, z * 0.13, 2) * smoothstep(4, 30, rise);
    // The meadow at the Trailhead is flat and open.
    const meadow = smoothstep(34, 14, Math.hypot(x + 6, z - 92));
    return lerp(h, 3.2 + 0.6 * fbm(rolling, x * 0.05, z * 0.05, 2), meadow);
  };

  // The Summit is wherever the ground is highest around the Summit's peak.
  let best = { x: PEAKS[0].x, y: -Infinity, z: PEAKS[0].z };
  for (let dx = -14; dx <= 14; dx += 1) {
    for (let dz = -14; dz <= 14; dz += 1) {
      const x = PEAKS[0].x + dx;
      const z = PEAKS[0].z + dz;
      const y = height(x, z);
      if (y > best.y) best = { x, y, z };
    }
  }
  return { height, summit: best };
}
