/**
 * Tokens-only rules for component source. `findViolations` returns one message
 * per breach, so the test can show exactly what to fix.
 */

export interface TokenNames {
  colors: string[];
  textSizes: string[];
  animations: string[];
}

/** Utility prefixes that take a colour. */
const COLOR_PREFIXES = [
  "text",
  "bg",
  "border",
  "ring",
  "outline",
  "fill",
  "stroke",
  "divide",
  "decoration",
  "accent",
  "from",
  "via",
  "to",
  "marker",
  "caret",
  "placeholder",
];

/** `text-` utilities that are neither a size nor a colour. */
const TEXT_KEYWORDS = new Set([
  "left",
  "right",
  "center",
  "justify",
  "start",
  "end",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
  "ellipsis",
  "clip",
]);

/** Tailwind's default palette names: using one means bypassing the tokens. */
const DEFAULT_PALETTE =
  /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d+)?$/;

/** Class-like tokens in a source file: whatever follows `variant:` prefixes. */
export function utilityTokens(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
    for (const word of match[1].split(/\s+/)) {
      if (/^[!a-z0-9:()\-_./[\]%]+$/.test(word) && word.length > 1)
        found.push(word);
    }
  }
  return found;
}

export function findViolations(source: string, tokens: TokenNames): string[] {
  const problems: string[] = [];

  for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    problems.push(`hard-coded colour ${match[0]}`);
  }
  for (const match of source.matchAll(
    /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/g,
  )) {
    problems.push(`hard-coded colour function ${match[0]}`);
  }
  for (const match of source.matchAll(
    /\b\d*\.?\d+(?:px|ms|rem|em|vh|vw|dvh)\b/g,
  )) {
    problems.push(`hard-coded size or time ${match[0]}`);
  }
  for (const match of source.matchAll(/\b\d*\.?\d+s\b(?=["'\s,;)])/g)) {
    problems.push(`hard-coded duration ${match[0]}`);
  }

  for (const token of utilityTokens(source)) {
    const base = token.split(":").pop() ?? token;
    const utility = base.replace(/^!/, "");

    if (/\[[^\]]*\]/.test(utility) && /^[a-z-]+-\[/.test(utility)) {
      problems.push(`arbitrary value in class "${token}"`);
      continue;
    }
    if (/^-?(duration|delay)-\d+$/.test(utility)) {
      problems.push(`numeric timing in class "${token}"`);
      continue;
    }
    const animate = /^animate-([a-z-]+)$/.exec(utility);
    if (
      animate &&
      animate[1] !== "none" &&
      !tokens.animations.includes(animate[1])
    ) {
      problems.push(`animation "${token}" is not a token`);
      continue;
    }

    const colorUse = new RegExp(
      `^(${COLOR_PREFIXES.join("|")})-([a-z][a-z-]*(?:-\\d+)?)(?:/\\d+)?$`,
    ).exec(utility);
    if (colorUse) {
      const [, prefix, name] = colorUse;
      if (DEFAULT_PALETTE.test(name)) {
        problems.push(`default palette colour "${token}"`);
        continue;
      }
      const isColor = tokens.colors.includes(name);
      if (prefix === "text") {
        if (
          !isColor &&
          !tokens.textSizes.includes(name) &&
          !TEXT_KEYWORDS.has(name)
        ) {
          problems.push(`"${token}" is neither a colour nor a size token`);
        }
      } else if (!isColor && !NON_COLOR_WORDS.has(name) && !/^\d/.test(name)) {
        problems.push(`"${token}" uses a colour that is not a token`);
      }
    }
  }
  return problems;
}

/** Words after a colour prefix that are layout or image tokens, not colours (`border-s`, `bg-dawn`). */
const NON_COLOR_WORDS = new Set([
  "s",
  "e",
  "t",
  "b",
  "l",
  "r",
  "x",
  "y",
  "solid",
  "dashed",
  "dotted",
  "none",
  "transparent",
  "inherit",
  "current",
  "dawn",
  "horizon",
  "stage-trailhead",
  "stage-long-approach",
  "stage-steep-switch",
  "stage-ridge",
  "stage-high-camp",
  "horizon-trailhead",
  "horizon-long-approach",
  "horizon-steep-switch",
  "horizon-ridge",
  "horizon-high-camp",
  "peak-foot",
  "summit-sky",
  "summit-face",
  "summit-glow",
  "portrait-fade",
  "scrim-left",
  "scrim-right",
  "scrim-veil",
  "scrim-top",
  "slope-rise",
  "rail-shade",
  "no-repeat",
  "repeat",
  "cover",
  "contain",
  "center",
]);

/** Colour tokens used as `text-*` in a source file, for the contrast check. */
export function textColorsUsed(source: string, colors: string[]): Set<string> {
  const used = new Set<string>();
  for (const token of utilityTokens(source)) {
    const name = /^text-([a-z][a-z-]*)$/.exec(
      token.split(":").pop() ?? "",
    )?.[1];
    if (name && colors.includes(name)) used.add(name);
  }
  return used;
}
