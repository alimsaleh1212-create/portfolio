import type { MediaItem, MediaRole, MediaVariant } from "./types";

/** The item for a role, or undefined when that role was not seeded. */
export function findMedia(media: MediaItem[], role: MediaRole): MediaItem | undefined {
  return media.find((item) => item.role === role);
}

/** `url 320w, url 480w, ...` for one format, narrowest first. */
export function srcSet(variants: MediaVariant[], format: string): string {
  return variants
    .filter((variant) => variant.format === format && variant.width !== null)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(", ");
}

/** The widest variant of a format, or undefined. */
export function widest(variants: MediaVariant[], format: string): MediaVariant | undefined {
  return variants
    .filter((variant) => variant.format === format && variant.width !== null)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
}

/** The variant of a format closest to, but not narrower than, a wanted width (else the widest). */
export function nearestWidth(
  variants: MediaVariant[],
  format: string,
  wanted: number,
): MediaVariant | undefined {
  const sorted = variants
    .filter((variant) => variant.format === format && variant.width !== null)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return sorted.find((variant) => (variant.width ?? 0) >= wanted) ?? sorted.at(-1);
}

/** "87 KB", "22.8 MB", with a no-break space so the unit stays with the number. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))}\u00a0KB`;
  return `${(bytes / 1_000_000).toFixed(1)}\u00a0MB`;
}

/** 85.4 seconds becomes "1 min 25 s" (no-break spaces). */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${rest}\u00a0s`;
  return rest === 0 ? `${minutes}\u00a0min` : `${minutes}\u00a0min\u00a0${rest}\u00a0s`;
}
