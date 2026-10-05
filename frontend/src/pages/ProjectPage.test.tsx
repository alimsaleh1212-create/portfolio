import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { projectMedia, projects } from "../test/fixtures";
import { answerWithContent, json, renderApp, stubApi } from "../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

const [first, , third, , , last] = projects;

describe("Project page, loaded", () => {
  it("shows everything the API returns for the Project", async () => {
    stubApi(answerWithContent);
    renderApp(`/projects/${third.slug}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: third.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(third.tagline)).toBeInTheDocument();
    expect(screen.getByText(third.description)).toBeInTheDocument();
    const stack = screen.getByRole("list", { name: `${third.name} stack` });
    for (const item of third.stack)
      expect(within(stack).getByText(item)).toBeInTheDocument();
    for (const metric of third.metrics) {
      expect(screen.getByText(metric.value)).toBeInTheDocument();
      expect(screen.getByText(metric.value).closest("li")).toHaveTextContent(
        `${metric.value} ${metric.label}`,
      );
    }
    expect(document.title).toBe(`${third.name} | Ali Saleh`);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("leaves out the Result section when there is no metric", async () => {
    stubApi(answerWithContent);
    renderApp(`/projects/${first.slug}`);
    await screen.findByRole("heading", { level: 1, name: first.name });
    expect(
      screen.queryByRole("heading", { name: "Result" }),
    ).not.toBeInTheDocument();
  });

  it("draws no gallery for a Project with no media", async () => {
    stubApi(answerWithContent);
    renderApp(`/projects/${first.slug}`);
    await screen.findByRole("heading", { level: 1, name: first.name });
    expect(
      screen.queryByRole("heading", { name: "Gallery" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws the gallery when the Project has media", async () => {
    const withMedia = projects.map((p) =>
      p.slug === first.slug ? { ...p, media: projectMedia } : p,
    );
    stubApi((path) =>
      path.endsWith("/projects") ? json(withMedia) : answerWithContent(path),
    );
    renderApp(`/projects/${first.slug}`);
    expect(
      await screen.findByRole("heading", { level: 2, name: "Gallery" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});

describe("Project page, navigation", () => {
  it("links to the previous and next Project and back to the Summary", async () => {
    stubApi(answerWithContent);
    renderApp(`/projects/${third.slug}`);
    await screen.findByRole("heading", { level: 1, name: third.name });

    const others = screen.getByRole("navigation", { name: "Other Projects" });
    expect(
      within(others).getByRole("link", { name: /Previous/ }),
    ).toHaveAttribute("href", `/projects/${projects[1].slug}`);
    expect(within(others).getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      `/projects/${projects[3].slug}`,
    );
    expect(
      screen.getByRole("link", { name: /Back to the Summary/ }),
    ).toHaveAttribute("href", "/summary");
    expect(screen.getByText("Project 3 of 6")).toBeInTheDocument();
  });

  it("has no previous link on the first Project and no next link on the last", async () => {
    stubApi(answerWithContent);
    const view = renderApp(`/projects/${first.slug}`);
    await screen.findByRole("heading", { level: 1, name: first.name });
    expect(
      screen.queryByRole("link", { name: /Previous/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toBeInTheDocument();
    view.unmount();

    renderApp(`/projects/${last.slug}`);
    await screen.findByRole("heading", { level: 1, name: last.name });
    expect(
      screen.queryByRole("link", { name: /Next/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Previous/ })).toBeInTheDocument();
  });

  it("moves to the next Project and updates the title", async () => {
    stubApi(answerWithContent);
    renderApp(`/projects/${first.slug}`);
    await screen.findByRole("heading", { level: 1, name: first.name });
    await userEvent.click(screen.getByRole("link", { name: /Next/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: projects[1].name }),
    ).toBeInTheDocument();
    expect(document.title).toBe(`${projects[1].name} | Ali Saleh`);
  });
});

describe("Project page, not found", () => {
  it("shows a not-found state inside the shell for an unknown slug", async () => {
    stubApi(answerWithContent);
    renderApp("/projects/no-such-project");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Project not found",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the Summary" }),
    ).toHaveAttribute("href", "/summary");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(document.title).toBe("Project not found | Ali Saleh");
  });
});

describe("Project page, loading", () => {
  it("announces loading inside the shell and shows no content yet", () => {
    stubApi(() => new Promise<Response>(() => {}));
    renderApp(`/projects/${first.slug}`);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the project");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

describe("Project page, error", () => {
  it("shows an error, not the not-found state, and recovers on retry", async () => {
    let up = false;
    stubApi((path) =>
      up ? answerWithContent(path) : json({ detail: "down" }, 502),
    );
    renderApp(`/projects/${first.slug}`);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The project did not load",
    );
    expect(screen.queryByText("Project not found")).not.toBeInTheDocument();
    expect(document.title).toBe("Project did not load | Ali Saleh");

    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: first.name }),
    ).toBeInTheDocument();
  });

  it("shows the error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderApp(`/projects/${first.slug}`);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled(),
    );
  });
});
