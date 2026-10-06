/**
 * Descriptions for search results and link previews, built from the seeded text.
 *
 * Search engines show roughly the first 155 to 160 characters, so a description is at most
 * `DESCRIPTION_MAX`. It is plain text (no markup), whitespace is collapsed, and when the text is
 * too long it ends at a sentence if one fits, otherwise at a whole word with an ellipsis.
 */

export const DESCRIPTION_MAX = 160;

const ELLIPSIS = "\u2026";

/** Words a description should not end on when it stops mid-sentence ("... backed by" or "... with"). */
const DANGLING = new Set(
  "a an the and or but of to for in on at by with from as into over under per via than that which who whose is are was were be".split(
    " ",
  ),
);

/** Remove tags, Markdown marks and entities' worth of noise, and collapse whitespace. */
export function plainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Join sentences, giving each a full stop unless it already ends in punctuation. */
function sentences(parts: string[]): string {
  return parts
    .map(plainText)
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

/**
 * One description from one or more pieces of text, no longer than `max` characters. Pieces
 * are joined as sentences. Too long, it ends at the last complete sentence that fits; only when
 * the first sentence alone is too long does it end at a whole word with an ellipsis.
 */
export function describe(parts: string[], max = DESCRIPTION_MAX): string {
  const text = sentences(parts);
  if (text.length <= max) return text;

  // End at the last complete sentence that fits, however short.
  const room = text.slice(0, max);
  const stops = [...room.matchAll(/[.!?](?=\s|$)/g)].filter(
    (stop) => stop.index + 1 === max || /\s/.test(text[stop.index + 1] ?? " "),
  );
  const lastStop = stops.at(-1);
  if (lastStop) return room.slice(0, lastStop.index + 1);

  // The first sentence alone is too long: end at a whole word, leaving room for the ellipsis.
  const limit = max - ELLIPSIS.length;
  let cut = text.slice(0, limit);
  if (!/\s/.test(text[limit] ?? "")) {
    const space = cut.lastIndexOf(" ");
    if (space > 0) cut = cut.slice(0, space);
  }
  const words = cut.replace(/[\s,;:\u2013\u2014-]+$/, "").split(" ");
  while (words.length > 1 && DANGLING.has(words.at(-1)!.toLowerCase())) {
    words.pop();
  }
  return `${words.join(" ").replace(/[\s,;:\u2013\u2014-]+$/, "")}${ELLIPSIS}`;
}
