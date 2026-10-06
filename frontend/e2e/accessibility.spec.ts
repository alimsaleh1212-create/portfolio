import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  answerVisitsAsABot,
  openClimb,
  scrollToTopOf,
  SIZES,
  STAGES,
  TIERS,
} from "./support";

/**
 * Automated accessibility checks (axe) on every page, on each tier of the Climb, and on each
 * state of the contact form. Serious and critical violations fail the test; a minor or moderate
 * one is listed in the test's output so it is seen. axe cannot judge text over a drawn scene
 * (the pixels are not in the page), so contrast over the scene is measured separately by
 * `scripts/scan.py` and by the token contrast tests.
 */

answerVisitsAsABot();

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const minor = results.violations.filter(
    (v) => v.impact !== "serious" && v.impact !== "critical",
  );
  if (minor.length)
    console.log(
      `${label}: not blocking: ${minor.map((v) => `${v.id} (${v.impact})`).join(", ")}`,
    );
  expect(
    blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target.join(" ")),
    })),
    label,
  ).toEqual([]);
}

test.describe("the Climb, on each tier", () => {
  for (const tier of TIERS) {
    test(`${tier}: opening screen and every Stage`, async ({ page }) => {
      await openClimb(page, tier);
      await expectNoSeriousViolations(page, `${tier} opening`);
      for (const key of [...STAGES, "summit"]) {
        await scrollToTopOf(page, key);
        await expectNoSeriousViolations(page, `${tier} ${key}`);
      }
    });
  }

  test("on a phone, with the open bands", async ({ browser }) => {
    const context = await browser.newContext({ viewport: SIZES.phone });
    const page = await context.newPage();
    await page.route("**/api/v1/visits**", (route) =>
      route.fulfill({ status: 204 }),
    );
    await openClimb(page, "still");
    await expectNoSeriousViolations(page, "phone opening");
    await scrollToTopOf(page, "ridge");
    await expectNoSeriousViolations(page, "phone ridge");
    await context.close();
  });
});

test.describe("the other pages", () => {
  test("the Summary", async ({ page }) => {
    await page.goto("/summary");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page, "summary");
  });

  test("a Project", async ({ page }) => {
    await page.goto("/summary");
    const href = await page
      .locator("a[href^='/projects/']")
      .first()
      .getAttribute("href");
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page, "project");
  });

  test("the not-found page", async ({ page }) => {
    await page.goto("/nowhere");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page, "not found");
  });

  test("the readiness page", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page, "status");
  });
});

test.describe("each state of the contact form", () => {
  const valid = {
    name: "Axe Test",
    email: "axe.test@example.com",
    message: "A message of more than ten characters.",
  };

  async function openForm(page: Page) {
    await page.goto("/summary");
    await page.locator("#contact").scrollIntoViewIfNeeded();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  }
  async function fill(page: Page) {
    await page.getByLabel("Name", { exact: true }).fill(valid.name);
    await page.getByLabel("Email address", { exact: true }).fill(valid.email);
    await page.getByLabel("Message", { exact: true }).fill(valid.message);
  }

  test("ready", async ({ page }) => {
    await openForm(page);
    await expectNoSeriousViolations(page, "form ready");
  });

  test("with a field error", async ({ page }) => {
    await openForm(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expectNoSeriousViolations(page, "form invalid");
  });

  test("sending", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/v1/contact", async (route) => {
      await held;
      await route.fulfill({ status: 201, body: "{}" });
    });
    await openForm(page);
    await fill(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("button", { name: "Sending…" })).toBeVisible();
    await expectNoSeriousViolations(page, "form sending");
    release();
    await expect(page.getByText("Message sent")).toBeVisible();
  });

  test("sent", async ({ page }) => {
    await page.route("**/api/v1/contact", (route) =>
      route.fulfill({ status: 201, body: "{}" }),
    );
    await openForm(page);
    await fill(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Message sent")).toBeVisible();
    await expectNoSeriousViolations(page, "form sent");
  });

  test("failed", async ({ page }) => {
    await page.route("**/api/v1/contact", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await openForm(page);
    await fill(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoSeriousViolations(page, "form failed");
  });

  test("rate limited", async ({ page }) => {
    await page.route("**/api/v1/contact", (route) =>
      route.fulfill({ status: 429, body: "{}" }),
    );
    await openForm(page);
    await fill(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/several messages/)).toBeVisible();
    await expectNoSeriousViolations(page, "form rate limited");
  });

  test("on the Climb's Summit, over the scene", async ({ page }) => {
    await openClimb(page, "full");
    await scrollToTopOf(page, "summit");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expectNoSeriousViolations(page, "summit form invalid");
  });
});
