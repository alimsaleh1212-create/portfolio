import { Link } from "react-router";

import type { MediaItem, Project, Stage } from "../api/types";
import { findMedia } from "../api/media";
import { VideoCv } from "../components/VideoCv";

/** Side padding that leaves room for the altitude meter's rail on wide screens. */
export const padClass = "px-gutter md:px-gutter-wide lg:pe-44";

const SKY = {
  trailhead: "bg-stage-trailhead",
  "long-approach": "bg-stage-long-approach",
  "steep-switch": "bg-stage-steep-switch",
  ridge: "bg-stage-ridge",
  "high-camp": "bg-stage-high-camp",
} as const;

const SCRIM = {
  left: "bg-scrim-veil lg:bg-scrim-left",
  right: "bg-scrim-veil lg:bg-scrim-right",
  // The Ridge's cards sit over the scene themselves, so only its short text column is shaded.
  ridge: "bg-scrim-veil lg:bg-scrim-edge",
} as const;

const HORIZON = {
  trailhead: "bg-horizon-trailhead",
  "long-approach": "bg-horizon-long-approach",
  "steep-switch": "bg-horizon-steep-switch",
  ridge: "bg-horizon-ridge",
  "high-camp": "bg-horizon-high-camp",
} as const;

/**
 * One Stage: a full-height section whose text sits in a column on one side, so the
 * mountain behind it (ticket #15) has the other side to be seen in. The side alternates
 * as the trail switches back up the slope. Its id is the Stage's key: it is the
 * address of a direct link and what the Climb's position is measured from.
 */
export function StageSection({
  stage,
  side,
  projects,
  media,
}: {
  stage: Stage;
  side: "left" | "right";
  projects: Project[];
  media: MediaItem[];
}) {
  const isRidge = stage.key === "ridge";
  const video = stage.key === "high-camp" ? findMedia(media, "video_cv") : null;
  const textColumn = isRidge
    ? "lg:col-span-5 lg:col-start-1 lg:self-start lg:tall:sticky lg:tall:top-8"
    : side === "left"
      ? "lg:col-span-5 lg:col-start-1"
      : "lg:col-span-5 lg:col-start-7";

  return (
    <>
      <section
        id={stage.key}
        tabIndex={-1}
        aria-labelledby={`${stage.key}-heading`}
        className={`${SKY[stage.key]} scene:bg-none scene:overflow-visible scene:max-lg:min-h-0 relative flex min-h-dvh items-center overflow-hidden py-section md:py-section-wide focus:outline-none`}
      >
        {/* The horizon's warmth, on the side without text. Wide screens only: below that the text is all across. The 3D scene has its own. */}
        <div
          aria-hidden="true"
          className={`${HORIZON[stage.key]} scene:hidden pointer-events-none absolute inset-0 hidden lg:block`}
        />
        {/* With the scene behind, the text column is darkened so the text stays readable over it. On a narrow screen it is an even backing behind the text only, and the page leaves an open band after it. */}
        <div
          aria-hidden="true"
          className={`${SCRIM[isRidge ? "ridge" : side]} scrim-fade-fixed lg:scrim-fade scene:block pointer-events-none absolute -inset-y-section lg:-inset-y-40 hidden inset-x-0`}
        />
        <div className={`${padClass} relative w-full`}>
          <div
            className={`max-w-page mx-auto grid gap-x-16 gap-y-12 lg:grid-cols-12 ${isRidge ? "lg:items-start" : "lg:items-center"}`}
          >
            <div className={textColumn}>
              <div className="reveal">
                {stage.period && (
                  <p className="text-accent font-mono text-sm tabular-nums">
                    {stage.period}
                  </p>
                )}
                <h2
                  id={`${stage.key}-heading`}
                  className="text-title mt-2 font-semibold tracking-tight"
                >
                  {stage.name}
                </h2>
                <p className="max-w-measure mt-5 text-lg">{stage.body}</p>
              </div>
              <Challenge stage={stage} />
              {video && <VideoCv item={video} />}
            </div>
            {isRidge && (
              <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
                {projects.map((project) => (
                  <ProjectTile key={project.slug} project={project} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
      {/* Open band: where the scene shows unobstructed on a narrow screen. */}
      <div
        aria-hidden="true"
        data-testid="scene-band"
        className="scene-band pointer-events-none hidden scene:max-lg:block"
      />
    </>
  );
}

/** The Stage's Challenge. One that Ali has not written yet says so, plainly. */
function Challenge({ stage }: { stage: Stage }) {
  const placeholder = stage.challenge_is_placeholder;
  return (
    <div
      className={`reveal rounded-surface bg-ground/50 scene:bg-ground/72 mt-8 max-w-measure border p-5 ${
        placeholder ? "border-ink/30 border-dashed" : "border-ink/20"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-lg font-semibold">Challenge</h3>
        {placeholder && (
          <p className="text-accent border-accent rounded-control border px-2 text-sm font-medium">
            Not yet written
          </p>
        )}
      </div>
      <p className={`mt-2 ${placeholder ? "text-ink-muted" : ""}`}>
        {stage.challenge}
      </p>
    </div>
  );
}

/** A Project on the Ridge: enough to make a Visitor open it. The whole tile is the link. */
function ProjectTile({ project }: { project: Project }) {
  return (
    <li className="reveal group bg-ground/50 scene:bg-ground/62 scene:backdrop-blur-sm border-ink/15 rounded-surface relative border p-5 transition-colors has-focus-visible:border-accent hover-fine:border-accent">
      <h3 className="pe-6 text-lg leading-snug font-semibold">
        <Link
          to={`/projects/${project.slug}`}
          className="after:absolute after:inset-0"
        >
          {project.name}
        </Link>
      </h3>
      <span
        aria-hidden="true"
        className="text-accent absolute top-5 right-5 transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
      <p className="text-ink-muted mt-2 text-sm">{project.tagline}</p>
      {project.metrics.slice(0, 1).map((metric) => (
        <p key={metric.value} className="mt-4">
          <span className="text-accent block text-xl font-semibold tabular-nums">
            {metric.value}
          </span>
          <span className="text-ink-muted text-sm">{metric.label}</span>
        </p>
      ))}
    </li>
  );
}
