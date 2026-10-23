/**
 * Zhiyin quits while it waits for processes it started to end.
 *
 * The wait for them is held on a thread of its own. Electron's quit waits for
 * that thread, so a wait still held on the way out would keep Zhiyin from
 * quitting, which a test inside Node alone cannot show: Node's own exit does
 * not wait for it. So the real Electron runs a main process that quits with
 * eight such waits held.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { build } from "vite";
import { afterEach, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(
  new URL("./quit-while-waiting.entry.ts", import.meta.url),
);
// Beside the desktop package's own modules, where Electron finds koffi.
const bundled = join(desktop, "node_modules", ".quit-while-waiting");

let started: ChildProcess | undefined;
const folders = new TemporaryFolders();

afterEach(async () => {
  started?.kill();
  await folders.removeAll();
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it.runIf(process.platform === "win32")(
  "quits by itself while it waits for many processes it started to end",
  { timeout: 120_000 },
  async () => {
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        ssr: entry,
        outDir: bundled,
        emptyOutDir: true,
        target: "node22",
        rollupOptions: {
          external: ["electron", "koffi"],
          output: { format: "cjs", entryFileNames: "main.cjs" },
        },
      },
      ssr: { noExternal: true, external: ["electron", "koffi"] },
    });
    const directory = await folders.make("zhiyin-quit-");
    started = spawn(
      electron as unknown as string,
      [join(bundled, "main.cjs"), directory],
      { stdio: "ignore", windowsHide: true },
    );
    const code = await new Promise<number | null>((resolve) =>
      started?.once("exit", resolve),
    );
    const running = JSON.parse(
      await readFile(join(directory, "running.json"), "utf8"),
    ) as number[];

    expect(code).toBe(0);
    expect(running).toHaveLength(8);
    // Ended with it: they were contained, and Electron's quit closed them.
    await new Promise<void>((resolve) => {
      const look = () => (running.some(alive) ? setImmediate(look) : resolve());
      look();
    });
  },
);
