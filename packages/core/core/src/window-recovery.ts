/**
 * Brings a window back when its page crashes.
 *
 * The core holds every conversation and all state, so the page is only a view
 * of it: loading it again loses nothing, and is better than a blank window.
 * A page that crashes every time it loads would be reloaded without end, so
 * after a few crashes in a short time the person is asked whether to open it
 * again or quit, rather than left looking at an empty window.
 */

import type { EventEmitter } from "node:events";
import type { LogEntry } from "./diagnostic-log.js";

const crashesAllowed = 3;
const crashWindowMs = 60_000;

type Crashable = {
  readonly webContents: Pick<EventEmitter, "on">;
  isDestroyed(): boolean;
};

export type CrashResponses = {
  load(restarted: boolean): void;
  /** Asked once crashes keep coming: true to open the window again. */
  stuck(notice: {
    readonly title: string;
    readonly detail: string;
  }): Promise<boolean>;
  quit(): void;
};

export function reloadAfterCrash(
  window: Crashable,
  respond: CrashResponses,
  log: { record(entry: LogEntry): void },
  now: () => number = Date.now,
): void {
  let recent: number[] = [];
  let asking = false;
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
      if (window.isDestroyed()) return;
      if (reloading) {
        respond.load(true);
        return;
      }
      if (asking) return;
      asking = true;
      void respond
        .stuck({
          title: "Zhiyin's window keeps closing",
          detail: `It stopped working ${recent.length} times in a minute, so it was not opened again. Your conversations are saved. Open it again, or quit Zhiyin and start it later.`,
        })
        .catch(() => false)
        .then((again) => {
          asking = false;
          if (!again) {
            respond.quit();
            return;
          }
          recent = [];
          if (!window.isDestroyed()) respond.load(true);
        });
    },
  );
}
