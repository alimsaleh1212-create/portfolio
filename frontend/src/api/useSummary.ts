import { useQueries } from "@tanstack/react-query";

import { profileQuery, projectsQuery } from "./client";
import type { Profile, Project } from "./types";

export type SummaryState =
  | { status: "loading" }
  | { status: "error"; retry: () => void; retrying: boolean }
  | { status: "ready"; profile: Profile; projects: Project[] };

/** Everything the Summary shows: the profile and the six Projects, as one state. */
export function useSummary(): SummaryState {
  const [profile, projects] = useQueries({ queries: [profileQuery, projectsQuery] });

  if (profile.isError || projects.isError) {
    return {
      status: "error",
      retrying: profile.isFetching || projects.isFetching,
      retry: () => {
        if (profile.isError) void profile.refetch();
        if (projects.isError) void projects.refetch();
      },
    };
  }
  if (profile.data && projects.data) {
    return { status: "ready", profile: profile.data, projects: projects.data };
  }
  return { status: "loading" };
}
