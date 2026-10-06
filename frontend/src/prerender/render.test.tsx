import { describe, expect, it, vi } from "vitest";

import { media, profile, projects, stages, stillsItem } from "../test/fixtures";
import { allPages, NOT_FOUND_PATH, PROJECT_NOT_FOUND_PATH } from "./pages";
import { fillTemplate, renderPage, type Content } from "./render";

const content: Content = {
  profile,
  stages,
  projects,
  media: [...media, stillsItem],
};
const SITE = "https://ali.example";
const TEMPLATE =
  '<!doctype html><html><head><title>Ali Saleh</title></head><body><div id="root"></div></body></html>';

const draw = (path: string) => {
  const page = allPages(projects).find((candidate) => candidate.path === path)!;
  return renderPage(page.path, page.queries, content, SITE);
};
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("drawing the pages", () => {
  it("the landing page holds the five Stages' names and text", () => {
    const html = text(draw("/").html);
    for (const stage of stages) {
      expect(html).toContain(stage.name);
      expect(html).toContain(stage.body);
    }
  });

  it("the Summary holds the experience", () => {
    const html = text(draw("/summary").html);
    for (const job of profile.experience) {
      expect(html).toContain(job.role);
      for (const highlight of job.highlights) expect(html).toContain(highlight);
    }
  });

  it("each Project page holds its description", () => {
    for (const project of projects) {
      const html = text(draw(`/projects/${project.slug}`).html);
      expect(html).toContain(project.name);
      expect(html).toContain(project.description);
    }
  });

  it("no page is drawn in its loading state", () => {
    for (const page of allPages(projects)) {
      const { html } = renderPage(page.path, page.queries, content, SITE);
      expect(html).not.toContain('aria-busy="true"');
    }
  });

  it("the 404 pages show the not-found page, one for any address and one for a Project", () => {
    expect(text(draw(NOT_FOUND_PATH).html)).toContain(
      "There is no page at this address.",
    );
    expect(text(draw(PROJECT_NOT_FOUND_PATH).html)).toContain(
      "There is no Project at this address.",
    );
  });

  it("takes each page's head from the page itself", () => {
    expect(draw("/").head.title).toBe("Ali Saleh | AI Development Specialist");
    expect(draw("/summary").head.title).toBe("Summary | Ali Saleh");
    expect(draw(`/projects/${projects[1].slug}`).head.title).toBe(
      `${projects[1].name} | Ali Saleh`,
    );
    expect(draw("/status").head.noindex).toBe(true);
    expect(draw(NOT_FOUND_PATH).head.noindex).toBe(true);
  });

  it("does nothing that belongs to the browser: no request, no Visit, no scene", () => {
    const fetchSpy = vi.fn(() =>
      Promise.reject(new Error("no network in a pre-render")),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      for (const page of allPages(projects)) {
        const { html } = renderPage(page.path, page.queries, content, SITE);
        expect(html).not.toContain("<canvas");
        expect(html).not.toContain("still-backdrop");
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the page's HTML", () => {
  const page = draw("/summary");
  const html = fillTemplate(TEMPLATE, page);

  it("has the page's title and tags in place of the template's, and the app in #root", () => {
    expect(html).toContain("<title>Summary | Ali Saleh</title>");
    expect(html).not.toContain("<title>Ali Saleh</title>");
    expect(html).toContain(
      'rel="canonical" href="https://ali.example/summary"',
    );
    expect(html).toContain(`<div id="root">${page.html}</div>`);
  });

  it("hands the browser the content it was drawn from, so nothing is fetched twice", () => {
    const data =
      /<script type="application\/json" id="prerender-data">(.*?)<\/script>/s.exec(
        html,
      )![1];
    const parsed = JSON.parse(data) as {
      siteUrl: string;
      state: { queries: { queryKey: string[] }[] };
    };
    expect(parsed.siteUrl).toBe(SITE);
    expect(
      parsed.state.queries.map((query) => query.queryKey[0]).sort(),
    ).toEqual(["media", "profile", "projects"]);
  });

  it("cannot be closed early by the content", () => {
    const hostile = renderPage(
      "/summary",
      ["profile", "projects", "media"],
      {
        ...content,
        profile: { ...profile, summary: "</script><script>alert(1)</script>" },
      },
      SITE,
    );
    const out = fillTemplate(TEMPLATE, hostile);
    expect(out).not.toContain("</script><script>alert");
  });

  it("refuses a template it cannot fill", () => {
    expect(() => fillTemplate("<html></html>", page)).toThrow(/no #root/);
  });
});

describe("what a Visitor never receives", () => {
  it("has no phone number in any page", () => {
    const phone = /(?<![\w.-])\+?\(?\d[\d\s().-]{5,}\d(?![\w-])/;
    for (const spec of allPages(projects)) {
      // A file's size in bytes in the embedded media list is a long number, not a phone number.
      const html = fillTemplate(
        TEMPLATE,
        renderPage(spec.path, spec.queries, content, SITE),
      ).replace(/"size_bytes":\d+/g, "");
      for (const match of html.matchAll(new RegExp(phone, "g"))) {
        expect({ page: spec.path, found: match[0] }).toEqual({
          page: spec.path,
          found: "",
        });
      }
    }
  });
});
