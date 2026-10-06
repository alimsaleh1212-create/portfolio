import { absolute } from "../head/model";
import { escapeHtml } from "../head/render";
import type { PageSpec } from "./pages";

/** `sitemap.xml`: every indexable page, at its canonical address. */
export function sitemapXml(pages: PageSpec[], siteUrl: string): string {
  const urls = pages
    .filter((page) => page.indexable)
    .map(
      (page) =>
        `  <url><loc>${escapeHtml(absolute(siteUrl, page.path))}</loc></url>`,
    );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/** `robots.txt`: everything is open except the API and the status page; points at the sitemap. */
export function robotsTxt(siteUrl: string): string {
  return [
    "User-agent: *",
    "Disallow: /api/",
    "Disallow: /status",
    "",
    `Sitemap: ${absolute(siteUrl, "/sitemap.xml")}`,
    "",
  ].join("\n");
}
