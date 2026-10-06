import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { textColorsUsed } from "./rules";
import { names, readTokens } from "./tokens";

const AA_TEXT = 4.5;
const AA_UI = 3;

const tokens = readTokens();
const color = (name: string) => tokens.get(`--color-${name}`)!;

/** Surfaces text can sit on: the page, a raised panel, the dawn glow behind the identity column and the Climb's light. */
const SURFACES = [
  "ground",
  "raised",
  "glow",
  // The Climb's light, Stage by Stage, up to the Summit.
  "light-trailhead",
  "light-long-approach",
  "light-steep-switch",
  "light-ridge",
  "light-high-camp",
  "light-summit",
  "light-ground",
  // Form fields: navy on the night ground, and the Climb's own ground.
  "field",
  "light-field",
];

const sources = import.meta.glob(
  ["../**/*.tsx", "!../**/*.test.tsx", "!../test/**"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

const colors = names("--color-");
const used = new Set<string>();
for (const source of Object.values(sources)) {
  for (const name of textColorsUsed(source, colors)) used.add(name);
}

describe("text contrast, WCAG AA", () => {
  it("is measuring the colours the components use", () => {
    expect([...used]).toEqual(
      expect.arrayContaining(["ink", "ink-muted", "accent", "alert"]),
    );
  });

  // Text on the accent fill is the button label; every other text colour sits on a surface.
  const onSurfaces = [...used].filter((name) => name !== "on-accent");
  const cases = onSurfaces.flatMap((fg) =>
    SURFACES.map((bg) => [fg, bg] as const),
  );

  it.each(cases)("text-%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(color(fg), color(bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(["accent", "accent-hover"])(
    "button label on %s is at least 4.5:1",
    (fill) => {
      expect(
        contrastRatio(color("on-accent"), color(fill)),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(SURFACES)("the focus ring on %s is at least 3:1", (bg) => {
    expect(contrastRatio(color("focus"), color(bg))).toBeGreaterThanOrEqual(
      AA_UI,
    );
  });

  // A Stage's sky is a gradient, so text is checked against every colour it passes through.
  // The darkest and lightest points are among the stops. The horizon glows are the only
  // lighter colours, and text never sits on them (they have no text-safe stops to check).
  const skies = [...tokens]
    .filter(([key]) => /^--background-image-(stage-|summit-sky)/.test(key))
    .map(
      ([key, value]) =>
        [
          key.replace("--background-image-", ""),
          [...value.matchAll(/var\(--color-([\w-]+)\)/g)].map((m) => m[1]),
        ] as const,
    );

  it("checks the five Stage skies and the Summit's", () => {
    expect(skies.map(([name]) => name)).toEqual([
      "stage-trailhead",
      "stage-long-approach",
      "stage-steep-switch",
      "stage-ridge",
      "stage-high-camp",
      "summit-sky",
    ]);
  });

  it.each(skies)(
    "every text colour is at least 4.5:1 across the %s gradient",
    (_name, stops) => {
      for (const stop of stops) {
        for (const fg of onSurfaces) {
          expect(contrastRatio(color(fg), color(stop))).toBeGreaterThanOrEqual(
            AA_TEXT,
          );
        }
      }
    },
  );

  it("makes the Climb's form field edge visible on its ground", () => {
    expect(
      contrastRatio(color("light-field-edge"), color("light-ground")),
    ).toBeGreaterThanOrEqual(AA_UI);
  });

  it("passes for a known pair, so the check can fail", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#808080")).toBeLessThan(AA_TEXT);
  });
});
