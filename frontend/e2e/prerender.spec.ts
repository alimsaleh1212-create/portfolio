import {
  expect,
  test,
  type APIRequestContext,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";

/**
 * The pre-rendered pages (ticket #18). The HTML the server sends already holds each page's text;
 * the browser then takes it over (hydration) without a console warning, a redrawn page or a jump.
 * Every expectation about content is read from the API, so a re-seed changes nothing here.
 */

interface Stage {
  name: string;
  body: string;
}
interface Project {
  slug: string;
  name: string;
  description: string;
}
interface Profile {
  summary: string;
  experience: { role: string; highlights: string[] }[];
}

async function content(request: APIRequestContext) {
  const get = async <T>(path: string) =>
    (await (await request.get(`/api/v1${path}`)).json()) as T;
  return {
    stages: await get<Stage[]>("/stages"),
    projects: await get<Project[]>("/projects"),
    profile: await get<Profile>("/profile"),
  };
}

/** What a reader sees: tags gone, entities decoded, whitespace collapsed. */
function readable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the landing page shows the five Stages and their text", async ({
    page,
    request,
  }) => {
    const { stages } = await content(request);
    expect(stages).toHaveLength(5);
    await page.goto("/");
    const text = readable(await page.content());
    for (const stage of stages) {
      await expect(
        page.getByRole("heading", { level: 2, name: stage.name, exact: true }),
      ).toBeVisible();
      expect(text).toContain(stage.body);
    }
  });

  test("the Summary shows the experience", async ({ page, request }) => {
    const { profile } = await content(request);
    await page.goto("/summary");
    const text = readable(await page.content());
    expect(profile.experience.length).toBeGreaterThan(0);
    for (const job of profile.experience) {
      expect(text).toContain(job.role);
      for (const highlight of job.highlights) expect(text).toContain(highlight);
    }
    expect(text).toContain(profile.summary);
  });

  test("each Project page shows its description", async ({ page, request }) => {
    const { projects } = await content(request);
    expect(projects.length).toBeGreaterThanOrEqual(6);
    for (const project of projects) {
      await page.goto(`/projects/${project.slug}`);
      await expect(
        page.getByRole("heading", { level: 1, name: project.name }),
      ).toBeVisible();
      expect(readable(await page.content())).toContain(project.description);
    }
  });
});

/** Console messages that are errors or warnings, and uncaught page errors. */
function watchConsole(page: Page) {
  const problems: string[] = [];
  const keep = (message: ConsoleMessage) => {
    // The browser logs a 404 for the page's own address; that is the answer, not a fault.
    if (message.location().url === page.url()) return;
    if (["error", "warning"].includes(message.type())) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  };
  page.on("console", keep);
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/**
 * Remember the server's elements and the layout shifts, before any script of the page runs.
 * Hydration keeps the server's elements; a page that was redrawn instead replaces them.
 */
async function watchHydration(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as unknown as {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput)
          w.__shift = (w.__shift as number) + shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    const mark = () => {
      const root = document.getElementById("root");
      if (!root?.firstElementChild) return false;
      w.__serverRoot = root.firstElementChild;
      w.__serverCount = root.querySelectorAll("*").length;
      return true;
    };
    if (!mark()) {
      const observer = new MutationObserver(() => {
        if (mark()) observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    }
  });
}

async function hydrationReport(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const root = document.getElementById("root")!;
    return {
      kept: root.firstElementChild === w.__serverRoot,
      shift: w.__shift as number,
    };
  });
}

const KINDS = [
  { kind: "the landing page", path: () => "/" },
  { kind: "the Summary", path: () => "/summary" },
  { kind: "a Project", path: (slug: string) => `/projects/${slug}` },
  { kind: "the status page", path: () => "/status" },
  { kind: "the not-found page", path: () => "/nowhere" },
  { kind: "an unknown Project", path: () => "/projects/no-such-project" },
];

