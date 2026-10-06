/**
 * The still tier's pictures: one of the scene per position of the journey, each in a wide and a
 * narrow composition. Pure helpers, with nothing three.js in them, because the still tier
 * downloads none of the 3D code.
 */
import type { MediaItem, MediaVariant } from "../api/types";

/** Position `k` of the journey is `STILL_POSITIONS[k]`: the opening screen, the five Stages, the Summit view. */
export const STILL_POSITIONS = [
  "opening",
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
  "summit",
] as const;
export type StillPosition = (typeof STILL_POSITIONS)[number];

export type Composition = "wide" | "narrow";

/** Wide compositions are used from this viewport width; it is where the scene's own framing changes. */
export const WIDE_FROM = 1024;

/** The name a still is stored under, and the capture script's file name. */
export function stillName(position: StillPosition, composition: Composition) {
  return `${position}-${composition}`;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * How visible picture `k` is when the Visitor is at point `u` of the journey. Pictures are
 * stacked in order: everything up to the current position is fully there, and the next one
 * fades in over the middle of the way to it, so the Climb rests on each Stage's picture
 * (as the camera does) and changes between them. With reduced motion it simply changes,
 * halfway, with no fade.
 */
export function stillOpacity(u: number, k: number, reduced: boolean): number {
  if (k === 0) return 1;
  if (reduced) return u >= k - 0.5 ? 1 : 0;
  if (u >= k) return 1;
  const along = u - (k - 1);
  if (along <= 0) return 0;
  return smooth(Math.min(1, Math.max(0, (along - 0.3) / 0.4)));
}

/** The pictures that should be on the page at `u`: the one it is in, the next, and the first. */
export function stillsWanted(u: number): number[] {
  const last = STILL_POSITIONS.length - 1;
  const wanted = [0];
  for (let k = 1; k <= Math.min(last, Math.ceil(u) + 1); k++) wanted.push(k);
  return wanted;
}

export interface StillSources {
  /** `[srcset, mimetype]` for each format a composition has, best first. */
  sources: { type: string; srcSet: string }[];
  /** The fallback: the widest JPEG. */
  fallback: MediaVariant;
}

const FORMATS: [string, string][] = [
  ["avif", "image/avif"],
  ["webp", "image/webp"],
  ["jpeg", "image/jpeg"],
];

/** The variants of one still, as `<source>` sets narrowest first, and its fallback JPEG. */
export function sourcesFor(
  media: MediaItem[],
  position: StillPosition,
  composition: Composition,
): StillSources | null {
  const item = media.find((entry) => entry.role === "stills");
  if (!item) return null;
  const name = stillName(position, composition);
  const own = item.variants.filter(
    (variant) => variant.name === name && variant.width !== null,
  );
  const sources = FORMATS.flatMap(([format, type]) => {
    const set = own
      .filter((variant) => variant.format === format)
      .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    return set.length
      ? [
          {
            type,
            srcSet: set
              .map((variant) => `${variant.url} ${variant.width}w`)
              .join(", "),
          },
        ]
      : [];
  });
  const fallback = own
    .filter((variant) => variant.format === "jpeg")
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return fallback && sources.length ? { sources, fallback } : null;
}
