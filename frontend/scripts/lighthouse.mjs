#!/usr/bin/env node
// Lighthouse on a phone profile (its default mobile emulation and simulated slow 4G) for the
// landing page and the Summary, against the running stack.
//
//   BASE_URL=http://localhost:8080 npm run lighthouse
//
// Prints every category's score, writes each run's report as HTML and JSON to
// frontend/lighthouse-report/ (CI keeps the folder as an artifact), and exits 1 when a gating
// score is under its floor: Accessibility and Best Practices at 95 (the ticket's bar). The
// Performance score is reported, not gated: it moves several points between runs on a shared
// machine, and the budgets that must hold (text visible within 2.5 s, layout shift under 0.1)
// are asserted by e2e/budgets.spec.ts on a throttled profile, which does not depend on a score.
// Set LIGHTHOUSE_MIN_PERFORMANCE to gate it as well.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../lighthouse-report");
const base = (process.env.BASE_URL ?? "http://localhost:8080").replace(
  /\/$/,
  "",
);
const tag = process.env.LIGHTHOUSE_TAG ?? "";
const FLOORS = {
  accessibility: 95,
  "best-practices": 95,
  performance: Number(process.env.LIGHTHOUSE_MIN_PERFORMANCE ?? 0),
};
// The landing page is also measured with the full 3D tier forced: this machine class gets the
// still tier by itself, but a laptop with a GPU gets the scene, and its cost must stay out of the
// first load.
const ALL_PAGES = [
  ["landing", "/"],
  ["summary", "/summary"],
  ["landing-full", "/?tier=full"],
];

// LIGHTHOUSE_ONLY=landing,summary limits the run.
const only = process.env.LIGHTHOUSE_ONLY?.split(",");
const PAGES = ALL_PAGES.filter(([name]) => !only || only.includes(name));

const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
mkdirSync(out, { recursive: true });
const chrome = await launch({
  chromePath: existsSync(chromePath) ? chromePath : undefined,
  chromeFlags: ["--headless=new", "--no-sandbox"],
});

let failed = false;
const summary = {};
try {
  for (const [name, path] of PAGES) {
    const run = await lighthouse(
      base + path,
      { port: chrome.port, logLevel: "error", output: ["html", "json"] },
      {
        extends: "lighthouse:default",
        settings: {
          formFactor: "mobile",
          screenEmulation: {
            mobile: true,
            width: 360,
            height: 740,
            deviceScaleFactor: 2,
            disabled: false,
          },
        },
      },
    );
    const { lhr, report } = run;
    writeFileSync(join(out, `${name}${tag}.html`), report[0]);
    writeFileSync(join(out, `${name}${tag}.json`), report[1]);
    const scores = Object.fromEntries(
      Object.entries(lhr.categories).map(([id, c]) => [
        id,
        Math.round((c.score ?? 0) * 100),
      ]),
    );
    const audit = (id) => lhr.audits[id]?.numericValue;
    summary[name] = {
      scores,
      fcp: audit("first-contentful-paint"),
      lcp: audit("largest-contentful-paint"),
      tbt: audit("total-blocking-time"),
      cls: audit("cumulative-layout-shift"),
    };
    console.log(
      `${name.padEnd(8)} ${Object.entries(scores)
        .map(([k, v]) => `${k} ${v}`)
        .join(
          "  ",
        )}  | FCP ${Math.round(summary[name].fcp)} ms  LCP ${Math.round(summary[name].lcp)} ms  TBT ${Math.round(summary[name].tbt)} ms  CLS ${summary[name].cls.toFixed(3)}`,
    );
    for (const [id, floor] of Object.entries(FLOORS)) {
      if (scores[id] < floor) {
        failed = true;
        console.error(`  FAIL ${name}: ${id} ${scores[id]} is under ${floor}`);
      }
    }
  }
  writeFileSync(
    join(out, `scores${tag}.json`),
    JSON.stringify(summary, null, 2),
  );
} finally {
  await chrome.kill();
}
process.exit(failed ? 1 : 0);
