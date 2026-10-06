import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * Browser tests, run against the built site and the real API (the Compose stack):
 *
 *   docker compose up -d --build --wait && npm run e2e
 *
 * The address is BASE_URL (default http://localhost:8080; this checkout's .env may set
 * CADDY_PORT). Chromium runs with software WebGL, so a scene draws on a machine with no GPU.
 * Locally, set CHROME_PATH to use an installed Chrome (default /usr/bin/google-chrome when
 * it exists) instead of downloading Playwright's own browser (`npx playwright install
 * chromium`). Tests never depend on real frame timing.
 *
 * Ticket #19 adds the Climb's own tests; add files here as `e2e/*.spec.ts`.
 */
const local = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const executablePath =
  process.env.CHROME_PATH ??
  (!process.env.CI && existsSync(local) ? local : undefined);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1280, height: 800 },
    // An ordinary browser's name: the API treats "HeadlessChrome" as a bot and records no Visit.
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    launchOptions: {
      executablePath,
      args: [
        "--no-sandbox",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  projects: [{ name: "chromium" }],
});
