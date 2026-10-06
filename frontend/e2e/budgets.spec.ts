import { expect, test, type Page } from "@playwright/test";

import { answerVisitsAsABot, nextFrames, SIZES } from "./support";

/**
 * Budgets on a throttled phone profile: the landing page's text is visible within 2.5 seconds
 * and layout shift stays under 0.1. The profile is Lighthouse's "slow 4G" (about 1.6 Mbit/s down,
 * 150 ms round trip) with the processor four times slower, on a 360 by 740 screen, and a cold
 * cache. Time to visible text is the first paint of the text (largest contentful paint, which
 * must itself be text) as the browser measured it, not a clock of the test's own.
 */

answerVisitsAsABot();

// The budget, in milliseconds. BUDGET_MS lowers it to prove the check can fail.
const TEXT_BUDGET = Number(process.env.BUDGET_MS ?? 2500);
const SHIFT_BUDGET = 0.1;

test.use({ viewport: SIZES.phone, hasTouch: true, isMobile: true });

async function throttle(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

/** Start watching paints and layout shifts before the page's own code runs. */
async function observe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __lcp: { time: number; tag: string; isText: boolean } | null;
      __fcp: number | null;
      __cls: number;
    };
    w.__lcp = null;
    w.__fcp = null;
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { element?: Element | null };
        w.__lcp = {
          time: e.startTime,
          tag: e.element?.tagName ?? "",
          isText: !(e.element instanceof HTMLImageElement),
        };
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.name === "first-contentful-paint") w.__fcp = entry.startTime;
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) w.__cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

const readings = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __lcp: { time: number; tag: string; isText: boolean } | null;
      __fcp: number | null;
      __cls: number;
    };
    return { lcp: w.__lcp, fcp: w.__fcp, cls: w.__cls };
  });

for (const tier of ["still", "full"] as const) {
  test(`the landing page on a throttled phone (${tier} tier): text within 2.5 s, layout shift under 0.1`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await throttle(page);
    await observe(page);
    await page.goto(`/?tier=${tier}`);

    // The text is on screen: the headline is painted and the first paint has happened.
    await expect(page.locator("#climb-title")).toBeInViewport();
    await expect.poll(async () => (await readings(page)).fcp).not.toBeNull();
    const first = await readings(page);
    test
      .info()
      .annotations.push({
        type: "measured",
        description: `fcp ${Math.round(first.fcp!)} ms, lcp ${Math.round(first.lcp!.time)} ms (${first.lcp!.tag})`,
      });
    expect(first.fcp!).toBeLessThan(TEXT_BUDGET);
    expect(first.lcp).not.toBeNull();
    // The largest thing painted by then is text, not a picture that arrived late.
    expect(first.lcp!.isText).toBe(true);
    expect(first.lcp!.time).toBeLessThan(TEXT_BUDGET);

    // Let the rest of the page arrive (the tier's picture or the scene), then count the shifts.
    await expect(page.locator("html")).toHaveAttribute("data-scene", "on");
    await nextFrames(page);
    await page.evaluate(() => document.fonts.ready);
    await nextFrames(page);
    const after = await readings(page);
    test
      .info()
      .annotations.push({
        type: "layout shift",
        description: String(after.cls),
      });
    expect(after.cls).toBeLessThan(SHIFT_BUDGET);
    // The scene arriving must not have moved the text either.
    expect(after.lcp!.isText).toBe(true);
  });
}

test("the Summary on a throttled phone: text within 2.5 s, layout shift under 0.1", async ({
  page,
}) => {
  await throttle(page);
  await observe(page);
  await page.goto("/summary");
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  await expect.poll(async () => (await readings(page)).fcp).not.toBeNull();
  await page.evaluate(() => document.fonts.ready);
  await nextFrames(page);
  const r = await readings(page);
  expect(r.fcp!).toBeLessThan(TEXT_BUDGET);
  expect(r.cls).toBeLessThan(SHIFT_BUDGET);
});
