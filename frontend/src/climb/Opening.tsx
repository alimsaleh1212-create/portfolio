import { Link } from "react-router";

import type { Profile } from "../api/types";
import { buttonClass } from "../components/Button";
import { scrollToStage } from "./climb";
import { padClass } from "./StageSection";

/**
 * The opening screen: who this is, what the page is, how to begin, and the way out for a
 * Visitor in a hurry. Both calls to act stay on the first screen at 320 pixels wide.
 */
export function Opening({
  profile,
  firstStage,
}: {
  profile: Profile;
  firstStage: string;
}) {
  return (
    <section
      aria-labelledby="climb-title"
      className={`bg-light-trailhead relative flex min-h-dvh flex-col overflow-hidden pt-10 pb-section md:pt-section-wide ${padClass}`}
    >
      <div className="max-w-page relative z-10 mx-auto w-full">
        <div className="max-w-measure animate-rise">
          <h1
            id="climb-title"
            translate="no"
            className="text-display font-semibold tracking-tight"
          >
            {profile.name}
          </h1>
          <p className="text-ink mt-4 text-lg leading-snug">
            {profile.headline}
          </p>
          <p className="text-ink-muted mt-3">
            My career as a climb up a mountain, from the Trailhead to High Camp.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-3">
            <a
              href={`#${firstStage}`}
              onClick={(event) => {
                event.preventDefault();
                scrollToStage(firstStage);
              }}
              className={`${buttonClass} inline-block`}
            >
              Begin the Climb
            </a>
            <Link
              to="/summary"
              className="border-line-strong rounded-control press hover-fine:border-accent inline-block border px-5 py-3 font-medium"
            >
              Read the Summary
            </Link>
          </div>
        </div>
      </div>
      {/* The first ridgelines. The mountain of ticket #15 replaces them. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48 md:h-72"
      >
        <div className="bg-light-long-approach ridgeline-far absolute inset-0" />
        <div className="bg-light-steep-switch ridgeline-near absolute inset-x-0 bottom-0 h-3/5" />
      </div>
    </section>
  );
}
