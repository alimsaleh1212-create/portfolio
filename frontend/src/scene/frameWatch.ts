/**
 * Notices a full tier that runs poorly. Only frames drawn back to back while the Visitor is
 * scrolling count (a frame after the page sat still is long for no reason), and a frame that
 * took more than a second (a hidden tab, a stall) says nothing about the device. Pure: it is
 * fed frame times and says when to stop, so it is tested without a clock.
 */

export interface SlowWatchOptions {
  /** A frame longer than this is slow, in milliseconds (45 ms is under 22 frames a second). */
  slowMs?: number;
  /** How many counted frames are looked at. */
  window?: number;
  /** How many of them must be slow. */
  needed?: number;
  /** Frames to ignore at the start: shaders compile and buffers upload on the first few. */
  warmup?: number;
}

export interface SlowWatch {
  /** Feed one drawn frame; true when the frames have stayed slow and the tier should drop. */
  push(frameMs: number, scrolling: boolean): boolean;
}

export const SLOW_FRAME_MS = 45;

export function createSlowWatch({
  slowMs = SLOW_FRAME_MS,
  window = 24,
  needed = 18,
  warmup = 6,
}: SlowWatchOptions = {}): SlowWatch {
  const recent: boolean[] = [];
  let seen = 0;
  return {
    push(frameMs, scrolling) {
      seen += 1;
      if (seen <= warmup || !scrolling || !(frameMs > 0) || frameMs > 1000) {
        return false;
      }
      recent.push(frameMs > slowMs);
      if (recent.length > window) recent.shift();
      return recent.length >= window && recent.filter(Boolean).length >= needed;
    },
  };
}
