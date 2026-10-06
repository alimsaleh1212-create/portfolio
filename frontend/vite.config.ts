import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * The built page's stylesheet goes inside the page instead of being a second request that
 * blocks the first paint, and the body font the text is set in is preloaded (its request
 * would otherwise wait for the stylesheet to be read). The result is the pre-render's
 * template, so every page it writes carries both. Build only: the dev server keeps its link.
 */
function inlineCriticalCss(): Plugin {
  return {
    name: "inline-critical-css",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const bundle = context.bundle;
        if (!bundle) return html;
        const link = /<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/;
        const match = link.exec(html);
        if (!match) return html;
        const name = match[1].replace(/^\//, "");
        const asset = bundle[name];
        if (!asset || asset.type !== "asset") return html;
        const css = String(asset.source);
        const font =
          /url\((\/assets\/geist-latin-wght-normal-[\w-]+\.woff2)\)/.exec(css);
        // The sheet is now part of the page; nothing else asks for the file.
        delete bundle[name];
        const preload = font
          ? `<link rel="preload" as="font" type="font/woff2" crossorigin href="${font[1]}">\n    `
          : "";
        return html.replace(
          link,
          () =>
            `${preload}<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
        );
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), inlineCriticalCss()],
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
