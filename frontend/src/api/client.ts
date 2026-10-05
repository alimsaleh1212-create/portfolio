import { QueryClient, queryOptions } from "@tanstack/react-query";

import type { MediaItem, Profile, Project } from "./types";

const API_ROOT = "/api/v1";

/** The API answered with an error status, or its answer was not usable. */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** GET a JSON resource from the API. Network failures and bad answers become `ApiError`. */
export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError("The server could not be reached.");
  }
  if (!response.ok) {
    throw new ApiError(`The server answered with status ${response.status}.`, response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("The server sent an answer that could not be read.", response.status);
  }
}

export const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: () => getJson<Profile>("/profile"),
});

export const projectsQuery = queryOptions({
  queryKey: ["projects"],
  queryFn: () => getJson<Project[]>("/projects"),
});

/** Media is a decoration: when it cannot be had the page is shown without it, so no retry. */
export const mediaQuery = queryOptions({
  queryKey: ["media"],
  queryFn: () => getJson<MediaItem[]>("/media"),
  retry: false,
});

/** Content changes only when the seed runs, so cache it for the visit. One quick retry, then show the error. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: 600, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });
}
