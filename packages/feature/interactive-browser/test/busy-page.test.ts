/**
 * The watch that keeps a call from waiting for ever on a page whose script
 * never yields, against a page that stands in for one: it answers only while
 * its script is not running, and a stop ends the script.
 */
import { describe, expect, it } from "vitest";
import { BusyPageWatch } from "../src/busy-page.js";

const bound = 30;

/** A page whose script runs until stopped, or for ever when it cannot be. */
function page(state: {
  spinning?: boolean;
  stoppable?: boolean;
  asking?: boolean;
}) {
  const held = new Set<() => void>();
  const waiting = new Set<() => void>();
  let stops = 0;
  return {
    stops: () => stops,
    watched: {
      answers: () =>
        state.spinning || state.asking
          ? new Promise<void>((resolve) => waiting.add(resolve))
          : Promise.resolve(),
      stop: async () => {
        stops += 1;
        if (state.stoppable === false) return;
        state.spinning = false;
        for (const answer of waiting) answer();
        waiting.clear();
        for (const go of held) go();
      },
      asking: () => state.asking === true,
    },
    /** Work that ends once the page's script no longer runs. */
    work: () =>
      new Promise<string>((resolve) => {
        if (!state.spinning) resolve("done");
        else held.add(() => resolve("done"));
      }),
  };
}

describe("a call on a page whose script never yields", () => {
  it("goes on once the script that held the page past the bound is stopped, and says so once", async () => {
    const spinning = page({ spinning: true });
    const watch = new BusyPageWatch(spinning.watched, bound);

    await expect(watch.during(spinning.work)).resolves.toBe("done");

    expect(spinning.stops()).toBe(1);
    expect(watch.takeStopped()).toBe(
      "its script kept the page busy for 1 s without yielding, so Zhiyin stopped it",
    );
    expect(watch.takeStopped()).toBeUndefined();
  });

  it("never stops a page that answers, however long the call takes", async () => {
    const calm = page({});
    const watch = new BusyPageWatch(calm.watched, bound);

    await watch.during(
      () => new Promise((resolve) => setTimeout(resolve, bound * 5)),
    );

    expect(calm.stops()).toBe(0);
    expect(watch.takeStopped()).toBeUndefined();
  });

  it("stops once for calls made at once, or one inside another", async () => {
    const spinning = page({ spinning: true });
    const watch = new BusyPageWatch(spinning.watched, bound);

    await Promise.all([
      watch.during(spinning.work),
      watch.during(() => watch.during(spinning.work)),
    ]);

    expect(spinning.stops()).toBe(1);
  });

  it("ends the call when the page still does not answer once stopped", async () => {
    const stuck = page({ spinning: true, stoppable: false });
    const watch = new BusyPageWatch(stuck.watched, bound);

    await expect(watch.during(stuck.work)).rejects.toThrow(
      "The page does not answer: its script kept the page busy for 1 s without yielding, so Zhiyin stopped it, and it still does not answer.",
    );
    expect(stuck.stops()).toBe(1);
  });

  it("leaves the script behind a dialog running, and ends the call saying the dialog waits", async () => {
    const asking = page({ asking: true });
    const watch = new BusyPageWatch(asking.watched, bound);

    await expect(
      watch.during(() => new Promise(() => undefined)),
    ).rejects.toThrow(
      "The page is waiting on its dialog: answer it with browser_handle_dialog.",
    );
    expect(asking.stops()).toBe(0);
    expect(watch.takeStopped()).toBeUndefined();
  });
});
