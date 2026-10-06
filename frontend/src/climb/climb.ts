/**
 * Where the Visitor is on the Climb. This is the one source of truth for position.
 *
 * The altitude meter, the Stage reached events and (ticket #15) the 3D camera all
 * read it from here and never from each other's internals.
 *
 * - `progress`: 0 to 1. 0 is the top edge of the Trailhead at the top of the screen (the
 *   opening screen counts as 0), 1 is the top edge of High Camp at the top of the screen.
 *   Past High Camp (the Summit ahead, the contact section) it stays 1.
 * - `stage`: the key of the current Stage, or null on the opening screen. A Stage is
 *   current once its top edge has risen to the middle of the screen.
 * - `stages`: each Stage's place along the Climb as a progress value (the Trailhead is 0,
 *   High Camp is 1), in Climb order.
 *
 * Read it outside React with `getClimb()` and `subscribeClimb()` (a render loop can do
 * this every frame without re-rendering anything). Inside React, prefer `useCurrentStage()`
 * and `useStagePositions()`, which change rarely; `useClimb()` re-renders on every change
 * of progress.
 *
 * Only the Climb page starts tracking (`trackClimb`), and it stops when the page unmounts.
 */
import { useSyncExternalStore } from "react";

export interface StagePosition {
  key: string;
  /** Where the Stage sits along the Climb, 0 to 1. */
  position: number;
}

export interface ClimbState {
  progress: number;
  /** Key of the Stage the Visitor is in, or null before the Trailhead. */
  stage: string | null;
  stages: StagePosition[];
}

/** A Stage is current once its top edge is this far up from the bottom of the screen. */
const CURRENT_LINE = 0.5;
/** A Stage is reached once its top edge is this far up from the bottom of the screen. */
const REACH_LINE = 0.75;
const EPSILON = 0.0005;

const IDLE: ClimbState = { progress: 0, stage: null, stages: [] };

let state: ClimbState = IDLE;
const listeners = new Set<() => void>();

export function getClimb(): ClimbState {
  return state;
}

/** Call `listener` after each change. Returns the function that stops it. */
export function subscribeClimb(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: ClimbState) {
  state = next;
  for (const listener of [...listeners]) listener();
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Whether the Visitor asked for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Where the document is, from the Stages' elements (found by id, the Stage key).
 * Pure so it can be tested: `tops` are the Stages' top edges in document coordinates.
 */
export function readClimb(
  keys: string[],
  tops: number[],
  scrollY: number,
  viewport: number,
): ClimbState {
  const first = tops[0] ?? 0;
  const span = (tops[tops.length - 1] ?? 0) - first;
  const stages = keys.map((key, index) => ({
    key,
    position: span > 0 ? clamp((tops[index] - first) / span) : 0,
  }));
  let current: string | null = null;
  tops.forEach((top, index) => {
    if (top <= scrollY + viewport * CURRENT_LINE) current = keys[index];
  });
  return {
    progress: span > 0 ? clamp((scrollY - first) / span) : 0,
    stage: current,
    stages,
  };
}

/** Index of the highest Stage whose top edge has come into the reach line, or -1. */
export function highestReached(
  tops: number[],
  scrollY: number,
  viewport: number,
): number {
  let highest = -1;
  tops.forEach((top, index) => {
    if (top <= scrollY + viewport * REACH_LINE) highest = index;
  });
  return highest;
}

function sameStages(a: StagePosition[], b: StagePosition[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (item, index) =>
        item.key === b[index].key &&
        Math.abs(item.position - b[index].position) < EPSILON,
    )
  );
}

/**
 * Start following the page's scroll. `keys` are the Stage keys in order; each must be the
 * id of an element on the page. `onReach` is called with each Stage's key the first time
 * the Visitor has reached it, in Climb order. "Reached" means the Stage's top edge has
 * come up past the reach line at three quarters of the way down the screen. It is
 * decided from the scroll position, not from what was painted, so a Visitor who flings
 * (or jumps) past a Stage still reaches it, and a Stage below the fold on an unscrolled
 * page is not reached.
 *
 * Returns the function that stops tracking and puts the state back to idle.
 */
export function trackClimb(
  keys: string[],
  onReach: (key: string) => void = () => {},
): () => void {
  let reached = -1;
  let frame = 0;

  const tops = (): number[] | null => {
    const found: number[] = [];
    for (const key of keys) {
      const element = document.getElementById(key);
      if (!element) return null;
      found.push(element.getBoundingClientRect().top + window.scrollY);
    }
    return found;
  };

  const update = () => {
    frame = 0;
    const measured = tops();
    if (!measured) return;
    const viewport = window.innerHeight;
    const next = readClimb(keys, measured, window.scrollY, viewport);
    if (
      Math.abs(next.progress - state.progress) >= EPSILON ||
      next.stage !== state.stage ||
      !sameStages(next.stages, state.stages)
    ) {
      publish({
        progress: next.progress,
        stage: next.stage,
        stages: sameStages(next.stages, state.stages)
          ? state.stages
          : next.stages,
      });
    }
    const highest = highestReached(measured, window.scrollY, viewport);
    while (reached < highest) {
      reached += 1;
      onReach(keys[reached]);
    }
  };

  // One measurement per frame, however many scroll events arrive.
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  // Pictures, the video and fonts change the page's height without any scroll.
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  observer?.observe(document.body);
  update();

  return () => {
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    observer?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    publish(IDLE);
  };
}

/**
 * Move to a Stage: smooth, or at once when the Visitor asked for reduced motion. Focus
 * follows, so the next Tab continues from the Stage and a screen reader is told where
 * it landed. The Stage's key goes into the address so the position can be shared.
 */
export function scrollToStage(key: string): void {
  const element = document.getElementById(key);
  if (!element) return;
  element.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  element.focus({ preventScroll: true });
  window.history.replaceState(window.history.state, "", `#${key}`);
}

/** Everything, re-rendering on every change of progress. Prefer the narrower hooks. */
export function useClimb(): ClimbState {
  return useSyncExternalStore(subscribeClimb, getClimb, getClimb);
}

/** The key of the current Stage, or null on the opening screen. Re-renders only when it changes. */
export function useCurrentStage(): string | null {
  return useSyncExternalStore(
    subscribeClimb,
    () => state.stage,
    () => null,
  );
}

/** Each Stage's place along the Climb. Re-renders only when the page's layout moves them. */
export function useStagePositions(): StagePosition[] {
  return useSyncExternalStore(
    subscribeClimb,
    () => state.stages,
    () => IDLE.stages,
  );
}
