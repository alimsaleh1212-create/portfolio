import { afterEach, describe, expect, it, vi } from "vitest";

import { readDebug, sceneSupported } from "./support";
import { watchVisibility } from "./visibility";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function contextOf(result: unknown) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => result) as never,
  );
}

describe("where the scene may be drawn", () => {
  it("not where WebGL is unavailable", () => {
    contextOf(null);
    expect(sceneSupported()).toBe(false);
  });

  it("not where making a context throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("blocked");
      },
    );
    expect(sceneSupported()).toBe(false);
  });

  it("where a context can be made, and it lets the test context go at once", () => {
    const lose = vi.fn();
    contextOf({ getExtension: () => ({ loseContext: lose }) });
    expect(sceneSupported()).toBe(true);
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it("not where reduced motion is requested, even with WebGL", () => {
    contextOf({ getExtension: () => null });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    expect(sceneSupported()).toBe(false);
  });
});

describe("the debug view", () => {
  it("is off unless asked for in the address", () => {
    expect(readDebug("")).toEqual({ debug: false, at: null });
    expect(readDebug("?other=1")).toEqual({ debug: false, at: null });
  });

  it("is on with ?debug, and can pin the camera at a point on the journey", () => {
    expect(readDebug("?debug")).toEqual({ debug: true, at: null });
    expect(readDebug("?debug&at=3.5")).toEqual({ debug: true, at: 3.5 });
    expect(readDebug("?debug&at=40").at).toBe(6);
    expect(readDebug("?debug&at=nope").at).toBeNull();
  });
});

describe("the tab being hidden", () => {
  it("reports the state at the start and each change, and stops when told", () => {
    const target = new EventTarget();
    const doc = Object.assign(target, { hidden: false }) as unknown as Document;
    const seen: boolean[] = [];
    const stop = watchVisibility(doc, (hidden) => seen.push(hidden));
    expect(seen).toEqual([false]);
    Object.defineProperty(doc, "hidden", { value: true, configurable: true });
    doc.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(doc, "hidden", { value: false, configurable: true });
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(seen).toEqual([false, true, false]);
    stop();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(seen).toHaveLength(3);
  });
});
