import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerWithContent, renderApp, stubApi } from "./test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routing and shell", () => {
  it("sends / to the Summary", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Ali Saleh" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Summary | Ali Saleh");
  });

  it("shows readiness at /status", async () => {
    stubApi(
      () =>
        new Response(JSON.stringify({ status: "ok", checks: {} }), {
          status: 200,
        }),
    );
    renderApp("/status");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Site status" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Status | Ali Saleh");
  });

  it("shows not-found inside the shell for an unknown route", () => {
    stubApi(answerWithContent);
    renderApp("/nowhere");
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the Summary" }),
    ).toHaveAttribute("href", "/summary");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(document.title).toBe("Page not found | Ali Saleh");
  });

  it("does not link to the status page from the footer", () => {
    stubApi(answerWithContent);
    renderApp("/nowhere");
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).queryByRole("link", { name: /status/i }),
    ).not.toBeInTheDocument();
  });

  it("has landmarks and a skip link that targets main", () => {
    stubApi(answerWithContent);
    renderApp("/nowhere");
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(
      screen.getByRole("navigation", { name: "Main" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
