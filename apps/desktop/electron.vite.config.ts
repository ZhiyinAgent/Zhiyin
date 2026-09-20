import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { builtinModules } from "node:module";

const out = (name: string) => resolve(__dirname, "out", name);

/**
 * Workspace packages are TypeScript source, not built artifacts, so they must
 * be bundled rather than left as runtime requires. electron-vite externalizes
 * `dependencies` by default, which would leave `require("@zhiyin/...")` in the
 * output — fatal in a sandboxed preload, which has no module resolution at all.
 */
const external = [
  "electron",
  "@napi-rs/keyring",
  // Native bindings load from the packaged app's own node_modules; bundling
  // them would leave the .node file behind.
  "koffi",
  // Playwright ships its own browsers and binaries and is required at runtime;
  // bundling it produces a main process that cannot find either.
  "playwright-core",
  "@playwright/mcp",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig({
  main: {
    build: {
      outDir: out("main"),
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
        external,
      },
    },
  },
  preload: {
    build: {
      outDir: out("preload"),
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
        external,
        // A sandboxed preload runs in a restricted context with no ES module
        // loader, so this one is CommonJS regardless of the package type.
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: out("renderer"),
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
    plugins: [react()],
  },
});
