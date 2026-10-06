/**
 * Work that can be paused. A step function is a generator that `yield`s at points where it is
 * fine to stop for a moment. Run synchronously (`drain`) it is plain code, as in tests; run
 * with `drainAsync` it hands the main thread back to the page whenever a slice has used its
 * share of time, so building the mountain never freezes scrolling or input for long.
 */

export type Steps<T> = Generator<void, T, void>;

/** Run to the end without pausing. */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** The longest the main thread is held in one go while building, in milliseconds. */
export const SLICE_MS = 8;

/** Let the page paint and handle input, then carry on. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run to the end, giving the main thread back whenever a slice has lasted `sliceMs`. Returns
 * the result and the longest slice that was held, which is what a Visitor could feel.
 */
export async function drainAsync<T>(
  steps: Steps<T>,
  options: { sliceMs?: number; signal?: AbortSignal } = {},
): Promise<{ value: T; longestSliceMs: number; slices: number }> {
  const sliceMs = options.sliceMs ?? SLICE_MS;
  let started = performance.now();
  let longest = 0;
  let slices = 0;
  for (;;) {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    const next = steps.next();
    const now = performance.now();
    if (next.done) {
      longest = Math.max(longest, now - started);
      return { value: next.value, longestSliceMs: longest, slices: slices + 1 };
    }
    if (now - started >= sliceMs) {
      longest = Math.max(longest, now - started);
      slices += 1;
      await breathe();
      started = performance.now();
    }
  }
}
