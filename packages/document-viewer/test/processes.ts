/**
 * Drawing processes for tests: real Node processes for the paths only a real
 * process can show — a hang, a crash, memory past its limit — and the service
 * itself, in this process, for everything that is about drawing.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProcessContainer } from "@zhiyin/process-ownership";
import {
  serveDrawing,
  type DrawingContainment,
  type DrawingProcess,
  type DrawingReply,
  type DrawingRequest,
} from "../src/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** A Node process running one of the fixtures, spoken to over its IPC channel. */
export async function fixtureProcess(name: string): Promise<DrawingProcess> {
  const child = spawn(process.execPath, [join(fixtures, name)], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    serialization: "advanced",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (child.pid === undefined) throw new Error("no pid");
  return {
    pid: child.pid,
    send: (request) => child.send(request),
    onReply: (listener) =>
      child.on("message", (reply) => listener(reply as DrawingReply)),
    onExit: (listener) => child.once("exit", () => listener()),
    kill: () => child.kill(),
  };
}

/** The real service, in this process; there is nothing here to contain. */
export async function serviceProcess(): Promise<DrawingProcess> {
  let deliver: ((request: DrawingRequest) => void) | undefined;
  const listeners: ((reply: DrawingReply) => void)[] = [];
  serveDrawing({
    receive: (handler) => {
      deliver = handler;
    },
    send: (reply) => {
      const copy = structuredClone(reply);
      for (const listener of listeners) listener(copy);
    },
  });
  return {
    pid: process.pid,
    send: (request) => deliver?.(structuredClone(request)),
    onReply: (listener) => listeners.push(listener),
    onExit: () => undefined,
    kill: () => undefined,
  };
}

/**
 * Real containment for a real process; none for the service in this one,
 * which a container closing would take the test runner down with.
 */
export const containment: DrawingContainment = {
  open: (options) => {
    let container: ReturnType<typeof openProcessContainer> | undefined;
    return {
      contain: (pid) => {
        if (pid === process.pid) return;
        container = openProcessContainer(options);
        container.contain(pid);
      },
      close: () => container?.close(),
    };
  },
};

/** Asks the operating system, not our own bookkeeping, whether a pid is alive. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}
