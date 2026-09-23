/**
 * Brings a window back when its page crashes.
 *
 * The core holds every conversation and all state, so the page is only a view
 * of it: loading it again loses nothing, and is better than a blank window.
 * A page that crashes every time it loads would be reloaded without end, so
 * after a few crashes in a short time it is left as it is.
 */

import type { EventEmitter } from "node:events";
import type { LogEntry } from "./diagnostic-log.js";

const crashesAllowed = 3;
const crashWindowMs = 60_000;

type Crashable = {
  readonly webContents: Pick<EventEmitter, "on">;
  isDestroyed(): boolean;
};

export function reloadAfterCrash(
  window: Crashable,
  load: (restarted: boolean) => void,
  log: { record(entry: LogEntry): void },
  now: () => number = Date.now,
): void {
  let recent: number[] = [];
  window.webContents.on(
    "render-process-gone",
    (_event: unknown, details: { reason: string; exitCode: number }) => {
      if (details.reason === "clean-exit") return;
      recent = [...recent.filter((at) => now() - at < crashWindowMs), now()];
      const reloading = recent.length <= crashesAllowed;
      log.record({
        level: "error",
        source: "window",
        message: `The window's page ended: ${details.reason}, exit code ${details.exitCode}. ${
          reloading
            ? "It was reloaded."
            : `It was not reloaded, having ended ${recent.length} times in a minute.`
        }`,
      });
      if (reloading && !window.isDestroyed()) load(true);
    },
  );
}
