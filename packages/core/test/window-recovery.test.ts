import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { reloadAfterCrash, type LogEntry } from "../src/index.js";

/**
 * A window whose page crashed comes back rather than staying blank: the core
 * holds everything the page showed, so reloading it loses nothing. A page
 * that crashes again and again is not reloaded without end; the person is
 * asked instead, and is never left looking at an empty window.
 */

function crashingWindow(answer: () => Promise<boolean>) {
  let now = 0;
  const webContents = new EventEmitter();
  const loads: boolean[] = [];
  const entries: LogEntry[] = [];
  const asked: { title: string; detail: string }[] = [];
  let quit = false;
  reloadAfterCrash(
    { webContents, isDestroyed: () => false },
    {
      load: (restarted) => void loads.push(restarted),
      stuck: async (notice) => {
        asked.push(notice);
        return answer();
      },
      quit: () => {
        quit = true;
      },
    },
    { record: (entry) => void entries.push(entry) },
    () => now,
  );
  const crash = (reason = "crashed", after = 0) => {
    now += after;
    webContents.emit("render-process-gone", {}, { reason, exitCode: 1 });
  };
  return { crash, loads, entries, asked, quitted: () => quit };
}

const never = () => new Promise<boolean>(() => {});
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a window whose page crashed", () => {
  it("is loaded again, saying it restarted, and the crash is recorded", () => {
    const { crash, loads, entries } = crashingWindow(never);

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
    const { crash, loads } = crashingWindow(never);

    crash("clean-exit");

    expect(loads).toEqual([]);
  });

  it("stops being reloaded when it crashes again and again, and asks the person instead", () => {
    const { crash, loads, entries, asked } = crashingWindow(never);

    for (let time = 0; time < 5; time += 1) crash("crashed", 1_000);

    expect(loads).toHaveLength(3);
    expect(entries.at(-1)).toMatchObject({
      message: expect.stringContaining("not reloaded"),
    });
    expect(asked).toEqual([
      {
        title: "Zhiyin's window keeps closing",
        detail:
          "It stopped working 4 times in a minute, so it was not opened again. Your conversations are saved. Open it again, or quit Zhiyin and start it later.",
      },
    ]);
  });

  it("opens again, and keeps reloading after later crashes, when the person asks", async () => {
    const { crash, loads } = crashingWindow(async () => true);

    for (let time = 0; time < 4; time += 1) crash("crashed", 1_000);
    await settled();
    crash("crashed", 1_000);

    expect(loads).toEqual([true, true, true, true, true]);
  });

  it("quits when the person chooses to", async () => {
    const { crash, quitted } = crashingWindow(async () => false);

    for (let time = 0; time < 4; time += 1) crash("crashed", 1_000);
    await settled();

    expect(quitted()).toBe(true);
  });

  it("is reloaded again once a crash is long past", () => {
    const { crash, loads } = crashingWindow(never);

    for (let time = 0; time < 3; time += 1) crash("crashed", 1_000);
    crash("crashed", 120_000);

    expect(loads).toHaveLength(4);
  });
});
