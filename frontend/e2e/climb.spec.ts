import { expect, test } from "@playwright/test";

import {
  answerVisitsAsABot,
  expectStage,
  fillAndSend,
  openClimb,
  scrollToTopOf,
  sql,
  SIZES,
  STAGES,
  TIERS,
  uniqueText,
  watchVisit,
  type SizeName,
} from "./support";

/**
 * The whole Climb (ticket #19), on each tier at a desktop and a phone size: from the opening
 * screen to the contact form, Stage by Stage, with the Visit recording it and a message stored.
 * Nothing here waits on real frame timing or a fixed pause; each step waits for the condition
 * the next one needs.
 */

answerVisitsAsABot();

for (const tier of TIERS) {
  for (const size of Object.keys(SIZES) as SizeName[]) {
    test.describe(`${tier} tier, ${size}`, () => {
      test.use({ viewport: SIZES[size] });

      test(
        "scrolls from the opening screen to the contact form",
        { tag: "@visit" },
        async ({ page }) => {
          const visit = watchVisit(page);
          await openClimb(page, tier);

          // The opening screen: a headline, and the Summary one click away.
          await expect(page.locator("#climb-title")).toBeInViewport();
          await page.getByRole("link", { name: "Read the Summary" }).click();
          await expect(page).toHaveURL(/\/summary$/);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await page.goBack();
          await expect(page.locator("#climb-title")).toBeInViewport();
          await expect(page.locator("html")).toHaveAttribute(
            "data-scene",
            "on",
          );

          // Five Stages, in order. The address follows the Visitor, so it names the Stage.
          const order: string[] = [];
          for (const key of STAGES) {
            await scrollToTopOf(page, key);
            await expectStage(page, key);
            await expect(page.locator(`#${key}-heading`)).toBeInViewport();
            order.push(key);
            if (key === "ridge") {
              // A Project opens from the Ridge, and the way back lands on the Ridge.
              const tile = page.locator("#ridge a[href^='/projects/']").first();
              const slug = (await tile.getAttribute("href"))!;
              await tile.click();
              await expect(page).toHaveURL(new RegExp(`${slug}$`));
              await expect(
                page.getByRole("heading", { level: 1 }),
              ).toBeVisible();
              await expect
                .poll(() =>
                  visit.events.some((e) => e.body.type === "project_opened"),
                )
                .toBe(true);
              await page.goBack();
              await expect(page.locator("#ridge-heading")).toBeAttached();
              await scrollToTopOf(page, "ridge");
              await expectStage(page, "ridge");
            }
          }
          expect(order).toEqual([...STAGES]);

          // The Summit's stretch, then the contact form, and a message sent.
          await scrollToTopOf(page, "summit");
          const form = page.locator("#contact");
          await form.scrollIntoViewIfNeeded();
          const text = uniqueText(`climb ${tier} ${size}`);
          await fillAndSend(page, {
            name: "Browser Test",
            email: "browser.test@example.com",
            message: text,
          });
          await expect(page.getByText("Message sent")).toBeVisible();

          // The Visit recorded Progress up to High Camp, in order, and the rest of what happened.
          await expect.poll(() => visit.startStatus).toBe(201);
          expect(visit.id).toMatch(/^[0-9a-f-]{36}$/);
          await expect
            .poll(() =>
              visit.events.some((e) => e.body.type === "contact_message_sent"),
            )
            .toBe(true);
          expect(visit.events.every((event) => event.status < 300)).toBe(true);
          const reached = visit.events
            .filter((event) => event.body.type === "stage_reached")
            .map((event) => event.body.stage);
          expect(reached).toEqual([...STAGES]);
          expect(
            visit.events.filter((e) => e.body.type === "project_opened"),
          ).toHaveLength(1);
          // And the API stored them: the Visit's own rows, and the message.
          await expect
            .poll(() =>
              sql(
                `SELECT string_agg(stage_key, ',' ORDER BY id) FROM visit_events WHERE visit_id = '${visit.id}' AND type = 'stage_reached'`,
              ),
            )
            .toBe(STAGES.join(","));
          await expect
            .poll(() =>
              sql(
                `SELECT count(*) FROM contact_messages WHERE message = '${text}'`,
              ),
            )
            .toBe("1");
        },
      );
    });
  }
}
