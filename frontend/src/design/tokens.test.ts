import { describe, expect, it } from "vitest";

import { findViolations, type TokenNames } from "./rules";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { names, readTokens, stylesheet, themeCss } from "./tokens";

const tokens: TokenNames = {
  colors: names("--color-"),
  textSizes: names("--text-"),
  animations: names("--animate-"),
};

// Every component and page source, as text. Tests and the design checks themselves are not components.
const sources = import.meta.glob(
  ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../design/**", "!../test/**"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

describe("the checker", () => {
  const bad: Array<[string, string]> = [
    ['<p className="text-[13px]" />', "arbitrary value"],
    ['<p className="p-[7px]" />', "arbitrary value"],
    ['<p className="md:bg-[#fff]" />', "hard-coded colour"],
    ['<p style={{ color: "#ff0000" }} />', "hard-coded colour #ff0000"],
    ['<p style={{ color: "rgb(1 2 3)" }} />', "colour function"],
    ['<p style={{ marginTop: "12px" }} />', "hard-coded size"],
    ['<p style={{ transitionDuration: "300ms" }} />', "hard-coded size or time 300ms"],
    ['<p className="duration-300" />', "numeric timing"],
    ['<p className="bg-red-500" />', "default palette"],
    ['<p className="text-white" />', "default palette"],
    ['<p className="bg-banana" />', "not a token"],
    ['<p className="text-banana" />', "neither a colour nor a size"],
    ['<p className="animate-spin" />', "not a token"],
  ];
  it.each(bad)("flags %s", (source, expected) => {
    expect(findViolations(source, tokens).join("\n")).toContain(expected);
  });

  it("accepts token utilities", () => {
    const good =
      '<p className="text-ink bg-raised border-line text-lg hover:text-accent animate-rise px-gutter text-balance" />';
    expect(findViolations(good, tokens)).toEqual([]);
  });
});

describe("components use tokens only", () => {
  it("finds the component sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  it.each(Object.entries(sources))(
    "%s has no literal colour, size, space or timing",
    (_path, source) => {
      expect(findViolations(source, tokens)).toEqual([]);
    },
  );
});

describe("the stylesheet uses tokens only", () => {
  it("writes literals only inside @theme or as a token override", () => {
    const outside = stylesheet.replace(themeCss, "");
    const offending = outside
      .split("\n")
      .filter(
        (line) =>
          !line.trim().startsWith("--") &&
          !line.trim().startsWith("/*") &&
          !line.trim().startsWith("*") &&
          !line.includes("@import") &&
          !line.startsWith("@custom-variant"),
      )
      .filter((line) => /#[0-9a-fA-F]{3,8}\b|\b\d*\.?\d+(px|ms|rem|em|s)\b/.test(line));
    expect(offending).toEqual([]);
  });
});

describe("the favicon", () => {
  it("is drawn only in palette colours (colour literals are allowed in an SVG asset if they match a token)", () => {
    const svg = readFileSync(resolve(process.cwd(), "public/favicon.svg"), "utf8");
    const palette = new Set(
      [...readTokens()]
        .filter(([key]) => key.startsWith("--color-"))
        .map(([, value]) => value.toLowerCase()),
    );
    const used = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => match[0].toLowerCase());
    expect(used.length).toBeGreaterThan(0);
    for (const hex of used) expect(palette).toContain(hex);
  });
});
