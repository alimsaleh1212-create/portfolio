import { useQuery } from "@tanstack/react-query";

import { projectsQuery } from "./client";
import type { Project } from "./types";

export type ProjectState =
  | { status: "loading" }
  | { status: "error"; retry: () => void; retrying: boolean }
  | { status: "not-found" }
  | {
      status: "ready";
      project: Project;
      /** Position in the API's order, from 1. */
      position: number;
      total: number;
      previous: Project | null;
      next: Project | null;
    };

/**
 * One Project by slug, with its neighbours in the API's order. It reads the list the Summary
 * already fetched, so moving between Projects needs no new request. A slug the list does not
 * hold is not-found, which is different from a request that failed.
 */
export function useProject(slug: string | undefined): ProjectState {
  const query = useQuery(projectsQuery);

  if (query.isError) {
    return {
      status: "error",
      retrying: query.isFetching,
      retry: () => void query.refetch(),
    };
  }
  if (!query.data) return { status: "loading" };

  const index = query.data.findIndex((project) => project.slug === slug);
  if (index === -1) return { status: "not-found" };
  return {
    status: "ready",
    project: query.data[index],
    position: index + 1,
    total: query.data.length,
    previous: query.data[index - 1] ?? null,
    next: query.data[index + 1] ?? null,
  };
}
