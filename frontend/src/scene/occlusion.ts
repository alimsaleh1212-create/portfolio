import type { ScreenBox } from "./controller";

/**
 * Whether page content is over a place on the screen. The scene never reads the page; this is
 * the one place that asks, so the Hiker can step out of the way of text and cards.
 */
const TEXT_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "SPAN",
  "A",
  "LI",
  "BUTTON",
  "INPUT",
  "TEXTAREA",
  "LABEL",
  "DT",
  "DD",
  "NAV",
  "VIDEO",
  "IMG",
  "TIME",
  "CODE",
  "SVG",
]);

/** Is page content (text, a card, a control, a bar) at this point of the screen? */
function contentAt(x: number, y: number): boolean {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-testid="scene"]')) continue;
    if (TEXT_TAGS.has(el.tagName.toUpperCase())) return true;
    const style = getComputedStyle(el);
    if (parseFloat(style.borderTopWidth) > 0) return true;
    const alpha = style.backgroundColor.match(/[\d.]+/g)?.[3];
    // A transparent background computes to four zeros, so its alpha is 0.
    const filled = alpha === undefined || parseFloat(alpha) > 0.3;
    const rect = el.getBoundingClientRect();
    if (filled && rect.width * rect.height < 0.4 * innerWidth * innerHeight)
      return true;
    // The first real element under the scene decides: a plain wrapper means open ground.
    return false;
  }
  return false;
}

/** Is any of a 3 by 3 grid of points over the box on page content? */
export function contentOver(box: ScreenBox): boolean {
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x = box.left + ((box.right - box.left) * i) / 2;
      const y = box.top + ((box.bottom - box.top) * j) / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      if (contentAt(x, y)) return true;
    }
  return false;
}
