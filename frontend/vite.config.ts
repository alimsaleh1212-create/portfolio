import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
