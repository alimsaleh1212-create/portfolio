import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cvItem, media, portraitItem, videoItem } from "../test/fixtures";
import { answerWithContent, json, renderApp, stubApi } from "../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWith(available: typeof media) {
  stubApi((path) => answerWithContent(path, available));
}

describe("Summary media", () => {
  it("shows the Portrait with sources in three formats, dimensions and alt text", async () => {
    stubWith(media);
    renderApp("/summary");

    const image = await screen.findByRole("img", {
      name: portraitItem.alt ?? "",
    });
    expect(image).toHaveAttribute("width", "1280");
    expect(image).toHaveAttribute("height", "1344");
    const picture = image.closest("picture");
    const sources = [...(picture?.querySelectorAll("source") ?? [])];
    expect(sources.map((source) => source.getAttribute("type"))).toEqual([
      "image/avif",
      "image/webp",
    ]);
    expect(sources[0].getAttribute("srcset")).toContain(
      "/media/portrait-w320-avif 320w",
    );
    expect(image.getAttribute("srcset")).toContain(
      "/media/portrait-w1280-jpeg 1280w",
    );
  });

  it("shows the Video CV with controls and loads nothing until it is played", async () => {
    stubWith(media);
    renderApp("/summary");

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Video CV",
    });
    const video = heading.closest("figure")?.querySelector("video");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("poster", "/media/poster-w1280-webp");
    expect(video).toHaveAttribute("src", "/media/video-1080");
    expect(video).toHaveAttribute("width", "1920");
    expect(video).toHaveAccessibleName("Video CV");
    expect(screen.getByText(/1 min 25 s/)).toBeInTheDocument();
  });

  it("gives small screens the 720p file and the smaller poster", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: true,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    stubWith(media);
    renderApp("/summary");

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Video CV",
    });
    const video = heading.closest("figure")?.querySelector("video");
    expect(video).toHaveAttribute("src", "/media/video-720");
    expect(video).toHaveAttribute("poster", "/media/poster-w960-webp");
    vi.restoreAllMocks();
  });

  it("offers the CV as a download under its file name", async () => {
    stubWith(media);
    renderApp("/summary");

    const link = await screen.findByRole("link", { name: /Download CV/ });
    expect(link).toHaveAttribute("href", "/media/cv-abc.pdf");
    expect(link).toHaveAttribute("download", "Ali_Saleh_CV.pdf");
    expect(link).toHaveTextContent("89 KB");
  });

  it.each([
    ["Portrait", [videoItem, cvItem]],
    ["Video CV", [portraitItem, cvItem]],
    ["CV download", [portraitItem, videoItem]],
  ])(
    "leaves out the %s when it is absent, with nothing in its place",
    async (name, rest) => {
      stubWith(rest);
      renderApp("/summary");

      await screen.findByRole("heading", { level: 1 });
      expect(!!screen.queryByRole("img")).toBe(name !== "Portrait");
      expect(!!screen.queryByRole("heading", { name: "Video CV" })).toBe(
        name !== "Video CV",
      );
      expect(!!screen.queryByRole("link", { name: /Download CV/ })).toBe(
        name !== "CV download",
      );
    },
  );

  it("shows the whole page without media when there is none", async () => {
    stubWith([]);
    renderApp("/summary");

    expect(
      await screen.findByRole("heading", { level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
    const contact = screen.getByRole("navigation", { name: "Contact" });
    expect(within(contact).getAllByRole("link")).toHaveLength(3);
  });

  it("shows the page without media when the media request fails", async () => {
    stubApi((path) =>
      path.endsWith("/media")
        ? json({ detail: "down" }, 500)
        : answerWithContent(path),
    );
    renderApp("/summary");

    expect(
      await screen.findByRole("heading", { level: 1 }),
    ).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });
});
