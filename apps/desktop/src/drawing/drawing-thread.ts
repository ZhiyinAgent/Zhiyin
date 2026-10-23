/**
 * The worker thread that draws, inside the drawing process (ADR 0023). It
 * runs the document viewer's drawing service and nothing else.
 */

import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";
import { serveDrawing, type DrawingRequest } from "@zhiyin/document-viewer";
import fonts from "../../fonts.json";

// pdf.js reads an Electron process type as a web page; this thread has none,
// which is why the drawing runs here. Should Electron ever give it one, the
// thread stops rather than draw on paths that cannot work.
if (process.type !== undefined)
  throw new Error(`The drawing thread runs as Electron's ${process.type}.`);
if (!parentPort) throw new Error("The drawing thread has no parent.");
const port = parentPort;

serveDrawing(
  {
    receive: (handler) =>
      port.on("message", (request: DrawingRequest) => handler(request)),
    send: (reply) => port.postMessage(reply),
  },
  {
    // This script runs two folders down from the app's root, where the build
    // fetches the font and packing keeps it in the archive (ADR 0024).
    fallbackFont: fileURLToPath(
      new URL(`../../fonts/${fonts.fallback.file}`, import.meta.url),
    ),
  },
);
