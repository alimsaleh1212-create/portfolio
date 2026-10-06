import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getClimb,
  highestReached,
  readClimb,
  scrollToStage,
  trackClimb,
} from "./climb";

const keys = ["a", "b", "c"];
// Document positions of three Stages; the opening screen is the first 1000.
const tops = [1000, 2000, 4000];

describe("readClimb", () => {
  it("is 0 on the opening screen and has no current Stage", () => {
    const state = readClimb(keys, tops, 0, 800);
    expect(state.progress).toBe(0);
    expect(state.stage).toBeNull();
  });

  it("places each Stage along 0 to 1 by where it really is", () => {
    const { stages } = readClimb(keys, tops, 0, 800);
    expect(stages.map((s) => s.position)).toEqual([0, 1 / 3, 1]);
  });

  it("is 1 at the last Stage and stays 1 below it", () => {
    expect(readClimb(keys, tops, 4000, 800).progress).toBe(1);
    expect(readClimb(keys, tops, 6000, 800).progress).toBe(1);
    expect(readClimb(keys, tops, 6000, 800).stage).toBe("c");
  });

  it("makes a Stage current once its top passes the middle of the screen", () => {
    expect(readClimb(keys, tops, 1000 - 400, 800).stage).toBe("a");
    expect(readClimb(keys, tops, 1000 - 401, 800).stage).toBeNull();
    expect(readClimb(keys, tops, 2000 - 400, 800).stage).toBe("b");
  });
});

describe("highestReached", () => {
  it("counts no Stage below the fold of an unscrolled page", () => {
    expect(highestReached(tops, 0, 800)).toBe(-1);
  });
  it("counts every Stage a jump went past", () => {
    expect(highestReached(tops, 5000, 800)).toBe(2);
  });
});

describe("trackClimb", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function page(scrollY: number) {
    document.body.innerHTML = keys
      .map((k) => `<section id="${k}"></section>`)
      .join("");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const top = tops[keys.indexOf(this.id)] - window.scrollY;
        return { top } as DOMRect;
      },
    );
    window.innerHeight = 800;
    Object.defineProperty(window, "scrollY", {
      value: scrollY,
      configurable: true,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  }

  it("reports each Stage once, in order, and publishes progress", () => {
    page(0);
    const reached: string[] = [];
    const stop = trackClimb(keys, (key) => reached.push(key));
    expect(reached).toEqual([]);
    for (const y of [500, 1000, 1000, 2500, 4000, 4000, 0]) {
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
      window.dispatchEvent(new Event("scroll"));
    }
    expect(reached).toEqual(["a", "b", "c"]);
    stop();
    expect(getClimb().stage).toBeNull();
  });

  it("counts a jump to the bottom as passing every Stage", () => {
    page(5000);
    const reached: string[] = [];
    const stop = trackClimb(keys, (key) => reached.push(key));
    expect(reached).toEqual(["a", "b", "c"]);
    expect(getClimb().progress).toBe(1);
    stop();
  });

  it("moves to a Stage without smooth scrolling when reduced motion is asked for", () => {
    page(0);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.matchMedia = ((query: string) =>
      ({
        matches: true,
        media: query,
      }) as MediaQueryList) as typeof window.matchMedia;
    scrollToStage("b");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
    expect(window.location.hash).toBe("#b");
  });
});
