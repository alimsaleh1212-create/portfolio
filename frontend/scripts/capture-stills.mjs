#!/usr/bin/env node
// Captures the still tier's pictures from the full scene, so they cannot drift from it by hand.
//
//   npm run stills                      against http://localhost:8080 (the running stack)
//   npm run stills -- --base URL        another address
//   npm run stills -- --out DIR         write somewhere else (default: ../content/stills)
//
// Needs the stack up (the API serves the content and the Hiker's model) and a browser with
// software WebGL, which this script starts itself: Google Chrome from CHROME_PATH or
// /usr/bin/google-chrome if present, otherwise Playwright's Chromium.
//
// For each position of the journey (the opening screen, the five Stages, the Summit view) and
// each composition (wide 1600x1000, narrow 390x800 at 1.5x) it opens the page with the tier
// forced to full, scrolls to the position, waits until the camera and the Hiker are at rest,
// hides everything but the canvas, and saves the frame. The text is hidden because the still
// tier puts the page's own text over the picture; the Hiker stays wherever the full scene
// shows it. Afterwards it writes stills.json: the hash of what the pictures depend on.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import { computeFingerprint } from "./stills-fingerprint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const base = option("--base", process.env.BASE_URL ?? "http://localhost:8080");
const out = resolve(option("--out", join(root, "content/stills")));

const POSITIONS = [
  "opening",
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
  "summit",
];
const COMPOSITIONS = {
  wide: { viewport: { width: 1600, height: 1000 }, scale: 1 },
  narrow: { viewport: { width: 390, height: 800 }, scale: 1.5 },
};

const HIDE = `
  body * { visibility: hidden !important; }
  [data-testid="scene"], [data-testid="scene"] canvas { visibility: visible !important; }
  [data-testid="scene"] .bg-rail-shade, pre { display: none !important; }
`;

const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const browser = await chromium.launch({
  executablePath: existsSync(chrome) ? chrome : undefined,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(composition) {
  const { viewport, scale } = COMPOSITIONS[composition];
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  await page.goto(`${base}/?tier=full&debug`, { waitUntil: "load" });
  // The scene is on when the page's root says so; the Hiker has loaded when it can be probed.
  await page.waitForSelector("html[data-scene='on']", { timeout: 120_000 });
  await page.waitForFunction(
    () => window.probeHiker?.()?.hiker?.world?.[1] !== undefined,
    null,
    { timeout: 60_000 },
  );
  await page.addStyleTag({ content: HIDE });
  const tops = await page.evaluate((positions) => {
    const top = (id) =>
      document.getElementById(id).getBoundingClientRect().top + scrollY;
    return positions.map((name) =>
      name === "opening" ? 0 : top(name === "summit" ? "summit" : name),
    );
  }, POSITIONS);
  const files = {};
  for (const [index, name] of POSITIONS.entries()) {
    await page.evaluate((y) => window.scrollTo(0, y), tops[index]);
    // At rest: the camera is at its place on the journey and the Hiker has stopped and shows.
    let last = "";
    let same = 0;
    for (let tries = 0; tries < 80 && same < 4; tries++) {
      await sleep(400);
      const probe = await page.evaluate(() => {
        const p = window.probeHiker?.().hiker;
        return p
          ? `${p.journey.toFixed(4)} ${p.walking.toFixed(3)} ${p.visibility.toFixed(2)}`
          : "";
      });
      same = probe !== "" && probe === last ? same + 1 : 0;
      last = probe;
    }
    const [journey, walking] = last.split(" ").map(Number);
    if (same < 4 || Math.abs(journey - index) > 0.02 || walking > 0.02) {
      throw new Error(
        `${name} (${composition}) did not come to rest at ${index}: ${last}`,
      );
    }
    await sleep(600);
    const file = `${name}-${composition}.png`;
    await page.screenshot({ path: join(out, file), type: "png" });
    files[file] = { journey, hiker: last.split(" ")[2] };
    console.log(
      `${file}  journey ${journey}  hiker visibility ${files[file].hiker}`,
    );
  }
  await context.close();
  return files;
}

try {
  const taken = {};
  for (const composition of Object.keys(COMPOSITIONS)) {
    Object.assign(taken, await capture(composition));
  }
  writeFileSync(
    join(out, "stills.json"),
    JSON.stringify(
      {
        note: "Written by frontend/scripts/capture-stills.mjs. Do not edit. `npm test` fails when the fingerprint no longer matches the scene.",
        fingerprint: computeFingerprint(root),
        compositions: COMPOSITIONS,
        files: taken,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Wrote ${Object.keys(taken).length} pictures and stills.json to ${out}`,
  );
} finally {
  await browser.close();
}
