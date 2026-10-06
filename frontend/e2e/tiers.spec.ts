import { expect, test, type Page } from "@playwright/test";

/**
 * The three tiers of the Climb (ticket #17). The tier is forced with `?tier=` so every test
 * sees the one it is about; the machine running them has no GPU, so left alone it would
 * always be served the still tier. Nothing here depends on real frame timing: slow frames
 * are fed in by hand and context loss is asked for, not waited for.
 */

const STAGES = [
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
] as const;
const TIERS = ["full", "light", "still"] as const;

/** Two animation frames: whatever was scheduled before has been drawn. */
async function nextFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}

/** Open the Climb and wait until the tier's picture is on: the scene drawn, or the backdrop. */
async function openClimb(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.locator("#trailhead")).toBeVisible();
}

async function sceneOn(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-scene", "on");
}

/** The text of each Stage and the Summit section, in order, as the page shows it. */
async function climbText(page: Page) {
  return page.evaluate((keys) => {
    const clean = (value: string | null) =>
      (value ?? "").replace(/\s+/g, " ").trim();
    return [...keys, "summit"].map((id) =>
      clean(document.getElementById(id)?.textContent ?? null),
    );
  }, STAGES);
}

test.describe("forcing a tier", () => {
  const texts: Record<string, string[]> = {};
  for (const tier of TIERS) {
    test(`${tier}: renders all five Stages, and says which tier it is`, async ({
      page,
    }) => {
      await openClimb(page, `?tier=${tier}`);
      await expect(page.locator("html")).toHaveAttribute("data-tier", tier);
      if (tier === "still") {
        await expect(page.getByTestId("still-backdrop")).toBeAttached();
        await expect(page.locator("canvas")).toHaveCount(0);
      } else {
        await sceneOn(page);
        await expect(page.locator("canvas")).toHaveCount(1);
        await expect(page.getByTestId("still-backdrop")).toHaveCount(0);
      }
      for (const key of STAGES) {
        await expect(page.locator(`#${key}-heading`)).toBeVisible();
      }
      expect((await climbText(page)).every((text) => text.length > 40)).toBe(
        true,
      );
      texts[tier] = await climbText(page);
    });
  }

  test("the text is the same in every tier", () => {
    expect(texts.light).toEqual(texts.full);
    expect(texts.still).toEqual(texts.full);
  });
});

test.describe("the still tier", () => {
  test("is what reduced motion gets, and nothing animates", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await openClimb(page);
    await expect(page.locator("html")).toHaveAttribute("data-tier", "still");
    await expect(page.locator("canvas")).toHaveCount(0);
    // Down the whole Climb: nothing may be running at any point.
    const positions = await page.evaluate(
      (keys) => {
        const top = (id: string) =>
          document.getElementById(id)!.getBoundingClientRect().top + scrollY;
        return [0, ...keys.map(top), document.documentElement.scrollHeight];
      },
      STAGES as unknown as string[],
    );
    for (const y of positions) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      // The scroll has landed and a frame has been drawn at the new place.
      await page.waitForFunction(
        (to) =>
          // The bottom of the page cannot be scrolled to its own height, only to its last screen.
          Math.abs(
            window.scrollY -
              Math.min(
                to,
                document.documentElement.scrollHeight - window.innerHeight,
              ),
          ) < 2,
        y,
      );
      await nextFrames(page);
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === "running" &&
              // The site's reduced-motion rule makes transitions 0.01 ms long (instant, but still
              // listed for a frame); only something that can be seen moving counts.
              Number(a.effect?.getComputedTiming().duration ?? 0) > 1,
          )
          .map((a) => {
            const target = (a as CSSAnimation).effect
              ? ((a.effect as KeyframeEffect).target as HTMLElement | null)
              : null;
            const name =
              "transitionProperty" in a
                ? `transition ${(a as CSSTransition).transitionProperty}`
                : `animation ${(a as CSSAnimation).animationName}`;
            return `${name} on <${target?.tagName.toLowerCase()} class="${String(target?.className).slice(0, 80)}">`;
          }),
      );
      expect(running).toEqual([]);
    }
    // And the pictures change without a fade.
    const opacities = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-still]")].map(
        (layer) => layer.style.opacity,
      ),
    );
    expect(opacities.every((value) => value === "0" || value === "1")).toBe(
      true,
    );
    await context.close();
  });

  test("is what a browser without WebGL gets", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind.startsWith("webgl") || kind === "experimental-webgl")
          return null;
        return (original as (...a: unknown[]) => unknown).call(
          this,
          kind,
          ...rest,
        );
      } as typeof original;
    });
    await openClimb(page);
    await expect(page.locator("html")).toHaveAttribute("data-tier", "still");
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByTestId("still-backdrop")).toBeAttached();
  });

  test("is what software rendering gets, without being asked", async ({
    page,
  }) => {
    // This machine's WebGL is software (SwiftShader), so the rule alone picks still.
    await openClimb(page);
    await expect(page.locator("html")).toHaveAttribute("data-tier", "still");
  });

  test("requests neither the 3D code nor the Hiker's model, only pictures", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await openClimb(page, "?tier=still");
    // Scroll to the Summit so every picture is wanted.
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect
      .poll(() => requested.filter((url) => /\/media\/still-/.test(url)).length)
      .toBeGreaterThan(1);
    // Every picture the backdrop asked for has arrived, and the browser has had an idle moment
    // (the moment the scene would have been fetched in) since: what was requested is final.
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-testid=still-backdrop] img")].every(
        (img) => (img as HTMLImageElement).complete,
      ),
    );
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestIdleCallback(() => done(), { timeout: 3000 }),
        ),
    );
    await nextFrames(page);
    expect(
      requested.filter((url) => /SceneCanvas|GLTFLoader/.test(url)),
    ).toEqual([]);
    expect(
      requested.filter((url) => /\/media\/hiker-|\.glb/.test(url)),
    ).toEqual([]);
    expect(
      requested.filter((url) => !url.startsWith(new URL(page.url()).origin)),
    ).toEqual([]);
  });

  test("the control: the full tier does request the 3D code and the model", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await openClimb(page, "?tier=full");
    await sceneOn(page);
    await expect
      .poll(() => requested.some((url) => /\/media\/hiker-.*\.glb/.test(url)))
      .toBe(true);
    expect(requested.some((url) => /SceneCanvas/.test(url))).toBe(true);
    expect(requested.some((url) => /\/media\/still-/.test(url))).toBe(false);
  });

  test("shows its pictures with their dimensions, and picks by width", async ({
    browser,
  }) => {
    const chosen: Record<string, string> = {};
    for (const width of [360, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 360 ? 740 : 800 },
      });
      const page = await context.newPage();
      await openClimb(page, "?tier=still");
      const img = page.locator('[data-still="opening"] img');
      await expect(img).toBeAttached();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.currentSrc))
        .not.toBe("");
      chosen[width] = await img.evaluate(
        (el: HTMLImageElement) => el.currentSrc,
      );
      expect(await img.getAttribute("width")).not.toBeNull();
      expect(await img.getAttribute("height")).not.toBeNull();
      await context.close();
    }
    expect(chosen[360]).toMatch(/still-opening-narrow-w\d+-.*\.avif$/);
    expect(chosen[1280]).toMatch(/still-opening-wide-w\d+-.*\.avif$/);
  });
});