test.describe("with JavaScript", () => {
  for (const { kind, path } of KINDS) {
    test(`${kind} hydrates with no console error or warning, keeps the server's page and does not shift`, async ({
      page,
      request,
    }) => {
      const { projects } = await content(request);
      const problems = watchConsole(page);
      const apiCalls: string[] = [];
      page.on("request", (call) => {
        if (/\/api\/v1\/(profile|stages|projects|media)$/.test(call.url()))
          apiCalls.push(call.url());
      });
      await watchHydration(page);
      await page.goto(path(projects[0].slug));
      // The browser has taken over once it has decided the tier.
      await expect(page.locator("html")).toHaveAttribute("data-tier", /.+/);
      await page.waitForLoadState("networkidle");

      expect(problems).toEqual([]);
      const report = await hydrationReport(page);
      expect(report.kept).toBe(true);
      expect(report.shift).toBeLessThan(0.1);
      console.log(`${kind}: layout shift ${report.shift.toFixed(4)}`);
      // The pre-rendered page brought its content: nothing is fetched again on first load.
      expect(apiCalls).toEqual([]);
    });
  }

  test("the landing page still gets its backdrop after hydrating, in each tier", async ({
    page,
  }) => {
    for (const tier of ["still", "light", "full"] as const) {
      const problems = watchConsole(page);
      await page.goto(`/?tier=${tier}`);
      await expect(page.locator("html")).toHaveAttribute("data-tier", tier);
      if (tier === "still") {
        await expect(page.getByTestId("still-backdrop")).toBeAttached();
      } else {
        await expect(page.locator("html")).toHaveAttribute("data-scene", "on");
        await expect(page.locator("canvas")).toHaveCount(1);
      }
      // React Three Fiber still uses THREE.Clock, which three.js now warns about once. That is the
      // scene's own dependency, not the page's hydration.
      expect(problems.filter((line) => !/THREE\.Clock/.test(line))).toEqual([]);
    }
  });

  test("the first paint already has the text, before the page's script runs", async ({
    page,
    request,
  }) => {
    const { stages } = await content(request);
    // Hold the script back: what is on screen is only what the server sent.
    await page.route("**/assets/index-*.js", (route) => route.abort());
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: stages[0].name,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(stages[0].body)).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test("moving between pages still works and keeps the title and tags current", async ({
    page,
    request,
  }) => {
    const { projects } = await content(request);
    await page.goto("/");
    await expect(page).toHaveTitle(/^Ali Saleh \| /);
    const description = (p: Page) =>
      p.locator('meta[name="description"]').getAttribute("content");
    const landing = await description(page);

    await page.getByRole("link", { name: "Read the Summary" }).click();
    await expect(page).toHaveURL(/\/summary$/);
    await expect(page).toHaveTitle("Summary | Ali Saleh");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/summary$/,
    );
    expect(await description(page)).not.toBe(landing);
    await expect(
      page.locator('script[type="application/ld+json"]'),
    ).toHaveCount(0);

    await page.getByRole("link", { name: projects[2].name }).first().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projects[2].slug}$`));
    await expect(page).toHaveTitle(`${projects[2].name} | Ali Saleh`);
    await expect(
      page.getByRole("heading", { level: 1, name: projects[2].name }),
    ).toBeVisible();
    // One set of tags at a time: moving on replaced the last page's.
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);

    await page
      .getByRole("link", { name: "Ali Saleh", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.locator('script[type="application/ld+json"]'),
    ).toHaveCount(1);
  });
});

test.describe("addresses that are not pages", () => {
  test("an unknown address answers 404 with the not-found page", async ({
    request,
  }) => {
    for (const path of [
      "/nowhere",
      "/a/b/c",
      "/projects/a/b",
      "/summary.html",
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(await response.text(), path).toContain(
        "There is no page at this address.",
      );
    }
  });

  test("an unknown Project slug answers 404 with the not-found page", async ({
    request,
  }) => {
    const response = await request.get("/projects/no-such-project");
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain("Project not found");
  });

  test("the browser shows the not-found page for both", async ({ page }) => {
    for (const [path, heading] of [
      ["/nowhere/at/all", "Page not found"],
      ["/projects/no-such-project", "Project not found"],
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page).toHaveTitle(`${heading} | Ali Saleh`);
    }
  });

  test("real pages answer 200, and /status is marked not to be indexed", async ({
    request,
  }) => {
    const { projects } = await content(request);
    for (const path of [
      "/",
      "/summary",
      "/status",
      ...projects.map((p) => `/projects/${p.slug}`),
    ]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
    expect(await (await request.get("/status")).text()).toContain(
      '<meta name="robots" content="noindex"',
    );
    expect((await request.get("/summary/", { maxRedirects: 0 })).status()).toBe(
      308,
    );
  });

  test("a missing asset is a plain 404, not the app", async ({ request }) => {
    const response = await request.get("/assets/no-such-file.js");
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe("");
  });
});

test.describe("sitemap and robots", () => {
  test("the sitemap lists every page and the robots file points at it", async ({
    request,
  }) => {
    const { projects } = await content(request);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]).pathname,
    );
    expect(locations).toEqual([
      "/",
      "/summary",
      ...projects.map((project) => `/projects/${project.slug}`),
    ]);
    expect(locations).toHaveLength(2 + projects.length);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /status");
    expect(robots).toMatch(/Sitemap: \S+\/sitemap\.xml/);
  });

  test("each page's preview image is a real picture of the stated size", async ({
    request,
  }) => {
    const { projects } = await content(request);
    for (const path of [
      "/",
      "/summary",
      ...projects.map((p) => `/projects/${p.slug}`),
    ]) {
      const html = await (await request.get(path)).text();
      const url = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
      expect(url, path).toBeTruthy();
      const width = Number(/og:image:width" content="(\d+)"/.exec(html)?.[1]);
      const height = Number(/og:image:height" content="(\d+)"/.exec(html)?.[1]);
      expect([width, height]).toEqual([1200, 630]);
      // The address is the site's public one; fetch the same file from this origin.
      const image = await request.get(new URL(url!).pathname);
      expect(image.status(), path).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/jpeg");
    }
  });
});
