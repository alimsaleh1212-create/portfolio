import { findMedia } from "../api/media";
import { Button } from "../components/Button";
import { CvDownload } from "../components/CvDownload";
import { Portrait } from "../components/Portrait";
import { VideoCv } from "../components/VideoCv";
import { TagList } from "../components/TagList";
import { useSummary } from "../api/useSummary";
import type { MediaItem, Profile, Project } from "../api/types";
import { usePageTitle } from "../usePageTitle";

const SECTIONS = [
  { id: "experience", label: "Experience" },
  { id: "projects", label: "Projects" },
  { id: "skills", label: "Skills" },
  { id: "education", label: "Education" },
] as const;

const pageClass = "px-gutter md:px-gutter-wide py-section md:py-section-wide";
const gridClass = "max-w-page mx-auto grid gap-x-16 gap-y-12 lg:grid-cols-12";
const h2Class = "text-xl font-semibold tracking-snug";

/** The Summary: the career on one plain page. Data comes from the API. */
export function SummaryPage() {
  usePageTitle("Summary");
  const state = useSummary();

  if (state.status === "loading") return <SummarySkeleton />;
  if (state.status === "error") {
    return <SummaryError retry={state.retry} retrying={state.retrying} />;
  }
  return <SummaryContent profile={state.profile} projects={state.projects} media={state.media} />;
}

