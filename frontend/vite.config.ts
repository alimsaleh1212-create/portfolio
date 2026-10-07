import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Preload the body font. Its request otherwise waits for the stylesheet to be downloaded and
 * read; with the hint it starts with the page, so the text is set in its own face at first paint
 * and does not change shape a moment later. Build only; the result is the pre-render's template.
 */
function preloadBodyFont(): Plugin {
  return {
    name: "preload-body-font",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const bundle = context.bundle;
        const link =
          /<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/.exec(html);
        const asset = link && bundle?.[link[1].replace(/^\//, "")];
        if (!link || !asset || asset.type !== "asset") return html;
        const font =
          /url\((\/assets\/geist-latin-wght-normal-[\w-]+\.woff2)\)/.exec(
            String(asset.source),
          );
        if (!font) return html;
        return html.replace(
          link[0],
          () =>
            `<link rel="preload" as="font" type="font/woff2" crossorigin href="${font[1]}">\n    ${link[0]}`,
        );
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadBodyFont()],
  build: {
    // The 3D scene is its own download, fetched after the text has painted; it is the one
    // chunk expected to be large (three.js), so the default 500 kB warning does not apply to it.
    chunkSizeWarningLimit: 1000,
  },
  // The pre-render is one self-contained file (React and the rest are bundled in), so the job's
  // image needs Node and nothing else.
  ssr: { noExternal: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: false,
    // Playwright owns e2e/ (npm run e2e).
    exclude: [
      "e2e/**",
      "node_modules/**",
      "dist/**",
      "dist-prerender/**",
      "prerendered/**",
    ],
  },
});
