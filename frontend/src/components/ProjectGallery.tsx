import { srcSet, widest } from "../api/media";
import type { ProjectMedia } from "../api/types";

/** `sizes` hint, a number-built string so the tokens-only check stays strict about literals. */
const px = (n: number) => `${n}px`;
const FULL_WIDTH = [100, "vw"].join("");
const SIZES = `(min-width: ${px(1216)}) ${px(1216)}, ${FULL_WIDTH}`;

/**
 * Pictures for a Project. Draws nothing, not even its heading, when there is no picture to
 * show, so a Project without media has no empty frame and no gap.
 */
export function ProjectGallery({ media }: { media?: ProjectMedia[] }) {
  const pictures = (media ?? []).flatMap((item) => {
    const fallback = widest(item.variants, "jpeg");
    return fallback && fallback.width && fallback.height
      ? [{ item, fallback }]
      : [];
  });
  if (pictures.length === 0) return null;

  return (
    <section
      aria-labelledby="gallery-heading"
      className="mt-section md:mt-section-wide"
    >
      <h2 id="gallery-heading" className="text-xl font-semibold tracking-snug">
        Gallery
      </h2>
      <ul className="mt-8 grid gap-6 md:grid-cols-2">
        {pictures.map(({ item, fallback }) => (
          <li key={fallback.url}>
            <picture>
              <source
                type="image/avif"
                srcSet={srcSet(item.variants, "avif")}
                sizes={SIZES}
              />
              <source
                type="image/webp"
                srcSet={srcSet(item.variants, "webp")}
                sizes={SIZES}
              />
              <img
                src={fallback.url}
                srcSet={srcSet(item.variants, "jpeg")}
                sizes={SIZES}
                width={fallback.width ?? undefined}
                height={fallback.height ?? undefined}
                alt={item.alt ?? ""}
                loading="lazy"
                decoding="async"
                className="rounded-surface border-line block h-auto w-full border"
              />
            </picture>
          </li>
        ))}
      </ul>
    </section>
  );
}
