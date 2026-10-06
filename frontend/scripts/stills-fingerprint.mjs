// What the still images depend on, as one hash. The stills are captured from the full scene;
// if any of these inputs change, the stills are out of date. `capture-stills.mjs` writes the
// hash next to the pictures and `src/still/stillsFresh.test.ts` (part of `npm test`, so part
// of CI) compares it.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Files that shape the picture, relative to the repository root. */
function sceneFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (!/\.test\.tsx?$/.test(entry)) files.push(path);
    }
  };
  walk(join(root, "frontend/src/scene"));
  files.push(join(root, "frontend/src/climb/position.ts"));
  files.push(join(root, "content/hiker/hiker.glb"));
  files.push(join(root, "frontend/scripts/capture-stills.mjs"));
  return files;
}

/** The colour tokens the scene reads, and nothing else of the stylesheet. */
function colourTokens(root) {
  const css = readFileSync(join(root, "frontend/src/index.css"), "utf8");
  return css
    .split("\n")
    .filter((line) => /^\s*--color-[\w-]+:/.test(line))
    .join("\n");
}

export function computeFingerprint(root) {
  const hash = createHash("sha256");
  for (const file of sceneFiles(root)) {
    hash.update(relative(root, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  hash.update(colourTokens(root));
  return hash.digest("hex");
}

/** The inputs, named, so a failing check can say what to look at. */
export function listInputs(root) {
  return [
    ...sceneFiles(root).map((file) =>
      relative(root, file).split(sep).join("/"),
    ),
    "frontend/src/index.css (--color-* tokens)",
  ];
}