test.describe("while running", () => {
  /** Where the camera is, from the debug readout. */
  async function camera(page: Page) {
    const text = await page.locator("pre").first().textContent();
    const match = /camera (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(text ?? "");
    return match ? [match[1], match[2], match[3]].map(Number) : null;
  }
  async function triangles(page: Page) {
    const text = await page.locator("pre").first().textContent();
    return Number(/triangles (\d+)/.exec(text ?? "")?.[1] ?? 0);
  }

  test("slow frames drop full to light, with no reload and the camera where it was, and it does not flip back", async ({
    page,
  }) => {
    // Pinned in the middle of the journey, so the camera does not move of its own.
    await openClimb(page, "?tier=full&debug&at=3.5");
    await sceneOn(page);
    await expect.poll(() => triangles(page)).toBeGreaterThan(40_000);
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__sameDocument = true;
      w.__tiers = [document.documentElement.dataset.tier];
      new MutationObserver(() =>
        (w.__tiers as string[]).push(document.documentElement.dataset.tier!),
      ).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-tier"],
      });
    });
    const before = (await camera(page))!;
    const fullTriangles = await triangles(page);
    expect(before).not.toBeNull();

    // Frames that stay slow while scrolling, fed in by hand.
    await page.evaluate(() =>
      (
        window as unknown as { simulateFrames: (ms: number, n: number) => void }
      ).simulateFrames(90, 200),
    );
    await expect(page.locator("html")).toHaveAttribute("data-tier", "light");
    // The cheaper ground is swapped in: far fewer triangles, same canvas.
    await expect.poll(() => triangles(page)).toBeLessThan(fullTriangles * 0.7);
    const after = (await camera(page))!;
    for (const [i, value] of before.entries()) {
      expect(Math.abs(after[i] - value)).toBeLessThan(0.15);
    }
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__sameDocument,
      ),
    ).toBe(true);
    expect(page.url()).toContain("tier=full");
    await expect(page.locator("canvas")).toHaveCount(1);

    // More slow frames, then fast ones: never back up, and never anything but light.
    await page.evaluate(() => {
      const sim = (
        window as unknown as { simulateFrames: (ms: number, n: number) => void }
      ).simulateFrames;
      sim(90, 200);
      sim(8, 500);
    });
    const tiers = () =>
      page.evaluate(
        () => (window as unknown as Record<string, unknown>).__tiers,
      );
    await expect.poll(tiers).toEqual(["full", "light"]);
    // The fast frames that followed have been drawn too, and nothing went back up.
    await nextFrames(page);
    expect(await tiers()).toEqual(["full", "light"]);
  });

  test("losing the graphics context ends in the still tier", async ({
    page,
  }) => {
    await openClimb(page, "?tier=full");
    await sceneOn(page);
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas")!;
      const gl = canvas.getContext("webgl2")!;
      gl.getExtension("WEBGL_lose_context")!.loseContext();
    });
    await expect(page.locator("html")).toHaveAttribute("data-tier", "still");
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByTestId("still-backdrop")).toBeAttached();
    for (const key of STAGES) {
      await expect(page.locator(`#${key}-heading`)).toBeVisible();
    }
  });
});

test.describe("the Visit", () => {
  for (const tier of TIERS) {
    test(`carries the ${tier} tier`, async ({ page }) => {
      const started = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/visits") &&
          response.request().method() === "POST",
      );
      await page.goto(`/?tier=${tier}`);
      const response = await started;
      expect(response.status()).toBe(201);
      expect(response.request().postDataJSON()).toMatchObject({ tier });
      expect(await response.json()).toHaveProperty("id");
    });
  }

  test("still starts when the tier decision fails, with no tier, and the page is served light", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "deviceMemory", {
        get() {
          throw new Error("blocked");
        },
        configurable: true,
      });
    });
    const started = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/visits") &&
        response.request().method() === "POST",
    );
    await page.goto("/");
    const response = await started;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).not.toHaveProperty("tier");
    await expect(page.locator("html")).toHaveAttribute("data-tier", "light");
  });
});
