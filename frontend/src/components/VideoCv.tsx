import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { formatDuration, nearestWidth } from "../api/media";
import type { MediaItem } from "../api/types";

// Not design values: the width below which a phone-sized 720p file is plenty.
const SMALL_SCREEN_MAX = 767;
const SMALL_SCREEN_QUERY = `(max-width: ${SMALL_SCREEN_MAX}px)`;
const POSTER_WIDTH_SMALL = 960;
const POSTER_WIDTH_LARGE = 1280;

function subscribe(onChange: () => void) {
  const query = window.matchMedia(SMALL_SCREEN_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useSmallScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SMALL_SCREEN_QUERY).matches,
    () => false,
  );
}

// How far ahead of the screen a deferred poster starts to load: well before it can be seen.
const POSTER_LEAD = "100% 0%";

/**
 * True once `element` is within a screen's height of the screen. Where nothing can observe
 * (no IntersectionObserver) it is true at once, so a poster is never withheld for good.
 */
function useNearScreen(
  ref: React.RefObject<Element | null>,
  wanted: boolean,
): boolean {
  const [near, setNear] = useState(!wanted);
  useEffect(() => {
    if (near || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: POSTER_LEAD },
    );
    watch.observe(ref.current);
    return () => watch.disconnect();
  }, [near, ref]);
  return near;
}

/**
 * The Video CV with the browser's own controls. `preload="none"` means nothing but the
 * poster is fetched until the Visitor presses play. Small screens get the 720p file.
 */
export function VideoCv({
  item,
  deferPoster = false,
}: {
  item: MediaItem;
  /** The video is far down its page (the Climb's High Camp): its poster is fetched only when the Visitor nears it. */
  deferPoster?: boolean;
}) {
  const small = useSmallScreen();
  const frameRef = useRef<HTMLElement>(null);
  const near = useNearScreen(frameRef, deferPoster);
  const renditions = item.variants
    .filter(
      (variant) => variant.kind === "video" && variant.width && variant.height,
    )
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  // Largest first: the big screen gets the first, the small one the smallest that is still HD-ish.
  const chosen = (small ? renditions.at(-1) : renditions[0]) ?? renditions[0];
  if (!chosen?.width || !chosen.height) return null;
  const frame = renditions[0];
  const poster = nearestWidth(
    item.variants.filter((variant) => variant.kind === "poster"),
    "webp",
    small ? POSTER_WIDTH_SMALL : POSTER_WIDTH_LARGE,
  );

  return (
    <figure ref={frameRef} className="mt-section md:mt-section-wide">
      <h2 id="video-heading" className="text-xl font-semibold tracking-snug">
        Video CV
      </h2>
      <video
        key={chosen.url}
        controls
        playsInline
        preload="none"
        poster={near ? poster?.url : undefined}
        src={chosen.url}
        aria-labelledby="video-heading"
        aria-describedby="video-caption"
        width={frame.width ?? undefined}
        height={frame.height ?? undefined}
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
        className="rounded-surface bg-raised mt-8 block h-auto w-full"
      />
      {item.duration_seconds !== null && (
        <figcaption
          id="video-caption"
          className="text-ink-muted mt-3 font-mono text-sm"
        >
          {item.alt ? `${item.alt} ` : ""}
          {formatDuration(item.duration_seconds)}.
        </figcaption>
      )}
    </figure>
  );
}
