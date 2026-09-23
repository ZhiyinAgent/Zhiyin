/**
 * Quitting always finishes. A browser or a connection that never finishes
 * closing must not keep the app alive, invisibly, holding the data folder so
 * that the next launch is told another copy is running.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies } from "./support.js";

afterEach(() => {
  vi.useRealTimers();
});

function coreWith(shutdownAll: () => Promise<void>) {
  const dependencies = stubDependencies(() => {});
  const released: string[] = [];
  const core = new Core({
    workspace: loopFrom({
      ...dependencies,
      mcp: { ...dependencies.mcp, shutdownAll },
    }),
    ownership: {
      claim: async () => {},
      release: async () => void released.push("released"),
    },
    viewChecks: { answer: () => {}, abandon: () => {} },
    chooseFolder: async () => undefined,
    chooseSaveLocation: async () => undefined,
    openExternal: async () => {},
    version: "1.0.0",
  });
  return { core, released };
}

describe("quitting", () => {
  it("gives the data folder up after five seconds, and names what never closed", async () => {
    vi.useFakeTimers();
    const { core, released } = coreWith(() => new Promise<void>(() => {}));

    let unfinished: readonly string[] | undefined;
    void core.shutdown().then((names) => {
      unfinished = names;
    });
    await vi.advanceTimersByTimeAsync(4_900);
    expect(unfinished).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);

    expect(unfinished).toEqual(["browsers and connections"]);
    expect(released).toEqual(["released"]);
  });

  it("does not wait at all when everything closes", async () => {
    vi.useFakeTimers();
    const { core, released } = coreWith(async () => {});

    await expect(core.shutdown()).resolves.toEqual([]);
    expect(released).toEqual(["released"]);
  });
});
