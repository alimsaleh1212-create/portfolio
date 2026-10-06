import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { media, stillsItem } from "../test/fixtures";
import { answerWithContent, renderApp, stubApi } from "../test/render";
import { getClimb } from "../climb/climb";
import { lowerTier, resetTierForTests } from "../tier/tier";

// The 3D code is replaced by a stub that records that it was fetched. WebGL itself is not
// available in jsdom; what is tested here is when the scene is wanted and what the page does.
const loaded = vi.fn();
vi.mock("./SceneCanvas", () => {
  loaded();
  return {
    default: ({ onDrawn }: { onDrawn: () => void }) => {
      queueMicrotask(onDrawn);
      return <canvas data-testid="stub-canvas" />;
    },
  };
});

/** A device that can draw: WebGL 2 on a named GPU, with memory and cores to spare. */
function allowWebGl(yes: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    kind: string,
  ) =>
    yes && kind.startsWith("webgl")
      ? {
          getExtension: (name: string) =>
            name === "WEBGL_debug_renderer_info"
              ? { UNMASKED_RENDERER_WEBGL: 1 }
              : null,
          getParameter: () => "NVIDIA GeForce RTX 3060",
        }
      : null) as never);
  vi.stubGlobal("navigator", {
    ...window.navigator,
    deviceMemory: 8,
    hardwareConcurrency: 8,
  });
}

function reducedMotion(yes: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: yes && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  resetTierForTests();
  loaded.mockClear();
  vi.resetModules();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-scene");
  document.documentElement.removeAttribute("data-tier");
});

async function openClimb() {
  stubApi(answerWithContent);
  const view = renderApp("/");
  await screen.findByRole("heading", { level: 1, name: "Ali Saleh" });
  return view;
}

describe("the page without the scene", () => {
  it("renders all its text and mounts no canvas where WebGL is unavailable", async () => {
    allowWebGl(false);
    await openClimb();
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(
      screen.getAllByRole("heading", { level: 2 }).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      screen.getByRole("link", { name: "Begin the Climb" }),
    ).toBeInTheDocument();
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByTestId("scene")).toBeNull();
    // The still tier's backdrop stands where the canvas would have been.
    expect(document.documentElement.dataset.tier).toBe("still");
    expect(screen.getByTestId("still-backdrop")).toBeInTheDocument();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("mounts no canvas, and does not fetch the 3D code, where reduced motion is requested", async () => {
    allowWebGl(true);
    reducedMotion(true);
    await openClimb();
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(document.querySelector("canvas")).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.tier).toBe("still");
  });
});

describe("the page with the scene", () => {
  it("paints the text first, then fetches the 3D code, then tells the page the scene is drawn", async () => {
    allowWebGl(true);
    reducedMotion(false);
    await openClimb();
    // The text is on the page and the 3D code has not been asked for yet.
    expect(loaded).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();

    await waitFor(() => expect(loaded).toHaveBeenCalled());
    const layer = await screen.findByTestId("scene");
    // Hidden from assistive technology, and takes no pointer events.
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.className).toContain("fixed");
    await waitFor(() =>
      expect(document.documentElement.dataset.scene).toBe("on"),
    );
    expect(layer).toHaveAttribute("data-drawn");
    // The text is still ordinary page content.
    expect(
      screen.getByRole("heading", { level: 1, name: "Ali Saleh" }),
    ).toBeVisible();
  });

  it("takes the canvas and the page's mark with it when the Climb is left", async () => {
    allowWebGl(true);
    reducedMotion(false);
    const view = await openClimb();
    await waitFor(() =>
      expect(document.documentElement.dataset.scene).toBe("on"),
    );
    expect(getClimb().stages.length).toBeGreaterThan(0);
    view.unmount();
    expect(document.querySelector("canvas")).toBeNull();
    expect(document.documentElement.hasAttribute("data-scene")).toBe(false);
  });
});

async function openClimbWithStills() {
  stubApi((path) => answerWithContent(path, [...media, stillsItem]));
  const view = renderApp("/");
  await screen.findByRole("heading", { level: 1, name: "Ali Saleh" });
  return view;
}

describe("the still tier", () => {
  it("shows the opening picture behind the text and fetches no 3D code, even where WebGL works", async () => {
    allowWebGl(true);
    reducedMotion(false);
    window.history.replaceState(null, "", "/?tier=still");
    await openClimbWithStills();
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByTestId("scene")).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
    const backdrop = screen.getByTestId("still-backdrop");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop.className).toContain("fixed");
    expect(document.documentElement.dataset.scene).toBe("on");
    const first = backdrop.querySelector('[data-still="opening"] img');
    expect(first).toHaveAttribute("loading", "eager");
    expect(first).toHaveAttribute("width");
    expect(first).toHaveAttribute("height");
    // The pictures further up are not asked for until the Visitor is near them.
    expect(backdrop.querySelector('[data-still="summit"] img')).toBeNull();
    expect(backdrop.querySelector('[data-still="ridge"] img')).toBeNull();
  });

  it("keeps the page's own sky where there are no pictures", async () => {
    allowWebGl(true);
    reducedMotion(false);
    window.history.replaceState(null, "", "/?tier=still");
    await openClimb();
    const layer = screen
      .getByTestId("still-backdrop")
      .querySelector('[data-still="steep-switch"]');
    expect(layer?.className).toContain("bg-stage-steep-switch");
    expect(document.querySelectorAll("[data-still] img")).toHaveLength(0);
  });

  it("is what a device that cannot draw is served, with all the text", async () => {
    allowWebGl(false);
    await openClimbWithStills();
    expect(document.documentElement.dataset.tier).toBe("still");
    expect(
      screen.getAllByRole("heading", { level: 2 }).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("takes over when the full tier loses its context, and the scene goes", async () => {
    allowWebGl(true);
    reducedMotion(false);
    window.history.replaceState(null, "", "/?tier=full");
    await openClimbWithStills();
    await screen.findByTestId("scene");
    act(() => {
      lowerTier("still");
    });
    await waitFor(() => expect(screen.queryByTestId("scene")).toBeNull());
    expect(screen.getByTestId("still-backdrop")).toBeInTheDocument();
    expect(document.documentElement.dataset.scene).toBe("on");
  });
});

describe("the light tier", () => {
  it("draws the same scene, and a drop from full to light keeps the canvas", async () => {
    allowWebGl(true);
    reducedMotion(false);
    window.history.replaceState(null, "", "/?tier=full");
    await openClimbWithStills();
    const canvas = await screen.findByTestId("stub-canvas");
    act(() => {
      lowerTier("light");
    });
    expect(screen.getByTestId("stub-canvas")).toBe(canvas);
    expect(screen.queryByTestId("still-backdrop")).toBeNull();
  });
});
