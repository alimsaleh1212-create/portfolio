import { describe, expect, it } from "vitest";

import { DESCRIPTION_MAX } from "./description";
import {
  headTags,
  landingHead,
  PROJECT_PREVIEWS,
  projectHead,
  projectPreview,
  summaryHead,
  titled,
  unlistedHead,
  type HeadModel,
} from "./model";
import { renderHead } from "./render";
import { media, profile, projects, stillsItem } from "../test/fixtures";

const SITE = "https://ali.example";
const context = { siteUrl: SITE, media: [...media, stillsItem] };

const tag = (model: HeadModel, key: string, value: string) =>
  headTags(model).find(
    (item) =>
      item.attrs.name === value ||
      item.attrs.property === value ||
      (key === "rel" && item.attrs.rel === value),
  );
const content = (model: HeadModel, name: string) =>
  tag(model, "name", name)?.attrs.content;

describe("the landing page's head", () => {
  const head = landingHead(profile, context);

  it("has its own title, from the name and the role in the headline", () => {
    expect(head.title).toBe("Ali Saleh | AI Development Specialist");
  });

  it("describes Ali from the headline and the summary, within the limit", () => {
    expect(head.description).toContain(
      "AI Development Specialist, AI Automation, Agents & Integrations.",
    );
    expect(head.description).toContain("I am an AI engineer");
    expect(head.description!.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("names its canonical address, which is the site's own", () => {
    expect(head.canonical).toBe(SITE);
  });

  it("previews with the opening view at the size link previews expect", () => {
    expect(head.image).toMatchObject({
      url: `${SITE}/media/still-opening-preview-w1200-abc.jpg`,
      width: 1200,
      height: 630,
      type: "image/jpeg",
    });
  });

  it("has Open Graph and Twitter card tags", () => {
    expect(content(head, "og:title")).toBe(head.title);
    expect(content(head, "og:description")).toBe(head.description);
    expect(content(head, "og:url")).toBe(SITE);
    expect(content(head, "og:image")).toBe(head.image!.url);
    expect(content(head, "og:image:width")).toBe("1200");
    expect(content(head, "og:image:height")).toBe("630");
    expect(content(head, "twitter:card")).toBe("summary_large_image");
    expect(content(head, "twitter:image")).toBe(head.image!.url);
    expect(content(head, "twitter:title")).toBe(head.title);
  });

  it("carries structured data about Ali as a Person", () => {
    const script = headTags(head).find((item) => item.tag === "script");
    expect(script?.attrs.type).toBe("application/ld+json");
    expect(JSON.parse(script!.text!)).toEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Ali Saleh",
      jobTitle: profile.headline,
      url: SITE,
      email: `mailto:${profile.links.email}`,
      sameAs: [profile.links.linkedin, profile.links.github],
    });
  });
});

describe("the Summary's head", () => {
  const head = summaryHead(profile, context);

  it("has its own title, description, canonical address and image", () => {
    expect(head.title).toBe("Summary | Ali Saleh");
    expect(head.description).toBe(profile.summary);
    expect(head.canonical).toBe(`${SITE}/summary`);
    expect(head.image?.url).toContain("still-summit-preview");
  });

  it("has no structured data", () => {
    expect(headTags(head).some((item) => item.tag === "script")).toBe(false);
  });
});

describe("a Project's head", () => {
  const head = projectHead(projects[3], 3, context);

  it("is titled and described by the Project: tagline, then description", () => {
    expect(head.title).toBe("Argus | Ali Saleh");
    expect(head.description).toBe(
      "Security automation (capstone). I built a multi-agent pipeline.",
    );
    expect(head.canonical).toBe(`${SITE}/projects/four`);
    expect(content(head, "og:type")).toBe("article");
  });

  it("takes the Stages' pictures in turn, and wraps when there are more Projects than Stages", () => {
    expect(PROJECT_PREVIEWS).toHaveLength(5);
    expect(projectPreview(0)).toBe("trailhead");
    expect(projectPreview(3)).toBe("ridge");
    expect(projectPreview(5)).toBe("trailhead");
    expect(projectHead(projects[0], 0, context).image?.url).toContain(
      "still-trailhead-preview",
    );
    expect(projectHead(projects[3], 3, context).image?.url).toContain(
      "still-ridge-preview",
    );
  });

  it("has every Project on its own address", () => {
    const addresses = projects.map(
      (project, index) => projectHead(project, index, context).canonical,
    );
    expect(new Set(addresses).size).toBe(projects.length);
  });
});

describe("without the stills", () => {
  it("has no image tags and a plain summary card", () => {
    const head = summaryHead(profile, { siteUrl: SITE, media });
    expect(head.image).toBeUndefined();
    expect(content(head, "twitter:card")).toBe("summary");
    expect(content(head, "og:image")).toBeUndefined();
  });
});

describe("pages that are not for search engines", () => {
  it("are marked noindex and have no canonical address", () => {
    const head = unlistedHead("Status");
    expect(head.title).toBe("Status | Ali Saleh");
    expect(content(head, "robots")).toBe("noindex");
    expect(tag(head, "rel", "canonical")).toBeUndefined();
  });

  it("indexable pages are not marked noindex", () => {
    expect(content(summaryHead(profile, context), "robots")).toBeUndefined();
  });

  it("a loading page has only a title", () => {
    expect(titled("Loading project").title).toBe("Loading project | Ali Saleh");
  });
});

describe("renderHead", () => {
  it("escapes what the content holds and marks every tag it writes", () => {
    const html = renderHead({
      title: 'A "quoted" <title>',
      description: "Tom & Jerry's <b>x</b>",
    });
    expect(html).toContain("<title>A &quot;quoted&quot; &lt;title&gt;</title>");
    expect(html).toContain(
      'content="Tom &amp; Jerry&#39;s &lt;b&gt;x&lt;/b&gt;"',
    );
    expect(html).not.toContain("<b>");
    for (const line of html.split("\n").slice(1))
      expect(line).toContain("data-head");
  });

  it("cannot be broken out of by structured data", () => {
    const html = renderHead({
      title: "x",
      jsonLd: { name: "</script><script>alert(1)</script>" },
    });
    expect(html.match(/<script/g)).toHaveLength(1);
    const body = /<script[^>]*>(.*)<\/script>/.exec(html)![1];
    expect(JSON.parse(body).name).toBe("</script><script>alert(1)</script>");
  });
});
