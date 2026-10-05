import { Link, useParams } from "react-router";

import { useProject } from "../api/useProject";
import type { Project } from "../api/types";
import { Button } from "../components/Button";
import { ProjectGallery } from "../components/ProjectGallery";
import { TagList } from "../components/TagList";
import { usePageTitle } from "../usePageTitle";

const pageClass =
  "px-gutter md:px-gutter-wide py-section md:py-section-wide lg:py-12";
const gridClass = "max-w-page mx-auto grid gap-x-16 gap-y-10 lg:grid-cols-12";
const labelClass = "text-ink-muted text-sm font-medium";

/** One Project: everything the API holds for it, on a page of its own. */
export function ProjectPage() {
  const { slug } = useParams();
  const state = useProject(slug);

  const title =
    state.status === "ready"
      ? state.project.name
      : state.status === "not-found"
        ? "Project not found"
        : state.status === "error"
          ? "Project did not load"
          : "Loading project";
  usePageTitle(title);

  if (state.status === "loading") return <ProjectSkeleton />;
  if (state.status === "error")
    return <ProjectError retry={state.retry} retrying={state.retrying} />;
  if (state.status === "not-found") return <ProjectNotFound />;
  return <ProjectContent {...state} />;
}

function ProjectContent({
  project,
  position,
  total,
  previous,
  next,
}: {
  project: Project;
  position: number;
  total: number;
  previous: Project | null;
  next: Project | null;
}) {
  const hasMetrics = project.metrics.length > 0;
  return (
    <div className={`relative animate-rise ${pageClass}`}>
      <div
        aria-hidden="true"
        className="bg-dawn pointer-events-none absolute inset-x-0 top-0 h-96"
      />
      <div className="relative">
        <div className="max-w-page mx-auto flex items-baseline justify-between gap-6">
          <Link to="/summary" className="link -my-2 py-2 text-sm">
            <span aria-hidden="true">&larr; </span>Back to the Summary
          </Link>
          <p className="text-ink-muted font-mono text-sm tabular-nums">
            Project {position} of {total}
          </p>
        </div>

        <div className="max-w-page mx-auto mt-10 md:mt-14">
          <h1
            translate="no"
            className="text-display max-w-measure font-semibold tracking-tight"
          >
            {project.name}
          </h1>
          <p className="text-ink-muted mt-4 max-w-measure text-lg leading-snug">
            {project.tagline}
          </p>
          <div
            aria-hidden="true"
            className="bg-horizon mt-10 h-px max-w-measure"
          />
        </div>

        <div className={`${gridClass} mt-10`}>
          <section
            aria-labelledby="description-heading"
            className="lg:col-span-7"
          >
            <h2 id="description-heading" className="sr-only">
              Description
            </h2>
            <p className="max-w-measure text-lg">{project.description}</p>
          </section>

          <aside className="space-y-10 lg:col-span-5 lg:border-s lg:border-line lg:ps-12">
            {hasMetrics && (
              <section aria-labelledby="metrics-heading">
                <h2 id="metrics-heading" className={labelClass}>
                  Result
                </h2>
                <ul className="mt-3 space-y-6">
                  {project.metrics.map((metric) => (
                    <li key={metric.value}>
                      <span className="text-accent text-display block font-semibold tracking-tight tabular-nums">
                        {metric.value}
                      </span>{" "}
                      <span className="mt-1 block max-w-measure">
                        {metric.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-labelledby="stack-heading">
              <h2 id="stack-heading" className={labelClass}>
                Stack
              </h2>
              <div className="mt-3">
                <TagList
                  items={project.stack}
                  label={`${project.name} stack`}
                />
              </div>
            </section>
          </aside>
        </div>

        <div className="max-w-page mx-auto">
          <ProjectGallery media={project.media} />
        </div>

        <nav
          aria-label="Other Projects"
          className="max-w-page mx-auto mt-section md:mt-section-wide"
        >
          <ul className="border-line grid gap-4 border-t pt-6 sm:grid-cols-2 sm:gap-8">
            <li className="sm:col-start-1">
              {previous && (
                <NeighbourLink project={previous} direction="previous" />
              )}
            </li>
            <li className="sm:col-start-2 sm:text-end">
              {next && <NeighbourLink project={next} direction="next" />}
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}

/** A link to the previous or next Project, labelled by direction with the name under it. */
function NeighbourLink({
  project,
  direction,
}: {
  project: Project;
  direction: "previous" | "next";
}) {
  return (
    <Link
      to={`/projects/${project.slug}`}
      rel={direction === "previous" ? "prev" : "next"}
      className="group rounded-control press -mx-3 block px-3 py-2"
    >
      <span className="text-ink-muted block text-sm">
        {direction === "previous" ? (
          <>
            <span aria-hidden="true">&larr; </span>Previous
          </>
        ) : (
          <>
            Next<span aria-hidden="true"> &rarr;</span>
          </>
        )}
      </span>
      <span
        translate="no"
        className="text-ink group-hover:text-accent mt-1 block text-lg font-semibold transition-colors"
      >
        {project.name}
      </span>
    </Link>
  );
}

/** An unknown slug: the request worked, there is just no such Project. */
function ProjectNotFound() {
  return (
    <div className={pageClass}>
      <div className="max-w-page mx-auto">
        <h1 className="text-2xl font-semibold tracking-snug">
          Project not found
        </h1>
        <p className="text-ink-muted mt-3 max-w-measure">
          There is no Project at this address. The Summary lists every Project.
        </p>
        <p className="mt-6">
          <Link to="/summary" className="link">
            Go to the Summary
          </Link>
        </p>
      </div>
    </div>
  );
}

function ProjectError({
  retry,
  retrying,
}: {
  retry: () => void;
  retrying: boolean;
}) {
  return (
    <div className={pageClass}>
      <div className="max-w-page mx-auto">
        <div role="alert" className="max-w-measure">
          <h1 className="text-2xl font-semibold tracking-snug">
            The project did not load
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

/** Holds the layout of the loaded page, so nothing jumps when the data arrives. */
function ProjectSkeleton() {
  const bar = "bg-raised rounded-control animate-hush";
  return (
    <div className={pageClass} aria-busy="true">
      <p role="status" className="sr-only">
        Loading the project…
      </p>
      <div aria-hidden="true">
        <div className="max-w-page mx-auto flex justify-between">
          <div className={`${bar} h-5 w-40`} />
          <div className={`${bar} h-5 w-28`} />
        </div>
        <div className="max-w-page mx-auto mt-10 md:mt-14">
          <div className={`${bar} h-14 w-3/4 max-w-measure`} />
          <div className={`${bar} mt-4 h-7 w-1/2 max-w-measure`} />
        </div>
        <div className={`${gridClass} mt-10`}>
          <div className="space-y-3 lg:col-span-7">
            <div className={`${bar} h-6 w-full max-w-measure`} />
            <div className={`${bar} h-6 w-full max-w-measure`} />
            <div className={`${bar} h-6 w-4/5 max-w-measure`} />
          </div>
          <div className="space-y-4 lg:col-span-5 lg:ps-12">
            <div className={`${bar} h-16 w-2/3`} />
            <div className={`${bar} h-8 w-full`} />
          </div>
        </div>
      </div>
    </div>
  );
}
