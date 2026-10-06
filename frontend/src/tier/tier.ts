/**
 * The tier this page load is served: decided once, in one place, then only ever lowered.
 *
 * `chooseTier()` runs in `main.tsx` before the Visit starts, so the Visit can carry it. If
 * the decision itself fails (a browser that throws on a property), the page is served the
 * light tier, since nothing is known, and the Visit simply carries no tier. A later
 * downgrade is not recorded.
 */
import { useSyncExternalStore } from "react";

import { decideTier, forcedTier, isLighter, type Tier } from "./decide";
import { readDevice } from "./device";

let current: Tier | null = null;
const listeners = new Set<() => void>();

/** The page's root says which tier is served, for styles, tests and whoever looks. */
function show(tier: Tier) {
  if (typeof document !== "undefined")
    document.documentElement.dataset.tier = tier;
}

/** Decide the tier from the address and the device. Never throws. Returns what the Visit should carry. */
export function chooseTier(): Tier | undefined {
  if (current !== null) return current;
  try {
    current = forcedTier(window.location.search) ?? decideTier(readDevice());
    show(current);
    return current;
  } catch {
    current = "light";
    show(current);
    return undefined;
  }
}

/** The tier now, deciding first if nobody has. */
export function getTier(): Tier {
  if (current === null) chooseTier();
  return current ?? "light";
}

export function subscribeTier(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * What the pre-render, and the browser while it hydrates, take the tier to be. The server cannot
 * know the device, so the page it writes has no backdrop; once hydrated the browser's own
 * decision replaces this at once. (Light and not full, so nothing here ever starts a scene.)
 */
function getServerTier(): Tier {
  return "light";
}

/** React: the tier, re-rendering when it is lowered. */
export function useTier(): Tier {
  return useSyncExternalStore(subscribeTier, getTier, getServerTier);
}

/**
 * Serve a lighter tier from now on, without a reload. Returns whether it changed: asking for
 * the same tier or a heavier one does nothing, so the tier never goes back up or flips.
 */
export function lowerTier(next: Tier): boolean {
  if (!isLighter(next, getTier())) return false;
  current = next;
  show(next);
  for (const listener of [...listeners]) listener();
  return true;
}

/** Forget the decision. For tests only. */
export function resetTierForTests(): void {
  current = null;
  listeners.clear();
}
