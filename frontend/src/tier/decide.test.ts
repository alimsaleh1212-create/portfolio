import { describe, expect, it } from "vitest";

import { decideTier, forcedTier, isLighter, type DeviceReport } from "./decide";
import { rendererIsSoftware } from "./device";

const capable: DeviceReport = {
  webgl2: true,
  software: false,
  reducedMotion: false,
  saveData: false,
  memoryGb: 8,
  cores: 8,
};
const tier = (change: Partial<DeviceReport>) =>
  decideTier({ ...capable, ...change });

describe("the tier rule", () => {
  it("serves full to a capable device", () => {
    expect(tier({})).toBe("full");
  });

  it("serves still when reduced motion is requested, whatever else is true", () => {
    expect(tier({ reducedMotion: true })).toBe("still");
  });

  it("serves still without WebGL 2", () => {
    expect(tier({ webgl2: false })).toBe("still");
  });

  it("serves still for software rendering, even on a strong machine", () => {
    expect(tier({ software: true })).toBe("still");
  });

  it("serves light when data saver is on", () => {
    expect(tier({ saveData: true })).toBe("light");
  });

  it("serves light with little memory, or few processors", () => {
    expect(tier({ memoryGb: 2 })).toBe("light");
    expect(tier({ memoryGb: 3.9 })).toBe("light");
    expect(tier({ cores: 2 })).toBe("light");
    expect(tier({ cores: 3 })).toBe("light");
  });

  it("serves full right at the minimums", () => {
    expect(tier({ memoryGb: 4, cores: 4 })).toBe("full");
  });

  it("serves full when only one of memory and processors is reported and it is enough", () => {
    expect(tier({ memoryGb: null })).toBe("full");
    expect(tier({ cores: null })).toBe("full");
  });

  it("serves light to a device about which nothing is known", () => {
    expect(tier({ memoryGb: null, cores: null })).toBe("light");
    expect(tier({ software: null })).toBe("light");
    expect(
      decideTier({
        webgl2: true,
        software: null,
        reducedMotion: false,
        saveData: false,
        memoryGb: null,
        cores: null,
      }),
    ).toBe("light");
  });

  it("puts still ahead of light when both apply", () => {
    expect(tier({ software: true, saveData: true, memoryGb: 1 })).toBe("still");
    expect(tier({ reducedMotion: true, software: null })).toBe("still");
  });
});

describe("forcing a tier", () => {
  it("reads full, light and still from the address", () => {
    expect(forcedTier("?tier=full")).toBe("full");
    expect(forcedTier("?debug&tier=light")).toBe("light");
    expect(forcedTier("?tier=still")).toBe("still");
  });

  it("ignores anything else", () => {
    expect(forcedTier("")).toBeNull();
    expect(forcedTier("?tier=ultra")).toBeNull();
    expect(forcedTier("?tier=")).toBeNull();
  });
});

describe("only getting lighter", () => {
  it("allows full to light, full to still and light to still", () => {
    expect(isLighter("light", "full")).toBe(true);
    expect(isLighter("still", "full")).toBe(true);
    expect(isLighter("still", "light")).toBe(true);
  });

  it("refuses an upgrade or the same tier", () => {
    expect(isLighter("full", "light")).toBe(false);
    expect(isLighter("light", "still")).toBe(false);
    expect(isLighter("full", "full")).toBe(false);
  });
});

describe("recognising software rendering", () => {
  it("knows the renderers that draw on the CPU", () => {
    expect(
      rendererIsSoftware("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))"),
    ).toBe(true);
    expect(rendererIsSoftware("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(rendererIsSoftware("Microsoft Basic Render Driver")).toBe(true);
  });

  it("does not take a GPU for software, and says so when it does not know", () => {
    expect(rendererIsSoftware("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)")).toBe(
      false,
    );
    expect(rendererIsSoftware("Apple M2")).toBe(false);
    expect(rendererIsSoftware(null)).toBeNull();
    expect(rendererIsSoftware("")).toBeNull();
  });
});
