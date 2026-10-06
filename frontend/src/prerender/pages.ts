import type { Project } from "../api/types";

/** Which queries a page's HTML was drawn from, and so which the browser is given. */
export type QueryName = "profile" | "stages" | "projects" | "media";

export interface PageSpec {
  /** The address the page is drawn at. */
  path: string;
  /** Where the page is written, relative to the output folder. */
  file: string;
  /** Whether it is listed in the sitemap. */
  indexable: boolean;
  /** The content this page's components read. */
  queries: QueryName[];
}

/** Drawn at addresses no real page has, to be what Caddy sends with a 404. */
export const NOT_FOUND_PATH = "/page-not-found";
export const PROJECT_NOT_FOUND_PATH = "/projects/_project-not-found_";

/**
 * Every page the site has, from the Projects the API returned: the landing page, the Summary
 * and one page per Project. A Project that is added or removed in the content changes this list
 * and nothing else.
 */
export function indexablePages(projects: Project[]): PageSpec[] {
  return [
    {
      path: "/",
      file: "index.html",
      indexable: true,
      queries: ["stages", "profile", "projects", "media"],
    },
    {
      path: "/summary",
      file: "summary.html",
      indexable: true,
      queries: ["profile", "projects", "media"],
    },
    ...projects.map((project): PageSpec => ({
      path: `/projects/${project.slug}`,
      file: `projects/${project.slug}.html`,
      indexable: true,
      queries: ["projects", "media"],
    })),
  ];
}

/**
 * Real routes that are not for search engines, and the two pages Caddy answers a 404 with:
 * one for any unknown address, one for an address under `/projects/` (which the router reads
 * as a Project that does not exist, so its page must be drawn that way to hydrate).
 */
export function otherPages(): PageSpec[] {
  return [
    { path: "/status", file: "status.html", indexable: false, queries: [] },
    { path: NOT_FOUND_PATH, file: "404.html", indexable: false, queries: [] },
    {
      path: PROJECT_NOT_FOUND_PATH,
      file: "404-project.html",
      indexable: false,
      queries: ["projects", "media"],
    },
  ];
}

export function allPages(projects: Project[]): PageSpec[] {
  return [...indexablePages(projects), ...otherPages()];
}
