import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { projectMedia } from "../test/fixtures";
import { ProjectGallery } from "./ProjectGallery";

describe("ProjectGallery", () => {
  it("draws every picture with its alt text, sources and dimensions", () => {
    const { container } = render(<ProjectGallery media={projectMedia} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Gallery" }),
    ).toBeInTheDocument();
    for (const item of projectMedia) {
      const image = screen.getByRole("img", { name: item.alt! });
      expect(image).toHaveAttribute("width", "1280");
      expect(image).toHaveAttribute("height", "768");
      expect(image).toHaveAttribute(
        "src",
        expect.stringContaining("-w1280-jpeg"),
      );
    }
    expect(
      container.querySelectorAll("source[type='image/avif']"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll("source[type='image/webp']"),
    ).toHaveLength(2);
  });

  it.each([
    ["no list", undefined],
    ["an empty list", []],
    ["items with no usable image", [{ alt: null, variants: [] }]],
  ])("draws nothing at all for %s", (_name, media) => {
    const { container } = render(<ProjectGallery media={media} />);
    expect(container).toBeEmptyDOMElement();
  });
});
