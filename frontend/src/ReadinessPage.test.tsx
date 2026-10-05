import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadinessPage } from "./ReadinessPage";

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

const ok = { status: "ok", detail: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReadinessPage", () => {
  it("shows every dependency as healthy", async () => {
    stubFetch(200, { status: "ok", checks: { postgres: ok, redis: ok, minio: ok } });

    render(<ReadinessPage />);

    expect(await screen.findByText("Postgres: healthy")).toBeInTheDocument();
    expect(screen.getByText("Redis: healthy")).toBeInTheDocument();
    expect(screen.getByText("MinIO: healthy")).toBeInTheDocument();
  });

  it("marks only the failing dependency as failing", async () => {
    stubFetch(503, {
      status: "fail",
      checks: { postgres: ok, redis: { status: "fail", detail: "unavailable" }, minio: ok },
    });

    render(<ReadinessPage />);

    expect(await screen.findByText("Redis: failing (unavailable)")).toBeInTheDocument();
    expect(screen.getByText("Postgres: healthy")).toBeInTheDocument();
    expect(screen.getByText("MinIO: healthy")).toBeInTheDocument();
  });

  it("says the API is unreachable when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    render(<ReadinessPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("API unreachable");
  });

  it("says the API is unreachable when a proxy returns a non-API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })),
    );

    render(<ReadinessPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("API unreachable");
  });
});
