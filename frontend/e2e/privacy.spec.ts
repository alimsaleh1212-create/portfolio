import { expect, test } from "@playwright/test";

import {
  fillAndSend,
  openClimb,
  scrollToTopOf,
  uniqueText,
  watchVisit,
} from "./support";

/**
 * ADR 0002 in a real browser: after a full Visit (the landing page, a Project page, the CV
 * download where the file exists, a contact message) the site has set no cookie, written nothing
 * to local or session storage, and no response asked for a cookie.
 */
test(
  "a full Visit sets no cookie and writes nothing to local or session storage",
  { tag: "@visit" },
  async ({ page, context, request }) => {
    const visit = watchVisit(page);
    const setCookies: string[] = [];
    page.on("response", async (response) => {
      const headers = await response.allHeaders();
      if (headers["set-cookie"]) setCookies.push(response.url());
    });

    // The landing page, and a Project from the Ridge.
    await openClimb(page, "still");
    await scrollToTopOf(page, "ridge");
    const tile = page.locator("#ridge a[href^='/projects/']").first();
    await tile.click();
    await expect(page).toHaveURL(/\/projects\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect
      .poll(() => visit.events.some((e) => e.body.type === "project_opened"))
      .toBe(true);

    // The CV download, where the file exists (a checkout without the source media has none).
    await page.getByRole("link", { name: "Summary" }).first().click();
    await expect(page).toHaveURL(/\/summary$/);
    const media = (await (await request.get("/api/v1/media")).json()) as {
      role?: string;
      kind?: string;
    }[];
    const hasCv = media.some((item) => (item.role ?? item.kind) === "cv_pdf");
    if (hasCv) {
      const download = page.getByRole("link", { name: /Download CV/ });
      const [saved] = await Promise.all([
        page.waitForEvent("download"),
        download.click(),
      ]);
      expect(saved.suggestedFilename()).toMatch(/\.pdf$/i);
      await expect
        .poll(() => visit.events.some((e) => e.body.type === "cv_downloaded"))
        .toBe(true);
    }

    // A contact message, from the Summary's form.
    await fillAndSend(page, {
      name: "Privacy Test",
      email: "privacy.test@example.com",
      message: uniqueText("privacy"),
    });
    await expect(page.getByText("Message sent")).toBeVisible();
    await expect
      .poll(() =>
        visit.events.some((e) => e.body.type === "contact_message_sent"),
      )
      .toBe(true);

    // Now: no cookie in the browser, none in the page, nothing in either storage, no Set-Cookie.
    expect(await context.cookies()).toEqual([]);
    const state = await page.evaluate(() => ({
      cookie: document.cookie,
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    expect(state).toEqual({ cookie: "", local: [], session: [] });
    expect(setCookies).toEqual([]);

    // The same on the landing page, reached again in this Visit (the origin's storage is shared).
    await page.goto("/");
    expect(
      await page.evaluate(() => [
        document.cookie,
        window.localStorage.length,
        window.sessionStorage.length,
      ]),
    ).toEqual(["", 0, 0]);
    expect(await context.cookies()).toEqual([]);
  },
);
