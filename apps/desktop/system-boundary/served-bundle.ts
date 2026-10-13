/**
 * A part of the renderer, bundled for a browser and served beside a page that
 * drives it, so a test measures the production code in a real layout.
 *
 * The bundle is read once and served from memory: a file the page asks for
 * later, as a module that loads its parts on demand does, never waits on the
 * disk of a busy computer.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { URL } from "node:url";
import { build } from "vite";

const contentTypes: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
};

export type ServedBundle = {
  readonly url: string;
  /**
   * Runs a step in the page; if it fails, the error also says what the server
   * was asked for and how each request ended, so a file that did not arrive
   * shows whether the server sent it.
   */
  asking<T>(step: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export async function serveBundle(options: {
  /** The module to bundle, by its full path. */
  readonly entry: string;
  /** The name its bundle is served under. */
  readonly fileName: string;
  /** The page, given the paths of everything the bundle is made of. */
  readonly page: (built: readonly string[]) => string;
}): Promise<ServedBundle> {
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-served-bundle-"));
  await build({
    logLevel: "silent",
    // A library build leaves this for whoever bundles it next; a browser has
    // nobody after it.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    // The test runner's own mode would have components built for development.
    esbuild: { jsxDev: false },
    build: {
      outDir: directory,
      emptyOutDir: false,
      lib: {
        entry: options.entry,
        formats: ["es"],
        fileName: () => options.fileName,
      },
      // Left readable on purpose: when a test fails, the bundle it served is
      // the first thing worth looking at.
      minify: false,
    },
  });

  const files = new Map<string, Buffer>();
  for (const entry of await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    files.set(
      `/${file.slice(directory.length + 1).replaceAll("\\", "/")}`,
      await readFile(file),
    );
  }
  await rm(directory, { recursive: true, force: true });
  const page = Buffer.from(options.page([...files.keys()]));

  /** Every request and how it ended, oldest first. */
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const noted = requests.push(`${path}: asked`) - 1;
    const body = path === "/" ? page : files.get(path);
    // A browser asks for things nobody served, a favicon most reliably.
    const status = body ? 200 : 404;
    response.once("finish", () => (requests[noted] = `${path}: ${status}`));
    response.once("close", () => {
      if (!response.writableFinished)
        requests[noted] = `${path}: ${status}, closed before it was sent`;
    });
    response.writeHead(status, {
      "Content-Type":
        path === "/"
          ? "text/html"
          : (contentTypes[extname(path)] ?? "application/octet-stream"),
    });
    response.end(body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");

  return {
    url: `http://127.0.0.1:${address.port}/`,
    asking: async (step) => {
      const before = requests.length;
      try {
        return await step();
      } catch (error) {
        const during = requests.slice(before);
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nThe server during this step: ${during.join("; ") || "was asked for nothing"}.`,
          { cause: error },
        );
      }
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done, fail) => {
        if (!server.listening) return done();
        server.close((error) => (error ? fail(error) : done()));
      });
    },
  };
}
