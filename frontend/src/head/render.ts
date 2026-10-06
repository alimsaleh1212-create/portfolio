import { headTags, type HeadModel, type HeadTag } from "./model";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** JSON that is safe inside a `<script>`: nothing in it can close the tag or open a comment. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Marks what the pre-render wrote, so the browser can replace it when the Visitor moves on. */
export const HEAD_MARK = "data-head";

function serialise({ tag, attrs, text }: HeadTag): string {
  const attributes = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
  if (tag === "script") {
    return `<script${attributes} ${HEAD_MARK}>${text === undefined ? "" : text.replace(/</g, "\\u003c")}</script>`;
  }
  return `<${tag}${attributes} ${HEAD_MARK}>`;
}

/** The `<title>` and every tag of a model, as HTML for the page's head. */
export function renderHead(model: HeadModel): string {
  const lines = [`<title>${escapeHtml(model.title)}</title>`];
  for (const tag of headTags(model)) lines.push(serialise(tag));
  return lines.join("\n    ");
}
