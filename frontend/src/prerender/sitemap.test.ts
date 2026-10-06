import { describe, expect, it } from "vitest";

import { projects } from "../test/fixtures";
import {
  allPages,
  indexablePages,
  NOT_FOUND_PATH,
  PROJECT_NOT_FOUND_PATH,
} from "./pages";
import { robotsTxt, sitemapXml } from "./sitemap";

describe("the pages", () => {
  it("are the landing page, the Summary and one per Project, driven by the API's list", () => {
    expect(indexablePages(projects).map((page) => page.path)).toEqual([
      "/",
      "/summary",
      ...projects.map((project) => `/projects/${project.slug}`),
    ]);
    expect(indexablePages(projects.slice(0, 2))).toHaveLength(4);
    expect(
      indexablePages([...projects, { ...projects[0], slug: "seven" }]),
    ).toHaveLength(9);
  });

  it("also include the status page and the two 404 pages, none of them indexable", () => {
    const others = allPages(projects).filter((page) => !page.indexable);
    expect(others.map((page) => page.path)).toEqual([
      "/status",
      NOT_FOUND_PATH,
      PROJECT_NOT_FOUND_PATH,
    ]);
    expect(others.map((page) => page.file)).toEqual([
      "status.html",
      "404.html",
      "404-project.html",
    ]);
  });

  it("each write to a file of their own", () => {
    const files = allPages(projects).map((page) => page.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("sitemap.xml", () => {
  const xml = sitemapXml(allPages(projects), "https://ali.example/");

  it("lists every indexable page at its canonical address", () => {
    const locations = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(locations).toEqual([
      "https://ali.example/",
      "https://ali.example/summary",
      ...projects.map(
        (project) => `https://ali.example/projects/${project.slug}`,
      ),
    ]);
  });

  it("leaves out the status page and the 404 pages", () => {
    expect(xml).not.toContain("/status");
    expect(xml).not.toContain("not-found");
  });

  it("is well-formed sitemap XML", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("escapes what it is given", () => {
    expect(
      sitemapXml(indexablePages([]), "https://a.example/?x=1&y=2"),
    ).toContain("&amp;");
  });
});

describe("robots.txt", () => {
  const text = robotsTxt("https://ali.example");

  it("keeps crawlers out of the API and the status page, and nothing else", () => {
    const rules = text
      .split("\n")
      .filter((line) => line.startsWith("Disallow"));
    expect(rules).toEqual(["Disallow: /api/", "Disallow: /status"]);
  });

  it("points at the sitemap by its absolute address", () => {
    expect(text).toContain("Sitemap: https://ali.example/sitemap.xml");
    expect(text).toContain("User-agent: *");
  });
});
