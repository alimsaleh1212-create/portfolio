import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

import { App } from "../App";
import { createQueryClient } from "../api/client";
import { profile, projects } from "./fixtures";

/** Stub `fetch` so each API path answers with the given handler's response. */
export function stubApi(handler: (path: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

export function answerWithContent(path: string): Response {
  if (path.endsWith("/profile")) return json(profile);
  if (path.endsWith("/projects")) return json(projects);
  return json({ detail: "not found" }, 404);
}

/** Render the whole app at a URL, with a client that does not retry or wait. */
export function renderApp(url: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App queryClient={queryClient} />
    </MemoryRouter>,
  );
}
