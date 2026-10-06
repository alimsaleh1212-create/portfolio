/**
 * The pre-render job: `node dist-prerender/run.js`.
 *
 * Reads the seeded content from the API (the same endpoints the pages use), draws every page
 * with the real React app, and writes the HTML, `sitemap.xml` and `robots.txt` to the folder
 * Caddy serves them from. Run it again after a seed to publish new text: no image is rebuilt.
 * It only ever reads from the API; it never starts a Visit.
 *
 * Settings, from the environment:
 *   API_URL    where the API answers (default http://localhost:8080, the stack through Caddy)
 *   SITE_URL   the site's public address, for canonical addresses, the sitemap and image links
 *   TEMPLATE   the built index.html (default dist/index.html)
 *   OUT_DIR    where to write (default prerendered)
 */
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { getJson, setApiOrigin } from "../api/client";
import type { MediaItem, Profile, Project, Stage } from "../api/types";
import { allPages } from "./pages";
import { fillTemplate, renderPage, type Content } from "./render";
import { robotsTxt, sitemapXml } from "./sitemap";

const DEFAULT_SITE_URL = "http://localhost:8080";

async function main(): Promise<void> {
  const apiUrl = process.env.API_URL || "http://localhost:8080";
  const siteUrl = (process.env.SITE_URL || DEFAULT_SITE_URL).replace(
    /\/+$/,
    "",
  );
  const templatePath = process.env.TEMPLATE || "dist/index.html";
  const outDir = process.env.OUT_DIR || "prerendered";

  setApiOrigin(apiUrl);
  // Any failure stops the job: a site drawn from half the content is worse than the old one.
  const [profile, stages, projects, media] = await Promise.all([
    getJson<Profile>("/profile"),
    getJson<Stage[]>("/stages"),
    getJson<Project[]>("/projects"),
    getJson<MediaItem[]>("/media"),
  ]);
  const content: Content = { profile, stages, projects, media };

  const template = await readFile(templatePath, "utf8");
  const pages = allPages(projects);
  const files = new Map<string, string>();
  for (const page of pages) {
    const rendered = renderPage(page.path, page.queries, content, siteUrl);
    if (rendered.html.includes('aria-busy="true"')) {
      throw new Error(`${page.path} was drawn in its loading state.`);
    }
    files.set(page.file, fillTemplate(template, rendered));
  }
  files.set("sitemap.xml", sitemapXml(pages, siteUrl));
  files.set("robots.txt", robotsTxt(siteUrl));

  await writeAll(outDir, files);
  const listed = pages.filter((page) => page.indexable).length;
  console.log(
    `prerender: wrote ${files.size} files to ${outDir} (${listed} indexable pages) for ${siteUrl}`,
  );
}

/** Write every file (each replaced in one step), then remove files from an earlier run. */
async function writeAll(outDir: string, files: Map<string, string>) {
  for (const [file, text] of files) {
    const target = join(outDir, file);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, text);
    await rename(temporary, target);
  }
  for (const existing of await listFiles(outDir)) {
    if (!files.has(relative(outDir, existing).split("\\").join("/"))) {
      await rm(existing);
    }
  }
}

async function listFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(path)));
    else found.push(path);
  }
  return found;
}

main().catch((error: unknown) => {
  console.error(
    "prerender failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
