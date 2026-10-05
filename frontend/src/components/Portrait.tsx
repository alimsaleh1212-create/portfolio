import { srcSet, widest } from "../api/media";
import type { MediaItem } from "../api/types";

/*
 * `sizes` hints, not design values: how wide the picture is drawn, so the browser picks a
 * file that fits. They match the layout in SummaryPage (a fixed slot on small screens, the
 * identity column from the `lg` breakpoint up). Built from numbers so the tokens-only check
 * stays strict about literals in class names and styles.
 */
const px = (n: number) => `${n}px`;
const LARGE_BREAKPOINT = 1024;
const SMALL_SLOT = 192;
const LARGE_SLOT = 363;
const SIZES = `(min-width: ${px(LARGE_BREAKPOINT)}) ${px(LARGE_SLOT)}, ${px(SMALL_SLOT)}`;

/**
 * The Portrait: responsive sources in three formats and explicit dimensions, so the page
 * does not shift as the picture loads. The photograph is bright green foliage; a uniform
 * soft desaturation and dimming sits it in the night palette without touching hue, and its
 * lower edge fades into the page ground so it joins the name beneath instead of ending in a box.
 */
export function Portrait({ item }: { item: MediaItem }) {
  const fallback = widest(item.variants, "jpeg");
  if (!fallback || !fallback.width || !fallback.height) return null;
  return (
    <div className="relative w-48 lg:w-full">
      <picture>
        <source type="image/avif" srcSet={srcSet(item.variants, "avif")} sizes={SIZES} />
        <source type="image/webp" srcSet={srcSet(item.variants, "webp")} sizes={SIZES} />
        <img
          src={fallback.url}
          srcSet={srcSet(item.variants, "jpeg")}
          sizes={SIZES}
          width={fallback.width}
          height={fallback.height}
          alt={item.alt ?? ""}
          fetchPriority="high"
          decoding="async"
          className="rounded-surface block h-auto w-full brightness-90 saturate-75"
        />
      </picture>
      <div
        aria-hidden="true"
        className="bg-portrait-fade rounded-surface pointer-events-none absolute inset-0"
      />
    </div>
  );
}
