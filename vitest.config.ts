import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    // generated-app/ is a build artifact of the agent, not part of this project's suite. Without
    // this, a plain `npm test` at the repo root globs into it and fails: those tests are written
    // against their own project root, not this one. Spread the defaults rather than replacing
    // them — an `exclude` array overrides node_modules and dist otherwise.
    exclude: [...configDefaults.exclude, "generated-app/**"],
    environment: "jsdom",
    globals: true,
    // Absolute, resolved against this config's own directory. A relative path here resolves
    // against whichever project Vite decides is the root, which breaks when this app is copied
    // into a subdirectory of another Vite project — as the agent does when it generates into
    // generated-app/. Setting `root` does not fix it; the setup path itself must be absolute.
    setupFiles: [resolve(__dirname, "src/test-setup.ts")],
  },
});
