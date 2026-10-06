import { describe as suite, expect, it } from "vitest";

import { describe, DESCRIPTION_MAX, plainText } from "./description";

const LONG =
  "I built a multi-agent pipeline that triages alerts, enriches them from three sources and " +
  "proposes a response for a person to approve, and I measured it against a simulated threat " +
  "feed for two months before anyone relied on it.";

suite("plainText", () => {
  it("removes tags and Markdown marks and collapses whitespace", () => {
    expect(
      plainText("<p>I  built\n<b>agents</b></p> and *tools* with `code`"),
    ).toBe("I built agents and tools with code");
  });

  it("keeps the words of a Markdown link and drops its address", () => {
    expect(plainText("See [the repo](https://example.com/x) now")).toBe(
      "See the repo now",
    );
  });
});

suite("describe", () => {
  it("returns short text whole, as sentences", () => {
    expect(
      describe(["Claude Code, Codex", "I orchestrated three agents."]),
    ).toBe("Claude Code, Codex. I orchestrated three agents.");
  });

  it("never exceeds the limit", () => {
    for (const max of [60, 100, 155, DESCRIPTION_MAX]) {
      expect(describe([LONG], max).length).toBeLessThanOrEqual(max);
    }
  });

  it("never cuts a word in half", () => {
    const words = new Set(LONG.replace(/[.,]/g, "").split(" "));
    for (let max = 40; max < 200; max += 3) {
      const text = describe([LONG], max).replace(/…$/, "").replace(/[.,]$/, "");
      const last = text.split(" ").at(-1) ?? "";
      expect(words.has(last)).toBe(true);
    }
  });

  it("does not end on a word that needs the next one", () => {
    const text = describe(
      ["I built agents that work together with other tools"],
      36,
    );
    expect(text).toBe("I built agents that work together\u2026");
  });

  it("ends with an ellipsis when it stops mid-sentence, and with a full stop at a sentence", () => {
    const cut = describe([LONG], 80);
    expect(cut.endsWith("…")).toBe(true);
    const two =
      "I built agents for a team of nine. " +
      "x".repeat(30) +
      " and more words here.";
    expect(describe([two], 50)).toBe("I built agents for a team of nine.");
  });

  it("is plain text: no tags, no Markdown, one space between words", () => {
    const text = describe([
      "<h1>Title</h1>",
      "I **built** a <em>thing</em>   today.",
    ]);
    expect(text).toBe("Title. I built a thing today.");
    expect(text).not.toMatch(/[<>*_`]|\s{2}/);
  });

  it("does not double the full stop of a piece that has one", () => {
    expect(describe(["Done.", "Also done!"])).toBe("Done. Also done!");
  });

  it("returns an empty string for no text", () => {
    expect(describe(["", "  "])).toBe("");
  });
});
