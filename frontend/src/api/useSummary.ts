import { useQueries } from "@tanstack/react-query";

import { mediaQuery, profileQuery, projectsQuery } from "./client";
import type { MediaItem, Profile, Project } from "./types";

export type SummaryState =
  | { status: "loading" }
  | { status: "error"; retry: () => void; retrying: boolean }
  | {
      status: "ready";
      profile: Profile;
      projects: Project[];
      media: MediaItem[];
    };

/**
 * Everything the Summary shows: the profile, the six Projects and the media, as one
 * state. The page waits for the media to settle so the Portrait is there from the first
 * paint and nothing moves when it arrives; if the media cannot be had, the page shows
 * without it.
 */
export function useSummary(): SummaryState {
  const [profile, projects, media] = useQueries({
    queries: [profileQuery, projectsQuery, mediaQuery],
  });

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
  if (profile.data && projects.data && (media.data || media.isError)) {
    return {
      status: "ready",
      profile: profile.data,
      projects: projects.data,
      media: media.data ?? [],
    };
  }
  return { status: "loading" };
}
