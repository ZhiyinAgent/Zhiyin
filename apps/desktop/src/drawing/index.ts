/**
 * The contained process that draws document pages (ADR 0018). The
 * main process starts it as a utility process and puts it in its own job
 * before sending it anything. It is given nothing but a document's bytes, and
 * answers with PNGs of pages.
 *
 * The drawing itself runs on a Node worker thread in this process. pdf.js
 * takes any Electron process other than the main one for a web page, and
 * would draw there on browser paths that cannot work here; on a worker thread
 * it runs as Node, exactly as it does for `read_document`. This process only
 * carries messages, and goes when the thread does, so a failure is seen as
 * the process ending. The job's memory limit covers the thread.
 */

import { Worker } from "node:worker_threads";

const drawing = new Worker(new URL("./drawing-thread.js", import.meta.url));
const port = process.parentPort;

port.on("message", (event) => drawing.postMessage(event.data));
drawing.on("message", (reply) => port.postMessage(reply));
drawing.on("error", () => process.exit(1));
drawing.on("exit", () => process.exit(1));
