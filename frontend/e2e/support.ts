import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/** What the Climb's browser tests share. */

export const STAGES = [
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
] as const;
export const TIERS = ["full", "light", "still"] as const;
export type Tier = (typeof TIERS)[number];

export const SIZES = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 360, height: 740 },
} as const;
export type SizeName = keyof typeof SIZES;

/**
 * The API accepts only so many Visit starts a minute from one client (20), and the suite loads far
 * more pages than that. Only a test tagged `@visit` starts a real Visit; every other one has the
 * request answered as a known bot's is (204, nothing recorded), so it never uses the allowance.
 */
export function answerVisitsAsABot() {
  test.beforeEach(async ({ page }) => {
    if (test.info().tags.includes("@visit")) return;
    await page.route("**/api/v1/visits**", (route) =>
      route.fulfill({ status: 204 }),
    );
  });
}

/** Open the Climb and wait until the tier's picture is on: the scene drawn, or the backdrop. */
export async function openClimb(page: Page, tier: Tier) {
  await page.goto(`/?tier=${tier}`);
  await expect(page.locator("html")).toHaveAttribute("data-tier", tier);
  await expect(page.locator("#trailhead")).toBeAttached();
  await expect(page.locator("html")).toHaveAttribute("data-scene", "on");
}

/** Wait until two animation frames have been drawn: whatever was scheduled has run. */
export async function nextFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}

/** Scroll so an element's top edge is at the top of the screen, and wait for the scroll to land. */
export async function scrollToTopOf(page: Page, id: string) {
  const target = await page.evaluate((key) => {
    const y =
      document.getElementById(key)!.getBoundingClientRect().top + scrollY;
    window.scrollTo(0, y);
    return Math.min(y, document.documentElement.scrollHeight - innerHeight);
  }, id);
  await page.waitForFunction(
    (y) => Math.abs(window.scrollY - y) < 2,
    Math.round(target),
  );
  await nextFrames(page);
}

/** The Stage the address names (`/#ridge` is the Ridge), which follows the Visitor. */
export const currentStage = (page: Page) =>
  page.evaluate(() => window.location.hash.replace("#", ""));

export async function expectStage(page: Page, key: string) {
  await expect.poll(() => currentStage(page)).toBe(key);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

/**
 * Ask the stack's Postgres a question (the tests run on the host, the stack in Compose). Used
 * only to see what the API stored: a Visit's events and a contact message. The rows are looked
 * up by an ID or by text the test itself made up.
 */
export function sql(query: string): string {
  const user = process.env.POSTGRES_USER ?? "portfolio";
  const db = process.env.POSTGRES_DB ?? "portfolio";
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      user,
      "-d",
      db,
      "-tA",
      "-c",
      query,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
}

/** A text no other message has, so the stored row can be found again. */
export const uniqueText = (label: string) =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)} written by a browser test`;

export async function fillAndSend(
  page: Page,
  message: { name: string; email: string; message: string },
) {
  await page.getByLabel("Name", { exact: true }).fill(message.name);
  await page.getByLabel("Email address", { exact: true }).fill(message.email);
  await page.getByLabel("Message", { exact: true }).fill(message.message);
  await page.getByRole("button", { name: "Send message" }).click();
}

/** Record every Visit request and answer the page makes: the Visit's ID and its events. */
export function watchVisit(page: Page) {
  const seen = {
    id: null as string | null,
    events: [] as { body: Record<string, string>; status: number }[],
    startStatus: 0,
  };
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() !== "POST") return;
    const url = new URL(response.url());
    if (url.pathname === "/api/v1/visits") {
      seen.startStatus = response.status();
      if (response.status() === 201)
        seen.id = ((await response.json()) as { id: string }).id;
    } else if (/^\/api\/v1\/visits\/[^/]+\/events$/.test(url.pathname)) {
      seen.events.push({
        body: request.postDataJSON() as Record<string, string>,
        status: response.status(),
      });
    }
  });
  return seen;
}