function SummaryContent({
  profile,
  projects,
  media,
}: {
  profile: Profile;
  projects: Project[];
  media: MediaItem[];
}) {
  // A role that was not seeded is simply not drawn: no frame, no link.
  const portrait = findMedia(media, "portrait");
  const video = findMedia(media, "video_cv");
  const cv = findMedia(media, "cv_pdf");
  // A section with nothing in it is left out, along with its jump link.
  const present = {
    experience: profile.experience.length > 0,
    projects: projects.length > 0,
    skills: profile.skills.length > 0,
    education: profile.education.length > 0,
  };
  return (
    <div className={`relative animate-rise ${pageClass}`}>
      {/* First light behind the identity column, fading into night. */}
      <div
        aria-hidden="true"
        className="bg-dawn pointer-events-none absolute inset-x-0 top-0 h-96"
      />
      <div className={`relative ${gridClass}`}>
        <aside className="lg:col-span-4">
          {portrait && <Portrait item={portrait} />}
          <h1
            translate="no"
            className={`text-display font-semibold tracking-tight ${portrait ? "mt-6" : ""}`}
          >
            {profile.name}
          </h1>
          <p className="text-ink-muted mt-4 text-lg leading-snug">{profile.headline}</p>
          <p className="text-ink-muted mt-2 font-mono text-sm">{profile.location}</p>

          <nav aria-label="Contact" className="mt-8">
            <ul className="space-y-4">
              <ContactLink
                label="Email"
                href={`mailto:${profile.links.email}`}
                text={profile.links.email}
              />
              <ContactLink
                label="LinkedIn"
                href={profile.links.linkedin}
                text={displayUrl(profile.links.linkedin)}
              />
              <ContactLink
                label="GitHub"
                href={profile.links.github}
                text={displayUrl(profile.links.github)}
              />
            </ul>
          </nav>

          {cv && <CvDownload item={cv} />}

          <nav aria-label="On this page" className="mt-8">
            <ul className="border-line flex flex-wrap gap-x-5 gap-y-1 lg:block lg:space-y-1 lg:border-s">
              {SECTIONS.filter(({ id }) => present[id]).map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-ink-muted hover:text-ink block py-2 text-sm transition-colors lg:-ms-px lg:border-s lg:border-transparent lg:py-1 lg:ps-4 lg:hover:border-accent"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="lg:col-span-8">
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="sr-only">
              About
            </h2>
            <p className="max-w-measure text-lg">{profile.summary}</p>
          </section>
          {video && <VideoCv item={video} />}

          {present.experience && (
            <section
              id="experience"
              aria-labelledby="experience-heading"
              className="mt-section md:mt-section-wide scroll-mt-8"
            >
              <h2 id="experience-heading" className={h2Class}>
                Experience
              </h2>
              <ol className="mt-8 space-y-12">
                {profile.experience.map((job) => (
                  <li key={`${job.role}-${job.period}`}>
                    <article>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                        <h3 className="text-lg font-semibold">{job.role}</h3>
                        <p className="text-ink-muted font-mono text-sm tabular-nums">
                          {job.period}
                        </p>
                      </div>
                      <p className="text-ink-muted mt-1">
                        {job.organization}
                        {job.location ? `, ${job.location}` : ""}
                      </p>
                      <ul className="marker:text-accent mt-4 list-disc space-y-3 ps-5">
                        {job.highlights.map((highlight) => (
                          <li key={highlight} className="max-w-measure ps-1">
                            {highlight}
                          </li>
                        ))}
                      </ul>
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {present.projects && (
            <section
              id="projects"
              aria-labelledby="projects-heading"
              className="mt-section md:mt-section-wide scroll-mt-8"
            >
              <h2 id="projects-heading" className={h2Class}>
                Projects
              </h2>
              <ul className="divide-line mt-8 divide-y">
                {projects.map((project) => (
                  <li key={project.slug} className="py-8 first:pt-0">
                    <article>
                      <h3 className="text-lg font-semibold">{project.name}</h3>
                      <p className="text-ink-muted mt-1">{project.tagline}</p>
                      <p className="max-w-measure mt-4">{project.description}</p>
                      {project.metrics.length > 0 && (
                        <ul aria-label="Metrics" className="mt-5 space-y-2">
                          {project.metrics.map((metric) => (
                            <li
                              key={metric.value}
                              className="flex flex-wrap items-baseline gap-x-3 gap-y-0"
                            >
                              <span className="text-accent text-xl font-semibold tabular-nums">
                                {metric.value}
                              </span>{" "}
                              <span className="max-w-measure">{metric.label}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-4">
                        <TagList items={project.stack} label={`${project.name} stack`} />
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {present.skills && (
            <section
              id="skills"
              aria-labelledby="skills-heading"
              className="mt-section md:mt-section-wide scroll-mt-8"
            >
              <h2 id="skills-heading" className={h2Class}>
                Skills
              </h2>
              <dl className="divide-line mt-8 divide-y">
                {profile.skills.map((group) => (
                  <div key={group.category} className="grid gap-3 py-5 first:pt-0 sm:grid-cols-3">
                    <dt className="text-ink-muted text-sm font-medium sm:pt-1">{group.category}</dt>
                    <dd className="sm:col-span-2">
                      <ul
                        aria-label={group.category}
                        translate="no"
                        className="gap-x-8 sm:columns-2"
                      >
                        {group.items.map((item) => (
                          <li key={item} className="break-inside-avoid py-1 leading-snug">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {present.education && (
            <section
              id="education"
              aria-labelledby="education-heading"
              className="mt-section md:mt-section-wide scroll-mt-8"
            >
              <h2 id="education-heading" className={h2Class}>
                Education
              </h2>
              <ul className="mt-8 space-y-6">
                {profile.education.map((item) => (
                  <li key={item.title}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="text-ink-muted font-mono text-sm tabular-nums">{item.year}</p>
                    </div>
                    <p className="text-ink-muted">
                      {item.institution}, {item.location}
                    </p>
                  </li>
                ))}
              </ul>

              {profile.certifications.length > 0 && (
                <>
                  <h3 className="mt-12 text-lg font-semibold">Certifications</h3>
                  <ul className="mt-4 space-y-4">
                    {profile.certifications.map((cert) => (
                      <li key={cert.title}>
                        <p className="font-semibold">{cert.title}</p>
                        <p className="text-ink-muted">{cert.issuer}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactLink({ label, href, text }: { label: string; href: string; text: string }) {
  return (
    <li>
      <span className="text-ink-muted block text-sm">{label}</span>
      <a href={href} translate="no" className="link break-words font-mono text-sm">
        {text}
      </a>
    </li>
  );
}

/** "https://linkedin.com/in/x" becomes "linkedin.com/in/x". */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Holds the layout of the loaded page, so nothing jumps when the data arrives. */
function SummarySkeleton() {
  const bar = "bg-raised rounded-control animate-hush";
  return (
    <div className={pageClass} aria-busy="true">
      <p role="status" className="sr-only">
        Loading the summary…
      </p>
      <div aria-hidden="true" className={gridClass}>
        <div className="lg:col-span-4">
          <div className={`${bar} h-14 w-3/4`} />
          <div className={`${bar} mt-4 h-6 w-full`} />
          <div className={`${bar} mt-2 h-6 w-2/3`} />
          <div className={`${bar} mt-8 h-5 w-full`} />
          <div className={`${bar} mt-2 h-5 w-full`} />
          <div className={`${bar} mt-2 h-5 w-full`} />
        </div>
        <div className="space-y-4 lg:col-span-8">
          <div className={`${bar} h-6 w-full`} />
          <div className={`${bar} h-6 w-full`} />
          <div className={`${bar} h-6 w-4/5`} />
          <div className={`${bar} !mt-section h-8 w-1/3`} />
          <div className={`${bar} h-40 w-full`} />
          <div className={`${bar} !mt-section h-8 w-1/3`} />
          <div className={`${bar} h-56 w-full`} />
        </div>
      </div>
    </div>
  );
}

function SummaryError({ retry, retrying }: { retry: () => void; retrying: boolean }) {
  return (
    <div className={pageClass}>
      <div className="max-w-page mx-auto">
        <div role="alert" className="max-w-measure">
          <h1 className="text-2xl font-semibold tracking-snug">The summary did not load</h1>
          <p className="text-ink-muted mt-3">
            The content could not be loaded from the server. Check your connection, then try again.
          </p>
        </div>
        <Button onClick={retry} disabled={retrying} className="mt-6">
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      </div>
    </div>
  );
}
