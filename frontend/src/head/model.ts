/**
 * What goes in a page's `<head>`: the title, the description, the canonical address, the
 * Open Graph and Twitter card tags, a preview image and, on the landing page, structured data.
 *
 * Everything is built from the content the API returns, never typed in here. These are pure
 * functions: the pre-render turns the model into HTML (`render.ts`) and, in the browser,
 * `useHead` applies the same model when the Visitor moves to another page.
 */
import type { MediaItem, Profile, Project } from "../api/types";
import { describe, DESCRIPTION_MAX } from "./description";
import { personData } from "./structuredData";

export const SITE_NAME = "Ali Saleh";

export interface PreviewImage {
  /** Absolute address. */
  url: string;
  width: number;
  height: number;
  type: string;
  alt: string;
}

export interface HeadModel {
  title: string;
  description?: string;
  /** Absolute address. Absent on pages that are not for search engines. */
  canonical?: string;
  /** Keep the page out of search results. */
  noindex?: boolean;
  image?: PreviewImage;
  /** `article` for a Project, `website` for the rest. */
  type?: "website" | "article";
  /** JSON-LD, written as one script. */
  jsonLd?: object;
}

/** One element of the head. `text` is the content of a `<script>`. */
export interface HeadTag {
  tag: "meta" | "link" | "script";
  attrs: Record<string, string>;
  text?: string;
}

export interface PageContext {
  /** The site's public address, no trailing slash. */
  siteUrl: string;
  media: MediaItem[];
}

/** The title when nothing more is known: "Loading project | Ali Saleh". */
export function titled(title: string): HeadModel {
  return { title: `${title} | ${SITE_NAME}` };
}

/** The part of the headline before its first separator: "AI Development Specialist". */
function role(headline: string): string {
  return headline.split("|")[0].trim();
}

/** Absolute address of a path on the site. */
export function absolute(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * The preview picture for a position of the Climb: the stills role's `<position>-preview`
 * variant, a 1200x630 JPEG the media pipeline crops from the wide still. Absent when the stills
 * were not seeded, and the page then simply has no preview image.
 */
export function previewFor(
  media: MediaItem[],
  position: string,
  siteUrl: string,
): PreviewImage | undefined {
  const variant = media
    .find((item) => item.role === "stills")
    ?.variants.find(
      (candidate) =>
        candidate.name === `${position}-preview` &&
        candidate.width !== null &&
        candidate.height !== null,
    );
  if (!variant || variant.width === null || variant.height === null) return;
  return {
    url: absolute(siteUrl, variant.url),
    width: variant.width,
    height: variant.height,
    type: variant.content_type,
    alt: `A low-poly mountain from ${SITE_NAME}'s Climb.`,
  };
}

/** The landing page's picture is the opening view; the Summary's is the Summit. */
export const LANDING_PREVIEW = "opening";
export const SUMMARY_PREVIEW = "summit";
/** The Projects take the Stages' pictures in turn, in the API's order. */
export const PROJECT_PREVIEWS = [
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
] as const;

export function projectPreview(index: number): string {
  return PROJECT_PREVIEWS[Math.max(0, index) % PROJECT_PREVIEWS.length];
}

export function landingHead(profile: Profile, context: PageContext): HeadModel {
  return {
    title: `${profile.name} | ${role(profile.headline)}`,
    description: describe(
      [profile.headline.replace(/\s*\|\s*/g, ", "), profile.summary],
      DESCRIPTION_MAX,
      1,
    ),
    canonical: absolute(context.siteUrl, "/"),
    image: previewFor(context.media, LANDING_PREVIEW, context.siteUrl),
    type: "website",
    jsonLd: personData(profile, context.siteUrl),
  };
}

export function summaryHead(profile: Profile, context: PageContext): HeadModel {
  return {
    title: `Summary | ${profile.name}`,
    description: describe([profile.summary]),
    canonical: absolute(context.siteUrl, "/summary"),
    image: previewFor(context.media, SUMMARY_PREVIEW, context.siteUrl),
    type: "website",
  };
}

export function projectHead(
  project: Project,
  index: number,
  context: PageContext,
): HeadModel {
  return {
    title: `${project.name} | ${SITE_NAME}`,
    description: describe(
      [project.tagline, project.description],
      DESCRIPTION_MAX,
      1,
    ),
    canonical: absolute(context.siteUrl, `/projects/${project.slug}`),
    image: previewFor(context.media, projectPreview(index), context.siteUrl),
    type: "article",
  };
}

/** Pages that load as part of the app but are not for search engines. */
export function unlistedHead(title: string): HeadModel {
  return { ...titled(title), noindex: true };
}

/** The elements a model puts in the head, in order. */
export function headTags(model: HeadModel): HeadTag[] {
  const tags: HeadTag[] = [];
  const meta = (key: "name" | "property", name: string, content: string) =>
    tags.push({ tag: "meta", attrs: { [key]: name, content } });

  if (model.description) meta("name", "description", model.description);
  if (model.noindex) meta("name", "robots", "noindex");
  if (model.canonical) {
    tags.push({
      tag: "link",
      attrs: { rel: "canonical", href: model.canonical },
    });
  }

  meta("property", "og:site_name", SITE_NAME);
  meta("property", "og:title", model.title);
  if (model.description) meta("property", "og:description", model.description);
  meta("property", "og:type", model.type ?? "website");
  if (model.canonical) meta("property", "og:url", model.canonical);
  if (model.image) {
    meta("property", "og:image", model.image.url);
    meta("property", "og:image:type", model.image.type);
    meta("property", "og:image:width", String(model.image.width));
    meta("property", "og:image:height", String(model.image.height));
    meta("property", "og:image:alt", model.image.alt);
  }

  meta("name", "twitter:card", model.image ? "summary_large_image" : "summary");
  meta("name", "twitter:title", model.title);
  if (model.description) meta("name", "twitter:description", model.description);
  if (model.image) {
    meta("name", "twitter:image", model.image.url);
    meta("name", "twitter:image:alt", model.image.alt);
  }

  if (model.jsonLd) {
    tags.push({
      tag: "script",
      attrs: { type: "application/ld+json" },
      text: JSON.stringify(model.jsonLd),
    });
  }
  return tags;
}
