import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseTier,
  getTier,
  lowerTier,
  resetTierForTests,
  subscribeTier,
} from "./tier";

function device(options: {
  webgl?: boolean;
  renderer?: string | null;
  reduced?: boolean;
  memory?: number;
  cores?: number;
  strictFails?: boolean;
}) {
  const { webgl = true, renderer = "NVIDIA GeForce RTX 3060" } = options;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    kind: string,
    attributes?: { failIfMajorPerformanceCaveat?: boolean },
  ) => {
    if (!webgl || kind !== "webgl2") return null;
    if (attributes?.failIfMajorPerformanceCaveat && options.strictFails) {
      return null;
    }
    return {
      getExtension: (name: string) =>
        name === "WEBGL_debug_renderer_info" && renderer !== null
          ? { UNMASKED_RENDERER_WEBGL: 1 }
          : null,
      getParameter: () => renderer,
    };
  }) as never);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: Boolean(options.reduced) && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("navigator", {
    deviceMemory: options.memory,
    hardwareConcurrency: options.cores,
  });
}

beforeEach(() => {
  resetTierForTests();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-tier");
});

describe("choosing the tier at page load", () => {
  it("serves full to a capable device, and marks the page", () => {
    device({ memory: 8, cores: 8 });
    expect(chooseTier()).toBe("full");
    expect(document.documentElement.dataset.tier).toBe("full");
  });

  it("serves still for software rendering named by the renderer", () => {
    device({ renderer: "ANGLE (Google, SwiftShader)", memory: 8, cores: 8 });
    expect(chooseTier()).toBe("still");
  });

  it("serves still when the browser hides the renderer but refuses a context that would be slow", () => {
    device({ renderer: null, strictFails: true, memory: 8, cores: 8 });
    expect(chooseTier()).toBe("still");
  });

  it("takes a hidden renderer for hardware when a strict context can be made", () => {
    device({ renderer: null, memory: 8, cores: 8 });
    expect(chooseTier()).toBe("full");
  });

  it("serves light to a device that reports nothing at all", () => {
    device({});
    expect(chooseTier()).toBe("light");
  });

  it("serves still without WebGL, and with reduced motion", () => {
    device({ webgl: false, memory: 8, cores: 8 });
    expect(chooseTier()).toBe("still");
    resetTierForTests();
    device({ reduced: true, memory: 8, cores: 8 });
    expect(chooseTier()).toBe("still");
  });

  it("can be forced from the address, over what the device would get", () => {
    device({ webgl: false });
    window.history.replaceState(null, "", "/?tier=full");
    expect(chooseTier()).toBe("full");
  });

  it("decides once", () => {
    device({ memory: 8, cores: 8 });
    expect(chooseTier()).toBe("full");
    device({ webgl: false });
    expect(chooseTier()).toBe("full");
    expect(getTier()).toBe("full");
  });

  it("serves light, and tells the Visit nothing, when the decision itself fails", () => {
    device({ memory: 8, cores: 8 });
    vi.stubGlobal("navigator", {
      get deviceMemory(): number {
        throw new Error("blocked");
      },
    });
    expect(chooseTier()).toBeUndefined();
    expect(getTier()).toBe("light");
  });
});

describe("lowering the tier while running", () => {
  beforeEach(() => {
    device({ memory: 8, cores: 8 });
    chooseTier();
  });

  it("goes from full to light, and tells those watching", () => {
    const seen = vi.fn();
    subscribeTier(seen);
    expect(lowerTier("light")).toBe(true);
    expect(getTier()).toBe("light");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.tier).toBe("light");
  });

  it("never goes back up, and never flips", () => {
    lowerTier("light");
    expect(lowerTier("full")).toBe(false);
    expect(lowerTier("light")).toBe(false);
    expect(getTier()).toBe("light");
    lowerTier("still");
    expect(lowerTier("light")).toBe(false);
    expect(lowerTier("full")).toBe(false);
    expect(getTier()).toBe("still");
  });
});
