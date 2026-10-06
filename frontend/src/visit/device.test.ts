import { afterEach, describe, expect, it, vi } from "vitest";

import { deviceClass } from "./device";

function device(coarse: boolean, width: number, height: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
  }));
  vi.stubGlobal("screen", { width, height });
}

afterEach(() => vi.unstubAllGlobals());

describe("deviceClass", () => {
  it.each([
    ["a phone", true, 390, 844, "phone"],
    ["a phone turned sideways", true, 844, 390, "phone"],
    ["a tablet", true, 820, 1180, "tablet"],
    ["a tablet turned sideways", true, 1180, 820, "tablet"],
    ["a large touch device", true, 1366, 1024, "desktop"],
    ["a desktop with a mouse", false, 1920, 1080, "desktop"],
    ["a small window with a mouse", false, 360, 640, "desktop"],
  ] as const)("calls %s a %s", (_n, coarse, width, height, expected) => {
    device(coarse, width, height);
    expect(deviceClass()).toBe(expected);
  });

  it("falls back to desktop when the browser cannot say", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(deviceClass()).toBe("desktop");
  });
});
