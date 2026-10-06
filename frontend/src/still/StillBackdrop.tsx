import { useEffect, useRef, useState } from "react";

import type { MediaItem } from "../api/types";
import { getClimb, prefersReducedMotion, subscribeClimb } from "../climb/climb";
import { journeyAt } from "../climb/position";
import {
  sourcesFor,
  STILL_POSITIONS,
  stillOpacity,
  stillsWanted,
  WIDE_FROM,
  type StillPosition,
} from "./stills";

/** The page's own sky under each picture: shown until the picture arrives, or if it never does. */
const SKY: Record<StillPosition, string> = {
  opening: "bg-light-trailhead",
  trailhead: "bg-stage-trailhead",
  "long-approach": "bg-stage-long-approach",
  "steep-switch": "bg-stage-steep-switch",
  ridge: "bg-stage-ridge",
  "high-camp": "bg-stage-high-camp",
  summit: "bg-summit-sky",
};

/**
 * The still tier's picture of the mountain, where the canvas would have been: fixed behind the
 * text, one picture of the scene for the opening screen, each Stage and the Summit view. As the
 * Visitor scrolls, the next picture fades in over the last (or simply replaces it, when reduced
 * motion is requested). Nothing is drawn by WebGL and no 3D code is loaded. A picture is asked
 * for only when the Visitor is near it, the first at once, and each has its dimensions so
 * nothing moves when it arrives.
 */
export function StillBackdrop({ media }: { media: MediaItem[] }) {
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const [wanted, setWanted] = useState<number[]>(() =>
    stillsWanted(journeyAt(getClimb())),
  );

  useEffect(() => {
    document.documentElement.dataset.scene = "on";
    return () => {
      delete document.documentElement.dataset.scene;
    };
  }, []);

  useEffect(() => {
    const update = () => {
      const u = journeyAt(getClimb());
      const reduced = prefersReducedMotion();
      layers.current.forEach((layer, k) => {
        if (layer) layer.style.opacity = String(stillOpacity(u, k, reduced));
      });
      // Pictures near the Visitor are added, and stay once they are there.
      setWanted((have) => {
        const next = stillsWanted(u).filter((k) => !have.includes(k));
        return next.length ? [...have, ...next] : have;
      });
    };
    update();
    return subscribeClimb(update);
  }, []);

  return (
    <div
      aria-hidden="true"
      data-testid="still-backdrop"
      className="scene-layer pointer-events-none fixed inset-0 -z-10"
    >
      {STILL_POSITIONS.map((position, k) => (
        <div
          key={position}
          ref={(element) => {
            layers.current[k] = element;
          }}
          data-still={position}
          className={`${SKY[position]} absolute inset-0`}
          style={{ opacity: k === 0 ? 1 : 0 }}
        >
          {wanted.includes(k) && (
            <StillPicture media={media} position={position} first={k === 0} />
          )}
        </div>
      ))}
      {/* Behind the altitude meter's rail on wide screens, so its labels stay readable. */}
      <div className="bg-rail-shade absolute inset-y-0 right-0 hidden w-72 lg:block" />
    </div>
  );
}

/** The picture always fills the width of the screen. */
const FILL = ["100", "vw"].join("");

function StillPicture({
  media,
  position,
  first,
}: {
  media: MediaItem[];
  position: StillPosition;
  first: boolean;
}) {
  const wide = sourcesFor(media, position, "wide");
  const narrow = sourcesFor(media, position, "narrow");
  const base = narrow ?? wide;
  if (!base) return null;
  const wideQuery = `(min-width: ${WIDE_FROM}px)`;
  return (
    <picture>
      {wide &&
        wide.sources.map((source) => (
          <source
            key={`wide-${source.type}`}
            media={wideQuery}
            type={source.type}
            srcSet={source.srcSet}
            sizes={FILL}
            width={wide.fallback.width ?? undefined}
            height={wide.fallback.height ?? undefined}
          />
        ))}
      {narrow &&
        narrow.sources.map((source) => (
          <source
            key={`narrow-${source.type}`}
            type={source.type}
            srcSet={source.srcSet}
            sizes={FILL}
            width={narrow.fallback.width ?? undefined}
            height={narrow.fallback.height ?? undefined}
          />
        ))}
      <img
        alt=""
        src={base.fallback.url}
        width={base.fallback.width ?? undefined}
        height={base.fallback.height ?? undefined}
        loading={first ? "eager" : "lazy"}
        fetchPriority={first ? "high" : "auto"}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </picture>
  );
}
