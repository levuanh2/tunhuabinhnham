import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "./src/test/setup.ts")],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // worker.ts imports the generated OpenNext bundle and the Workers runtime; tests use stand-ins.
      { find: /^\.\/\.open-next\/worker\.js$/, replacement: path.resolve(__dirname, "./src/test/open-next-worker.ts") },
      { find: "cloudflare:workers", replacement: path.resolve(__dirname, "./src/test/cloudflare-workers.ts") },
    ],
  },
});
