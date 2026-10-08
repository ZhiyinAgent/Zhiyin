/**
 * Starts the drawing script as an Electron utility process: which process
 * draws pages, and how messages reach it. What it draws, and the containment
 * and timeouts around it, are the document viewer's (ADR 0018).
 */

import { utilityProcess } from "electron";
import type { Surroundings } from "./composition.js";

export function drawingProcesses(script: string): Surroundings["startDrawing"] {
  return async () => {
    const child = utilityProcess.fork(script, [], {
      serviceName: "Zhiyin document drawing",
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("exit", (code) =>
        reject(new Error(`The drawing process ended at once (${code}).`)),
      );
    });
    const { pid } = child;
    if (pid === undefined) throw new Error("The drawing process has no pid.");
    return {
      pid,
      send: (request) => child.postMessage(request),
      onReply: (listener) => child.on("message", (reply) => listener(reply)),
      onExit: (listener) => child.once("exit", () => listener()),
      kill: () => void child.kill(),
    };
  };
}
