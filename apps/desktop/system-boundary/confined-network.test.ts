/**
 * A confined run that names hosts, from a real Electron main process: the
 * proxy, its pipe and the pipe's permissions run in Electron, as in the app,
 * which a test inside Node alone cannot show. The computer's proxy is a
 * stand-in that answers for every host, so nothing reaches the internet.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { build } from "vite";
import { afterEach, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(
  new URL("./confined-network.entry.ts", import.meta.url),
);
// Beside the desktop package's own modules, where Electron finds koffi.
const bundled = join(desktop, "node_modules", ".confined-network");

/** Run in the container: a tunnel through HTTPS_PROXY to each host, then a word. */
const program = `"use strict";
const net = require("node:net");
const proxy = new URL(process.env.HTTPS_PROXY);
const tunnel = (host) => new Promise((resolve) => {
  const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) });
  socket.once("error", (error) => resolve(error.code));
  let opened = "";
  socket.once("connect", () => socket.write("CONNECT " + host + ":443 HTTP/1.1\\r\\n\\r\\n"));
  socket.on("data", (chunk) => {
    if (!opened) {
      opened = String(chunk).split("\\r\\n")[0];
      if (!opened.includes(" 200 ")) { socket.destroy(); return resolve(opened); }
      return socket.write("hello");
    }
    socket.destroy();
    resolve(opened + " | " + chunk);
  });
});
(async () => {
  process.stdout.write(JSON.stringify([await tunnel("pypi.org"), await tunnel("example.com")]));
})();
`;

let started: ChildProcess | undefined;
let upstream: Server | undefined;
const folders = new TemporaryFolders();

afterEach(async () => {
  started?.kill();
  await new Promise<void>((resolve) =>
    upstream ? upstream.close(() => resolve()) : resolve(),
  );
  await folders.removeAll();
});

/** A stand-in for the computer's HTTP proxy: it opens every tunnel and echoes. */
async function standInProxy(): Promise<number> {
  upstream = createServer((socket) => {
    socket.on("error", () => socket.destroy());
    socket.once("data", (chunk) => {
      const target = String(chunk).split(" ")[1];
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.on("data", (words) => socket.write(`${target} heard ${words}`));
    });
  });
  await new Promise<void>((resolve) =>
    upstream?.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

it.runIf(process.platform === "win32")(
  "reaches a named host through Zhiyin's proxy in Electron, and is refused another",
  { timeout: 180_000 },
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
    const directory = await folders.make("zhiyin-electron-network-");
    const scripts = await folders.make("zhiyin-electron-network-script-");
    const script = join(scripts, "tunnel.cjs");
    await writeFile(script, program);
    const port = await standInProxy();
    started = spawn(
      electron as unknown as string,
      [join(bundled, "main.cjs"), directory, String(port), script],
      { stdio: "ignore", windowsHide: true },
    );
    await new Promise((resolve) => started?.once("exit", resolve));
    const ran = JSON.parse(
      await readFile(join(directory, "ran.json"), "utf8"),
    ) as {
      exitCode: number | null;
      stdout: string;
      reason?: string;
      network?: { host: string; refused?: string }[];
    };

    expect(ran.reason).toBeUndefined();
    expect(ran.exitCode).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual([
      "HTTP/1.1 200 Connection established | pypi.org:443 heard hello",
      "HTTP/1.1 403 example.com:443 refused",
    ]);
    expect(ran.network?.map(({ host, refused }) => [host, refused])).toEqual([
      ["pypi.org", undefined],
      ["example.com", "not among the hosts this run may reach"],
    ]);
  },
);
