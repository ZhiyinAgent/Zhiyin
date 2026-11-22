/** The watch thread started from this package's source, for tests. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { WatchThread, WatchThreadData } from "./file-watch.js";

/**
 * Starts the watch thread from this package's source, which Node runs as it
 * is. The app starts the copy it was built with instead.
 */
export function sourceWatchThread(data: WatchThreadData): WatchThread {
  const source = join(
    dirname(fileURLToPath(import.meta.url)),
    "watch-thread.ts",
  );
  return new Worker(source, { workerData: data });
}
