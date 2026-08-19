import { defineConfig } from "vitest/config";
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
    environment: "jsdom",
    globals: true,
    // Absolute, resolved against this config's own directory. A relative path here resolves
    // against whichever project Vite decides is the root, which breaks when this app is copied
    // into a subdirectory of another Vite project — as the agent does when it generates into
    // generated-app/. Setting `root` does not fix it; the setup path itself must be absolute.
    setupFiles: [resolve(__dirname, "src/test-setup.ts")],
  },
});
