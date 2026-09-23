// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "./diagnostic-log.js";
import { reloadAfterCrash } from "./window-recovery.js";

/**
 * A window whose page crashed comes back rather than staying blank: the core
 * holds everything the page showed, so reloading it loses nothing.
 */

function crashingWindow(start = 0) {
  let now = start;
  const webContents = new EventEmitter();
  const loads: boolean[] = [];
  const entries: LogEntry[] = [];
  reloadAfterCrash(
    { webContents, isDestroyed: () => false },
    (restarted) => void loads.push(restarted),
    { record: (entry) => void entries.push(entry) },
    () => now,
  );
  const crash = (reason = "crashed", after = 0) => {
    now += after;
    webContents.emit("render-process-gone", {}, { reason, exitCode: 1 });
  };
  return { crash, loads, entries };
}

describe("a window whose page crashed", () => {
  it("is loaded again, saying it restarted, and the crash is recorded", () => {
    const { crash, loads, entries } = crashingWindow();

    crash("killed");

    expect(loads).toEqual([true]);
    expect(entries).toMatchObject([
      {
        level: "error",
        source: "window",
        message: expect.stringContaining("killed"),
      },
    ]);
  });

  it("is left alone when its page ended on purpose", () => {
    const { crash, loads } = crashingWindow();

    crash("clean-exit");

    expect(loads).toEqual([]);
  });

  it("stops being reloaded when it crashes again and again", () => {
    const { crash, loads, entries } = crashingWindow();

    for (let time = 0; time < 5; time += 1) crash("crashed", 1_000);

    expect(loads).toHaveLength(3);
    expect(entries.at(-1)).toMatchObject({
      message: expect.stringContaining("not reloaded"),
    });
  });

  it("is reloaded again once a crash is long past", () => {
    const { crash, loads } = crashingWindow();

    for (let time = 0; time < 3; time += 1) crash("crashed", 1_000);
    crash("crashed", 120_000);

    expect(loads).toHaveLength(4);
  });
});
