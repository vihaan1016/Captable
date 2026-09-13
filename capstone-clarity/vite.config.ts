// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * The indexer URL falls back to http://localhost:8080 and that fallback is baked
 * into the production bundle, so every visitor's browser silently fetches their
 * own machine. Fail the build loudly instead of shipping that.
 */
function requireIndexerApi(): Plugin {
  return {
    name: "require-indexer-api",
    apply: "build",
    configResolved(config) {
      if (config.mode === "production" && !process.env["VITE_INDEXER_API"]) {
        throw new Error("VITE_INDEXER_API must be set for a production build");
      }
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [requireIndexerApi()],
  },
});
