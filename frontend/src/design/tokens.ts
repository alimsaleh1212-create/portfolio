import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** The `@theme { ... }` block of index.css, where the tokens are declared. */
function themeBlock(source: string): string {
  const start = source.indexOf("@theme {");
  if (start === -1) throw new Error("index.css has no @theme block");
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("index.css @theme block is not closed");
}

export const themeCss = themeBlock(css);
export const stylesheet = css;

/** Every `--name: value;` declared in the theme, minus Tailwind resets (`--color-*: initial`). */
export function readTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of themeCss.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    if (match[2].trim() !== "initial") tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

/** Names of tokens in a namespace, e.g. `names("--color-")` gives `["ground", "ink", ...]`. */
export function names(prefix: string): string[] {
  return [...readTokens().keys()]
    .filter(
      (key) => key.startsWith(prefix) && !key.includes("--", prefix.length),
    )
    .map((key) => key.slice(prefix.length));
}
