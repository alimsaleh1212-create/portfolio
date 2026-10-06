import { useEffect } from "react";
import { useLocation } from "react-router";

import type { ClimbContentState } from "../api/useClimbContent";
import { useClimbContent } from "../api/useClimbContent";
import { Button } from "../components/Button";
import { AltitudeMeter } from "../climb/AltitudeMeter";
import { trackClimb } from "../climb/climb";
import { Opening } from "../climb/Opening";
import { padClass, StageSection } from "../climb/StageSection";
import { SummitAhead } from "../climb/SummitAhead";
import { usePageTitle } from "../usePageTitle";
import { recordStageReached } from "../visit/visit";

// The trail switches back up the slope, so the text changes sides from Stage to Stage.
const SIDES = {
  trailhead: "left",
  "long-approach": "right",
  "steep-switch": "left",
  ridge: "left",
  "high-camp": "right",
} as const;

/** The Climb: the opening screen, the five Stages, the Summit ahead and the contact section. */
export function ClimbPage() {
  usePageTitle("Climb");
  const state = useClimbContent();
  if (state.status === "loading") return <ClimbSkeleton />;
  if (state.status === "error") {
    return <ClimbError retry={state.retry} retrying={state.retrying} />;
  }
  return <ClimbContent {...state} />;
}

function ClimbContent({
  stages,
  profile,
  projects,
  media,
}: Extract<ClimbContentState, { status: "ready" }>) {
  const { hash } = useLocation();
  const keys = stages.map((stage) => stage.key);
  const keyList = keys.join(",");

  // An address ending in a Stage's key opens at that Stage. The browser cannot do it
  // itself: the Stages did not exist when the page loaded. Declared before the tracker,
  // so the tracker's first reading already sees the Visitor at the Stage.
  useEffect(() => {
    const target = decodeURIComponent(hash.slice(1));
    if (!keyList.split(",").includes(target)) return;
    const element = document.getElementById(target);
    element?.scrollIntoView({ behavior: "auto", block: "start" });
    element?.focus({ preventScroll: true });
    // Only the address the page was opened at; later moves are the Visitor's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyList]);

  useEffect(
    () => trackClimb(keyList.split(","), recordStageReached),
    [keyList],
  );

  return (
    <div>
      <Opening profile={profile} firstStage={keys[0]} />
      <AltitudeMeter stages={stages.map(({ key, name }) => ({ key, name }))} />
      {stages.map((stage) => (
        <StageSection
          key={stage.key}
          stage={stage}
          side={SIDES[stage.key]}
          projects={projects}
          media={media}
        />
      ))}
      <SummitAhead links={profile.links} />
    </div>
  );
}

/** Holds the opening screen's height, so nothing jumps when the content arrives. */
function ClimbSkeleton() {
  const bar = "bg-raised rounded-control animate-hush";
  return (
    <div
      aria-busy="true"
      className={`bg-light-trailhead min-h-dvh pt-10 md:pt-section-wide ${padClass}`}
    >
      <p role="status" className="sr-only">
        Loading the Climb…
      </p>
      <div aria-hidden="true" className="max-w-page mx-auto">
        <div className="max-w-measure">
          <div className={`${bar} h-14 w-3/4`} />
          <div className={`${bar} mt-6 h-6 w-full`} />
          <div className={`${bar} mt-2 h-6 w-2/3`} />
          <div className={`${bar} mt-8 h-12 w-48`} />
        </div>
      </div>
    </div>
  );
}

function ClimbError({
  retry,
  retrying,
}: {
  retry: () => void;
  retrying: boolean;
}) {
  return (
    <div
      className={`bg-light-trailhead min-h-dvh pt-10 md:pt-section-wide ${padClass}`}
    >
      <div className="max-w-page mx-auto">
        <div role="alert" className="max-w-measure">
          <h1 className="text-2xl font-semibold tracking-snug">
            The Climb did not load
          </h1>
          <p className="text-ink-muted mt-3">
            The content could not be loaded from the server. Check your
            connection, then try again.
          </p>
        </div>
        <Button onClick={retry} disabled={retrying} className="mt-6">
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      </div>
    </div>
  );
}
