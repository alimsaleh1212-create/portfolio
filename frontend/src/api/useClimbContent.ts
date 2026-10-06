import { useQueries } from "@tanstack/react-query";

import { mediaQuery, profileQuery, projectsQuery, stagesQuery } from "./client";
import type { MediaItem, Profile, Project, Stage } from "./types";

export type ClimbContentState =
  | { status: "loading" }
  | { status: "error"; retry: () => void; retrying: boolean }
  | {
      status: "ready";
      stages: Stage[];
      profile: Profile;
      projects: Project[];
      media: MediaItem[];
    };

/**
 * Everything the Climb shows, as one state. Like the Summary it waits for the media to
 * settle (a failure counts as no media), so the Video CV is in the first paint and
 * nothing moves when it arrives.
 */
export function useClimbContent(): ClimbContentState {
  const [stages, profile, projects, media] = useQueries({
    queries: [stagesQuery, profileQuery, projectsQuery, mediaQuery],
  });
  const required = [stages, profile, projects];

  if (required.some((query) => query.isError)) {
    return {
      status: "error",
      retrying: required.some((query) => query.isFetching),
      retry: () => {
        for (const query of required) if (query.isError) void query.refetch();
      },
    };
  }
  if (
    stages.data &&
    profile.data &&
    projects.data &&
    (media.data || media.isError)
  ) {
    return {
      status: "ready",
      stages: stages.data,
      profile: profile.data,
      projects: projects.data,
      media: media.data ?? [],
    };
  }
  return { status: "loading" };
}
