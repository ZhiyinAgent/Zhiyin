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

function coreWith(
  shutdownAll: () => Promise<void>,
  closeUndo: () => Promise<void> = async () => {},
) {
  const dependencies = stubDependencies(() => {});
  const released: string[] = [];
  const core = new Core({
    undo: {
      undoBudget: async () => ({ budgetBytes: 0, usedBytes: 0, chosen: false }),
      setUndoBudget: async () => ({
        budgetBytes: 0,
        usedBytes: 0,
        chosen: false,
      }),
      close: async () => {
        released.push("files watched for going back");
        await closeUndo();
      },
    },
    workspace: loopFrom({
      ...dependencies,
      mcp: { ...dependencies.mcp, shutdownAll },
    }),
    dataFolder: "C:/data",
    openPath: async () => {},
    showInFolder: async () => {},
    ownership: {
      claim: async () => {},
      release: async () => void released.push("released"),
    },
    viewChecks: { answer: () => {}, abandon: () => {} },
    commands: {
      shellAvailability: () => ({ available: true }),
      recheckShell: () => ({ available: true }),
      runningCommands: () => [],
      commandOutput: async () => undefined,
      stopCommandForPerson: async () => {},
      onCommandsChanged: () => {},
    },
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
    expect(released).toEqual(["files watched for going back", "released"]);
  });

  it("does not wait at all when everything closes", async () => {
    vi.useFakeTimers();
    const { core, released } = coreWith(async () => {});

    await expect(core.shutdown()).resolves.toEqual([]);
    expect(released).toEqual(["files watched for going back", "released"]);
  });

  it("lets go of the files watched for going back, giving up on them after five seconds", async () => {
    vi.useFakeTimers();
    const { core, released } = coreWith(
      async () => {},
      () => new Promise<void>(() => {}),
    );

    let unfinished: readonly string[] | undefined;
    void core.shutdown().then((names) => {
      unfinished = names;
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(unfinished).toEqual(["files watched for going back"]);
    expect(released).toEqual(["files watched for going back", "released"]);
  });
});
