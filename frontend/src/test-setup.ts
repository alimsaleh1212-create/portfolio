import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom does not implement scrolling.
window.scrollTo = () => {};

// jsdom does not implement matchMedia; nothing matches, so the large-screen choices apply.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

// Nor does it scroll an element into view.
Element.prototype.scrollIntoView ??= () => {};

// Nor does it have WebGL: a canvas yields no context, as in a browser with WebGL off.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
