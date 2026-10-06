/**
 * Which tier of the Climb a device is served (ticket #17).
 *
 * `decideTier` is the whole rule, a pure function of what the browser can report cheaply.
 * Everything that touches the browser is in `device.ts`; nothing here does.
 */

export type Tier = "full" | "light" | "still";

export const TIERS: readonly Tier[] = ["full", "light", "still"];

/** What the browser reported. `null` means it could not say. */
export interface DeviceReport {
  /** A WebGL 2 context can be made. */
  webgl2: boolean;
  /** The context would render in software: true, hardware: false, unknown: null. */
  software: boolean | null;
  reducedMotion: boolean;
  saveData: boolean;
  /** `navigator.deviceMemory`, in GB (the browser rounds it and caps it at 8). */
  memoryGb: number | null;
  /** `navigator.hardwareConcurrency`. */
  cores: number | null;
}

/** Below these a device gets the light tier. */
export const MIN_MEMORY_GB = 4;
export const MIN_CORES = 4;

/**
 * The rule, in order:
 *  1. Reduced motion requested, no WebGL 2, or software rendering: still.
 *  2. The renderer is not known to be hardware, nothing is known about the memory and the
 *     processors, data saver is on, or memory or cores are below the minimum: light.
 *  3. Otherwise: full.
 * A device we know nothing about is therefore light, never full.
 */
export function decideTier(device: DeviceReport): Tier {
  if (device.reducedMotion || !device.webgl2 || device.software === true) {
    return "still";
  }
  if (device.software === null || device.saveData) return "light";
  if (device.memoryGb === null && device.cores === null) return "light";
  if (device.memoryGb !== null && device.memoryGb < MIN_MEMORY_GB)
    return "light";
  if (device.cores !== null && device.cores < MIN_CORES) return "light";
  return "full";
}

/** `?tier=full|light|still` forces a tier, for testing and for comparing. Anything else is ignored. */
export function forcedTier(search: string): Tier | null {
  const value = new URLSearchParams(search).get("tier");
  return TIERS.find((tier) => tier === value) ?? null;
}

const RANK: Record<Tier, number> = { full: 0, light: 1, still: 2 };

/** A tier may only get lighter while the page is open: never an upgrade, never sideways. */
export function isLighter(next: Tier, current: Tier): boolean {
  return RANK[next] > RANK[current];
}
