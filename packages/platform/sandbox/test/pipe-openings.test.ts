/**
 * Pipes a confined run's container may open, and ports of its container shown
 * on this computer, on real app containers: the program reaches Zhiyin
 * through the pipe named to it, a program in another container cannot, and a
 * server the program starts on its own loopback is reached from this
 * computer only through the port Zhiyin shows.
 */

import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  forgetConfinement,
  openProcessContainer,
  runProcess,
  windowsEnvironment,
  type LiveRun,
  type PipeOpening,
} from "../src/index.js";

const folders = new TemporaryFolders();
const kept = new TemporaryFolders();
const purpose = "test-openings";
const homes: string[] = [];
let programs = "";

beforeAll(async () => {
  programs = await kept.make("zhiyin-openings-programs-");
  await copyFile(process.execPath, join(programs, "node.exe"));
});
afterEach(async () => {
  for (const each of homes.splice(0)) forgetConfinement(purpose, each);
  await folders.removeAll();
});
afterAll(async () => {
  await kept.removeAll();
});

async function home(): Promise<string> {
  const made = await folders.make("zhiyin-openings-home-");
  homes.push(made);
  return made;
}

/** Runs `script` with Node, confined, in a home of its own. */
async function node(
  script: string,
  extra: {
    readonly arguments?: readonly string[];
    readonly openings?: readonly PipeOpening[];
    readonly shownPorts?: readonly number[];
    readonly onStart?: (live: LiveRun) => void;
    readonly signal?: AbortSignal;
  } = {},
) {
  return runProcess({
    executable: join(programs, "node.exe"),
    arguments: [
      "--preserve-symlinks-main",
      "--preserve-symlinks",
      "-e",
      script,
      ...(extra.arguments ?? []),
    ],
    cwd: programs,
    timeoutMs: 60_000,
    containment: { open: openProcessContainer },
    environment: windowsEnvironment(),
    confinement: {
      purpose,
      home: await home(),
      read: [programs],
      write: [],
      hosts: [],
    },
    ...(extra.openings ? { openings: extra.openings } : {}),
    ...(extra.shownPorts ? { shownPorts: extra.shownPorts } : {}),
    ...(extra.onStart ? { onStart: extra.onStart } : {}),
    ...(extra.signal ? { signal: extra.signal } : {}),
  });
}

/** Connects to the pipe the variable names, sends a word and prints the answer. */
const askThroughPipe = `
const net = require("net");
const socket = net.connect(process.env.ZHIYIN_TEST_PIPE);
socket.on("error", (error) => { console.log("refused " + error.code); });
socket.on("connect", () => socket.write("hello"));
socket.on("data", (data) => { console.log(String(data)); socket.end(); });
`;

/** Sends the pipe's own name through it, and prints the answer. */
const sendPipeName = askThroughPipe.replace(
  'socket.write("hello")',
  "socket.write(process.env.ZHIYIN_TEST_PIPE)",
);

/** Tries the pipe given as its argument, and prints whether it opened. */
const tryPipe = `
const net = require("net");
const socket = net.connect(process.argv[1]);
socket.on("error", (error) => { console.log("refused " + error.code); });
socket.on("connect", () => { console.log("opened"); socket.end(); });
`;

describe.runIf(process.platform === "win32")(
  "pipes and ports of a confined run",
  { timeout: 120_000 },
  () => {
    it("hands each connection the program makes through its pipe to the caller", async () => {
      const ran = await node(askThroughPipe, {
        openings: [
          {
            variable: "ZHIYIN_TEST_PIPE",
            accept: (connection: Socket) =>
              connection.once("data", (data) =>
                connection.end(String(data).toUpperCase()),
              ),
          },
        ],
      });
      expect(ran.exitCode).toBe(0);
      expect(ran.stdout.trim()).toBe("HELLO");
    });

    it("keeps a program in another container from opening the pipe", async () => {
      let other = "";
      const ran = await node(sendPipeName, {
        openings: [
          {
            variable: "ZHIYIN_TEST_PIPE",
            accept: (connection: Socket) =>
              connection.once("data", (name) => {
                // While the first run holds its pipe open, a run in another
                // container is handed its name and tries it.
                void node(tryPipe, { arguments: [String(name)] }).then(
                  (tried) => {
                    other = tried.stdout.trim();
                    connection.end("done");
                  },
                );
              }),
          },
        ],
      });
      expect(ran.stdout.trim()).toBe("done");
      expect(other).toMatch(/^refused E(ACCES|PERM)/);
    });

    it("shows a server the program starts on its own loopback at a port of this computer", async () => {
      const port = 40_000 + Math.floor(Math.random() * 10_000);
      const stop = new AbortController();
      let answer = "";
      let address = "";
      const ran = node(
        `require("http").createServer((q, s) => s.end("from the container")).listen(${port}, "127.0.0.1");
         setTimeout(() => process.exit(3), 50000);`,
        {
          shownPorts: [port],
          signal: stop.signal,
          onStart: (live) => {
            address = live.ports[0]?.address ?? "";
            void (async () => {
              for (let attempt = 0; attempt < 100 && !answer; attempt += 1) {
                try {
                  answer = await (await fetch(address)).text();
                } catch {
                  await new Promise((resolve) => setTimeout(resolve, 200));
                }
              }
              stop.abort();
            })();
          },
        },
      );
      await ran;
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(address).not.toBe(`http://127.0.0.1:${port}`);
      expect(answer).toBe("from the container");
    });

    it("refuses pipes and ports to a run that is not confined", async () => {
      const ran = await runProcess({
        executable: join(programs, "node.exe"),
        arguments: ["-e", "0"],
        cwd: programs,
        timeoutMs: 10_000,
        containment: { open: openProcessContainer },
        shownPorts: [3000],
      });
      expect(ran.failure).toBe("confinement");
    });
  },
);
