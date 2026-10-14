import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { builtinModules } from "node:module";
import type { Plugin } from "vite";

const out = (name: string) => resolve(__dirname, "out", name);

const packagesFolder = "/node_modules/";

/** The folder of the npm package a bundled module came from, if any. */
function packageFolderOf(id: string): string | undefined {
  const path = id.split("?")[0]!.replaceAll("\\", "/");
  const at = path.lastIndexOf(packagesFolder);
  if (id.startsWith("\0") || at < 0) return undefined;
  const [first, second] = path.slice(at + packagesFolder.length).split("/");
  if (!first) return undefined;
  const name = first.startsWith("@") && second ? `${first}/${second}` : first;
  return path.slice(0, at + packagesFolder.length) + name;
}

/** One package's notice: its name, version and licence, then its licence files. */
function noticeOf(folder: string): string {
  const manifest = JSON.parse(
    readFileSync(join(folder, "package.json"), "utf8"),
  ) as { name?: string; version?: string; license?: string };
  const texts = readdirSync(folder)
    .filter((name) => /^(licen[cs]e|copying|notice)/i.test(name))
    .sort()
    .map((name) => readFileSync(join(folder, name), "utf8").trim());
  const named = `${manifest.name ?? folder} ${manifest.version ?? ""}`.trim();
  return [
    manifest.license ? `${named} (${manifest.license})` : named,
    ...(texts.length
      ? texts
      : [
          `The package ships no licence file; its manifest names ${manifest.license ?? "none"}.`,
        ]),
  ].join("\n\n");
}

/**
 * Writes THIRD_PARTY_NOTICES.txt beside each built part of the app, with the
 * notice of every npm package whose code that part bundles. A bundle carries a
 * library's code without the folder its licence came in, and MIT, ISC and
 * similar licences ask for the notice to go with the code. A package left
 * external ships as its own folder, licence included.
 */
function bundledNotices(): Plugin {
  return {
    name: "zhiyin-bundled-notices",
    generateBundle(_options, bundle) {
      const folders = new Set<string>();
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const [id, module] of Object.entries(output.modules)) {
            const folder = packageFolderOf(id);
            if (folder && module.renderedLength > 0) folders.add(folder);
          }
      const notices = [...folders]
        .map(noticeOf)
        .sort((a, b) => a.localeCompare(b));
      if (!notices.length) return;
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_NOTICES.txt",
        source: [
          "This part of Zhiyin includes code from the packages below, each with its licence as the package gives it.",
          ...notices,
        ].join(`\n\n${"=".repeat(72)}\n\n`),
      });
    },
  };
}

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
        // The drawing process is started from its own script, and draws on a
        // thread started from another (ADR 0018).
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          drawing: resolve(__dirname, "src/drawing/index.ts"),
          "drawing-thread": resolve(__dirname, "src/drawing/drawing-thread.ts"),
        },
        external,
      },
    },
    plugins: [bundledNotices()],
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
    plugins: [bundledNotices()],
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: out("renderer"),
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
    plugins: [react(), bundledNotices()],
  },
});
