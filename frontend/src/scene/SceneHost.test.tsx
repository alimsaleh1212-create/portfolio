import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerWithContent, renderApp, stubApi } from "../test/render";
import { getClimb } from "../climb/climb";

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

function allowWebGl(yes: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    kind: string,
  ) =>
    yes && kind.startsWith("webgl")
      ? { getExtension: () => null }
      : null) as never);
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
  loaded.mockClear();
  vi.resetModules();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-scene");
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
    expect(document.documentElement.hasAttribute("data-scene")).toBe(false);
    expect(loaded).not.toHaveBeenCalled();
  });

  it("keeps the page's own ridgelines and Summit peak where no canvas mounts", async () => {
    allowWebGl(false);
    await openClimb();
    expect(document.querySelector(".ridgeline-far")).not.toBeNull();
    expect(document.querySelector(".peak")).not.toBeNull();
  });

  it("mounts no canvas, and does not fetch the 3D code, where reduced motion is requested", async () => {
    allowWebGl(true);
    reducedMotion(true);
    await openClimb();
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(document.querySelector("canvas")).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute("data-scene")).toBe(false);
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
