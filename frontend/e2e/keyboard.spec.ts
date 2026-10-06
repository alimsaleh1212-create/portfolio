import { expect, test, type Page } from "@playwright/test";

import {
  answerVisitsAsABot,
  currentStage,
  nextFrames,
  openClimb,
  SIZES,
  STAGES,
  uniqueText,
  type SizeName,
  type Tier,
} from "./support";

/**
 * The whole Climb with the keyboard alone: from the opening screen to the Stages, a Project, and
 * the contact form sent. No pointer is used anywhere in these tests.
 */

answerVisitsAsABot();

const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return (
      el?.getAttribute("aria-label") ??
      (el as HTMLInputElement | null)?.labels?.[0]?.textContent ??
      el?.textContent?.trim() ??
      ""
    );
  });

/** Tab until the focused element satisfies `done`, or fail after `limit` presses. */
async function tabTo(
  page: Page,
  done: () => Promise<boolean>,
  what: string,
  limit = 120,
) {
  for (let presses = 0; presses < limit; presses++) {
    if (await done()) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Tab never reached ${what} (at ${page.url()}, focus on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))})`,
  );
}

/** The page has stopped scrolling: the same position over two frames. */
async function scrollSettled(page: Page) {
  let last = -1;
  await expect
    .poll(async () => {
      await nextFrames(page);
      const now = await page.evaluate(() => window.scrollY);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

const cases: { tier: Tier; size: SizeName }[] = [
  { tier: "still", size: "desktop" },
  { tier: "still", size: "phone" },
  { tier: "full", size: "desktop" },
];

for (const { tier, size } of cases) {
  test.describe(`${tier} tier, ${size}`, () => {
    test.use({ viewport: SIZES[size] });

    test("travels the whole Climb and sends a message with the keyboard alone", async ({
      page,
    }) => {
      await openClimb(page, tier);

      // The skip link is first, then the page's own controls; "Begin the Climb" starts it.
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe("Skip to content");
      await tabTo(
        page,
        async () => (await focusedName(page)) === "Begin the Climb",
        "Begin the Climb",
      );
      await page.keyboard.press("Enter");
      await expect.poll(() => currentStage(page)).toBe("trailhead");

      // Down the Climb a screen at a time: each Stage is reached, in order, before the contact form.
      const seen: string[] = [];
      for (let presses = 0; presses < 80; presses++) {
        const stage = await currentStage(page);
        if (stage && seen[seen.length - 1] !== stage) seen.push(stage);
        const atBottom = await page.evaluate(
          () =>
            window.scrollY + window.innerHeight >=
            document.documentElement.scrollHeight - 2,
        );
        if (atBottom) break;
        await page.keyboard.press("PageDown");
        await scrollSettled(page);
      }
      expect(seen).toEqual([...STAGES]);
      await expect(page.locator("#contact")).toBeInViewport();

      // The contact form: Tab into it, type, and send with Enter on the button.
      await page.locator("#contact").scrollIntoViewIfNeeded();
      await page.locator("#contact").focus();
      await tabTo(
        page,
        async () => (await focusedName(page)) === "Name",
        "the Name field",
      );
      await page.keyboard.type("Keyboard Test");
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe("Email address");
      await page.keyboard.type("keyboard.test@example.com");
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe("Message");
      await page.keyboard.type(uniqueText("keyboard"));
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe("Send message");
      // A first send with no pointer, answered as a created message (the API's limit is per hour).
      await page.route("**/api/v1/contact", (route) =>
        route.fulfill({ status: 201, body: "{}" }),
      );
      await page.keyboard.press("Enter");
      await expect(page.getByText("Message sent")).toBeVisible();
      // Focus moved to the confirmation, so a screen reader hears it.
      await expect(page.locator("#contact").getByRole("status")).toBeFocused();
      // And the way on is a keyboard one too.
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe("Send another message");

      // Back up to the Ridge by keyboard, and into a Project through the keyboard-focused link.
      await page.locator("#ridge").focus();
      await tabTo(
        page,
        () =>
          page.evaluate(
            () =>
              (document.activeElement as HTMLAnchorElement | null)
                ?.getAttribute?.("href")
                ?.startsWith("/projects/") ?? false,
          ),
        "a Project link",
      );
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/projects\//);
      // The Climb has gone and the Project is drawn (the address changes a moment before the page).
      await expect(page.locator("#climb-title")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // The Project page's own way back is a link, reached and used with the keyboard too.
      await tabTo(
        page,
        async () =>
          (await focusedName(page)).endsWith("Back to the Summary") &&
          (await page.evaluate(() => document.activeElement?.tagName)) === "A",
        "the way back",
      );
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/summary$/);
    });
  });
}
