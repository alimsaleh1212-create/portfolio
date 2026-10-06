import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createQueryClient } from "../api/client";
import { projects } from "../test/fixtures";
import { answerWithContent, json } from "../test/render";
import { resetVisitForTests, startVisit } from "./visit";

const ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";

/** Answers the content endpoints and the Visit ones; returns the Visit calls. */
function stubSite() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/visits")) {
        calls.push({ url, init });
        return Promise.resolve(
          url.endsWith("/visits")
            ? json({ id: ID }, 201)
            : new Response(null, { status: 204 }),
        );
      }
      return Promise.resolve(answerWithContent(url));
    }),
  );
  return calls;
}

function renderStrict(url: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { retry: false, staleTime: Infinity },
  });
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <App queryClient={queryClient} />
      </MemoryRouter>
    </StrictMode>,
  );
}

const cookieWrites = vi.fn();
const storageCalls = vi.fn();

beforeEach(() => {
  resetVisitForTests();
  cookieWrites.mockClear();
  storageCalls.mockClear();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
    set: (value: string) => cookieWrites(value),
  });
  for (const method of [
    "setItem",
    "getItem",
    "removeItem",
    "clear",
    "key",
  ] as const)
    vi.spyOn(Storage.prototype, method).mockImplementation(
      (...args: unknown[]) => {
        storageCalls(method, ...args);
        return null;
      },
    );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Remove the instance property so jsdom's own cookie accessor is back.
  Reflect.deleteProperty(document, "cookie");
});

describe("a Visit through the real pages", () => {
  const project = projects[2];

  it("records the Project opened once per page view, even under strict mode", async () => {
    const calls = stubSite();
    startVisit();
    renderStrict(`/projects/${project.slug}`);
    await screen.findByRole("heading", { level: 1, name: project.name });

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].url).toBe("/api/v1/visits");
    expect(calls[1].url).toBe(`/api/v1/visits/${ID}/events`);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      type: "project_opened",
      project: project.slug,
    });
  });

  it("records nothing for an unknown Project", async () => {
    const calls = stubSite();
    startVisit();
    renderStrict("/projects/no-such-project");
    await screen.findByRole("heading", { name: "Project not found" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls.map((call) => call.url)).toEqual(["/api/v1/visits"]);
  });

  it("records the CV download without stopping the download", async () => {
    const calls = stubSite();
    startVisit();
    renderStrict("/summary");
    const link = await screen.findByRole("link", { name: /Download CV/ });
    // jsdom cannot download; stop it navigating and check the click was not cancelled.
    let cancelled = false;
    link.addEventListener("click", (event) => {
      cancelled = event.defaultPrevented;
      event.preventDefault();
    });
    await userEvent.click(link);

    await waitFor(() =>
      expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({
        type: "cv_downloaded",
      }),
    );
    expect(cancelled).toBe(false);
  });

  it("writes no cookie and touches no local or session storage", async () => {
    const calls = stubSite();
    // jsdom cannot navigate to a download.
    document.addEventListener("click", (event) => event.preventDefault());
    startVisit();
    renderStrict(`/projects/${project.slug}`);
    await screen.findByRole("heading", { level: 1, name: project.name });
    await waitFor(() => expect(calls).toHaveLength(2));
    await userEvent.click(
      screen.getByRole("link", { name: /Back to the Summary/ }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: /Download CV/ }),
    );

    expect(cookieWrites).not.toHaveBeenCalled();
    expect(storageCalls).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    for (const call of calls) expect(call.init?.credentials).toBe("omit");
  });
});
