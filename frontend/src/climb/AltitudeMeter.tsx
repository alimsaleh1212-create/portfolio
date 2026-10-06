import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import {
  getClimb,
  scrollToStage,
  subscribeClimb,
  useCurrentStage,
  useStagePositions,
} from "./climb";

interface StageLabel {
  key: string;
  name: string;
}

const percent = (progress: number) => Math.round(progress * 100);

/**
 * The altitude meter: a marker per Stage, the current Stage lit, and how far up the
 * Climb the Visitor has come. Always on screen. On wide screens it is a rail down the
 * right edge with the Trailhead at the bottom and High Camp at the top, each marker at
 * its Stage's true place along the Climb. On narrow screens, where there is no room for
 * a rail, it is a bar along the bottom with one segment per Stage, and it appears once
 * the Climb has begun so it does not crowd the opening screen.
 *
 * A marker is a link to the Stage's own anchor, so it works with the keyboard, without
 * scripts, and the Visitor can copy it. Choosing one moves to the Stage (see
 * `scrollToStage`). It reads where the Visitor is from `climb.ts` and nothing else, so
 * the Expedition (milestone 2) can reuse it as it is.
 */
export function AltitudeMeter({ stages }: { stages: StageLabel[] }) {
  const current = useCurrentStage();
  const positions = useStagePositions();
  const fill = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const meter = useRef<HTMLDivElement>(null);

  const currentIndex = stages.findIndex((stage) => stage.key === current);
  const currentName = currentIndex >= 0 ? stages[currentIndex].name : null;

  // Progress changes on every frame of scrolling, so it is written straight to the
  // elements instead of going through React.
  useEffect(() => {
    const paint = () => {
      const { progress, stage } = getClimb();
      const value = percent(progress);
      const name = stages.find((item) => item.key === stage)?.name;
      if (fill.current) fill.current.style.transform = `scaleY(${progress})`;
      if (readout.current) readout.current.textContent = `${value}%`;
      meter.current?.setAttribute("aria-valuenow", String(value));
      meter.current?.setAttribute(
        "aria-valuetext",
        name ? `${name}, ${value}% of the way up` : `${value}% of the way up`,
      );
    };
    paint();
    return subscribeClimb(paint);
  }, [stages]);

  const started = current !== null;

  return (
    <nav
      aria-label="Altitude meter"
      className={`border-line bg-ground/90 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur-sm transition-opacity lg:inset-x-auto lg:top-1/2 lg:right-6 lg:bottom-auto lg:-translate-y-1/2 lg:border-0 lg:bg-transparent lg:backdrop-blur-none ${
        started ? "" : "max-lg:invisible max-lg:opacity-0"
      }`}
    >
      {/* Told once per Stage, politely, so scrolling past does not chatter. */}
      <p role="status" className="sr-only">
        {currentName ? `Now at ${currentName}` : ""}
      </p>

      {/* The one thing a screen reader reads as a value. Its children are only for the eye. */}
      <p
        role="meter"
        aria-label="Altitude"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        aria-valuetext="0% of the way up"
        ref={meter}
        className="px-gutter flex items-baseline justify-between gap-4 pt-3 text-sm lg:mb-3 lg:justify-end lg:px-0 lg:pt-0"
      >
        <span className="text-ink font-medium lg:hidden">{currentName}</span>
        <span className="text-ink-muted font-mono tabular-nums">
          <span ref={readout}>0%</span> climbed
        </span>
      </p>

      <div className="px-gutter lg:relative lg:h-72 lg:w-40 lg:px-0">
        {/* The rail and its fill, wide screens only. */}
        <div
          aria-hidden="true"
          className="bg-line-strong absolute inset-y-0 right-0 hidden w-px lg:block"
        />
        <div
          aria-hidden="true"
          ref={fill}
          className="bg-accent absolute inset-y-0 right-0 hidden w-px origin-bottom lg:block"
        />
        <ol className="flex gap-1 pb-1 lg:block lg:gap-0 lg:pb-0">
          {stages.map((stage, index) => {
            const position =
              positions.find((item) => item.key === stage.key)?.position ??
              index / Math.max(1, stages.length - 1);
            const lit = currentIndex >= index;
            const isCurrent = stage.key === current;
            return (
              <li
                key={stage.key}
                style={{ "--pos": `${position * 100}%` } as CSSProperties}
                className="flex-1 lg:absolute lg:inset-x-0 lg:bottom-(--pos) lg:flex-none lg:translate-y-1/2"
              >
                <a
                  href={`#${stage.key}`}
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    scrollToStage(stage.key);
                  }}
                  className="group rounded-control flex h-11 items-end lg:h-auto lg:items-center lg:justify-end lg:gap-3 lg:py-1.5"
                >
                  <span
                    className={`text-sm max-lg:sr-only lg:transition-colors ${
                      isCurrent
                        ? "text-ink font-medium"
                        : "text-ink-muted group-hover:text-ink"
                    }`}
                  >
                    {stage.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`rounded-control block h-1 w-full transition-colors lg:h-0.5 lg:w-4 lg:rounded-none ${
                      lit ? "bg-accent" : "bg-line-strong"
                    } ${isCurrent ? "" : "max-lg:opacity-60"}`}
                  />
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
