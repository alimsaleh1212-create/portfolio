import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { profile, projects } from "../test/fixtures";
import { answerWithContent, json, renderApp, stubApi } from "../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Summary, loaded", () => {
  it("shows everything the API returns", async () => {
    stubApi(answerWithContent);
    renderApp("/summary");

    expect(
      await screen.findByRole("heading", { level: 1, name: profile.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(profile.headline)).toBeInTheDocument();
    expect(screen.getByText(profile.summary)).toBeInTheDocument();

    for (const job of profile.experience) {
      expect(
        screen.getByRole("heading", { level: 3, name: job.role }),
      ).toBeInTheDocument();
      expect(screen.getByText(job.period)).toBeInTheDocument();
      for (const highlight of job.highlights)
        expect(screen.getByText(highlight)).toBeInTheDocument();
    }

    expect(projects).toHaveLength(6);
    for (const project of projects) {
      expect(
        screen.getByRole("heading", { level: 3, name: project.name }),
      ).toBeInTheDocument();
      expect(screen.getByText(project.tagline)).toBeInTheDocument();
      expect(screen.getByText(project.description)).toBeInTheDocument();
      // Each metric is a value and a label, read together by a screen reader.
      for (const metric of project.metrics) {
        expect(screen.getByText(metric.value)).toBeInTheDocument();
        expect(screen.getByText(metric.label)).toBeInTheDocument();
        expect(screen.getByText(metric.value).closest("li")).toHaveTextContent(
          `${metric.value} ${metric.label}`,
        );
      }
      const stack = screen.getByRole("list", { name: `${project.name} stack` });
      for (const item of project.stack)
        expect(within(stack).getByText(item)).toBeInTheDocument();
    }

    for (const group of profile.skills) {
      const list = screen.getByRole("list", { name: group.category });
      for (const item of group.items)
        expect(within(list).getByText(item)).toBeInTheDocument();
    }

    expect(screen.getByText(profile.education[0].title)).toBeInTheDocument();
    expect(
      screen.getByText(profile.certifications[0].title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(profile.certifications[0].issuer),
    ).toBeInTheDocument();
  });

  it("links to email, LinkedIn and GitHub", async () => {
    stubApi(answerWithContent);
    renderApp("/summary");

    const contact = await screen.findByRole("navigation", { name: "Contact" });
    expect(
      within(contact).getByRole("link", { name: profile.links.email }),
    ).toHaveAttribute("href", `mailto:${profile.links.email}`);
    expect(
      within(contact).getByRole("link", {
        name: "linkedin.com/in/ali-example",
      }),
    ).toHaveAttribute("href", profile.links.linkedin);
    expect(
      within(contact).getByRole("link", { name: "github.com/ali-example" }),
    ).toHaveAttribute("href", profile.links.github);
  });

  it("links each Project name to its page", async () => {
    stubApi(answerWithContent);
    renderApp("/summary");
    await screen.findByRole("heading", { level: 1, name: profile.name });
    for (const project of projects) {
      expect(screen.getByRole("link", { name: project.name })).toHaveAttribute(
        "href",
        `/projects/${project.slug}`,
      );
    }
  });

  it("sets the document title", async () => {
    stubApi(answerWithContent);
    renderApp("/summary");
    await screen.findByRole("heading", { level: 1 });
    expect(document.title).toBe("Summary | Ali Saleh");
  });
});

describe("Summary, loading", () => {
  it("announces loading inside the shell and shows no content yet", () => {
    stubApi(() => new Promise<Response>(() => {}));
    renderApp("/summary");

    expect(screen.getByRole("status")).toHaveTextContent("Loading the summary");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

describe("Summary, error", () => {
  it("shows an error inside the shell and recovers on retry", async () => {
    let up = false;
    stubApi((path) =>
      up ? answerWithContent(path) : json({ detail: "down" }, 502),
    );
    renderApp("/summary");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The summary did not load",
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();

    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: profile.name }),
    ).toBeInTheDocument();
  });

  it("shows the error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderApp("/summary");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled(),
    );
  });
});
