import { StrictMode, useEffect } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordEvent, resetVisitForTests, startVisit } from "./visit";

const ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";

const created = () => new Response(JSON.stringify({ id: ID }), { status: 201 });

/** A fetch whose answer to the Visit request is released by the test. */
function pendingVisit() {
  let release: (response: Response) => void = () => {};
  const answer = new Promise<Response>((resolve) => (release = resolve));
  const fetchMock = vi.fn<typeof fetch>((input) =>
    String(input).endsWith("/visits")
      ? answer
      : Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release };
}

const urls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map((call) => String(call[0]));
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, index: number) =>
  JSON.parse(String((fetchMock.mock.calls[index][1] as RequestInit).body));

beforeEach(() => resetVisitForTests());
afterEach(() => vi.unstubAllGlobals());

describe("starting a Visit", () => {
  it("sends the device class, and no tier", async () => {
    const { fetchMock, release } = pendingVisit();
    startVisit();
    release(created());

    expect(urls(fetchMock)).toEqual(["/api/v1/visits"]);
    expect(bodyOf(fetchMock, 0)).toEqual({ device: "desktop" });
  });

  it("sends the tier it was started with", () => {
    const { fetchMock, release } = pendingVisit();
    startVisit("light");
    release(created());

    expect(bodyOf(fetchMock, 0)).toEqual({ device: "desktop", tier: "light" });
  });

  it("still starts when no tier is known", () => {
    const { fetchMock } = pendingVisit();
    startVisit(undefined);

    expect(urls(fetchMock)).toEqual(["/api/v1/visits"]);
    expect(bodyOf(fetchMock, 0)).not.toHaveProperty("tier");
  });

  it("starts one Visit however often it is called", () => {
    const { fetchMock } = pendingVisit();
    startVisit();
    startVisit();
    startVisit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts one Visit under strict mode, which runs effects twice", () => {
    const { fetchMock } = pendingVisit();
    function Probe() {
      useEffect(() => startVisit(), []);
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for no cookies and lets the request outlive the page", () => {
    const { fetchMock } = pendingVisit();
    startVisit();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("omit");
    expect(init.keepalive).toBe(true);
  });
});

describe("events", () => {
  it("held before the ID arrives are sent once it has, in order", async () => {
    const { fetchMock, release } = pendingVisit();
    startVisit();
    recordEvent({ type: "project_opened", project: "alpha" });
    recordEvent({ type: "cv_downloaded" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(created());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(urls(fetchMock).slice(1)).toEqual([
      `/api/v1/visits/${ID}/events`,
      `/api/v1/visits/${ID}/events`,
    ]);
    expect(bodyOf(fetchMock, 1)).toEqual({
      type: "project_opened",
      project: "alpha",
    });
    expect(bodyOf(fetchMock, 2)).toEqual({ type: "cv_downloaded" });
  });

  it("are sent at once after the ID, and survive the page being left", async () => {
    const { fetchMock, release } = pendingVisit();
    startVisit();
    release(created());
    await new Promise((resolve) => setTimeout(resolve, 10));

    recordEvent({ type: "stage_reached", stage: "ridge" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe("omit");
  });

  it("are dropped without a request when no Visit was started", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    recordEvent({ type: "cv_downloaded" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("when no ID comes back", () => {
  const failures: [string, () => Promise<Response>][] = [
    [
      "a bot answer (204)",
      () => Promise.resolve(new Response(null, { status: 204 })),
    ],
    [
      "a rate limit (429)",
      () => Promise.resolve(new Response("{}", { status: 429 })),
    ],
    [
      "a server error",
      () => Promise.resolve(new Response("x", { status: 500 })),
    ],
    ["a network failure", () => Promise.reject(new TypeError("offline"))],
    [
      "an unreadable answer",
      () => Promise.resolve(new Response("<html>", { status: 201 })),
    ],
    [
      "an ID that is not an ID",
      () => Promise.resolve(new Response('{"id":"../x"}', { status: 201 })),
    ],
  ];

  it.each(failures)("sends nothing after %s", async (_name, answer) => {
    const fetchMock = vi.fn(answer);
    vi.stubGlobal("fetch", fetchMock);
    startVisit();
    recordEvent({ type: "cv_downloaded" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    recordEvent({ type: "cv_downloaded" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("failures", () => {
  it("never throw into the page when an event cannot be sent", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) =>
      String(input).endsWith("/visits")
        ? Promise.resolve(created())
        : Promise.reject(new TypeError("offline")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    startVisit();
    recordEvent({ type: "cv_downloaded" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(() => recordEvent({ type: "cv_downloaded" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never throw when fetch itself throws", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("boom");
      }),
    );
    expect(() => startVisit()).not.toThrow();
    expect(() => recordEvent({ type: "cv_downloaded" })).not.toThrow();
  });
});
