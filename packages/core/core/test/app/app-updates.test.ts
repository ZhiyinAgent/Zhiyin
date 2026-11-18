/**
 * Restarting into an update, as the window asks for it (ADR 0027). The core
 * refuses while a conversation is working, since restarting would end its
 * turn; otherwise the update is measured once more and Zhiyin quits so it
 * installs. What the updates feature says reaches the window as it changes.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  CHANNEL,
  type AppEvent,
  type AppUpdatePhase,
  type AppUpdateState,
} from "@zhiyin/contract";
import { Core, type CoreUpdates } from "../../src/index.js";
import { loopFrom, stubDependencies, until } from "./support.js";

let release: (() => void) | undefined;
afterEach(() => release?.());

/** The updates feature as the core sees it, with an update ready. */
function updatesReady() {
  const listeners: ((state: AppUpdateState) => void)[] = [];
  let phase: AppUpdatePhase = { kind: "ready", version: "0.1.0-alpha.2" };
  let installable = true;
  const state = (): AppUpdateState => ({
    version: "0.1.0-alpha.1",
    checks: true,
    phase,
  });
  const updates: CoreUpdates = {
    state,
    onChanged: (listener) => void listeners.push(listener),
    check: async () => state(),
    setChecks: async () => state(),
    prepareRestart: async () => {
      if (!installable)
        throw new Error(
          "The downloaded installer is not the one the release's signature names.",
        );
      phase = { kind: "restarting", version: "0.1.0-alpha.2" };
      for (const listener of listeners) listener(state());
    },
    stop: () => {},
  };
  return {
    updates,
    spoil: () => {
      installable = false;
    },
  };
}

function setUp() {
  const events: AppEvent[] = [];
  const restarts: string[] = [];
  const dependencies = stubDependencies((event) => void events.push(event));
  // The model answers only when the test lets it, so a turn can be held open.
  const answering = new Promise<void>((done) => {
    release = done;
  });
  const workspace = loopFrom({
    ...dependencies,
    revealDelayMs: 0,
    model: {
      ...dependencies.model,
      send: async function* () {
        await answering;
        yield { kind: "textDelta" as const, text: "Done." };
        yield { kind: "done" as const };
      },
    },
  });
  const ready = updatesReady();
  const core = new Core({
    workspace,
    dataFolder: "C:/data",
    ownership: { claim: async () => {}, release: async () => {} },
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
    openPath: async () => {},
    showInFolder: async () => {},
    version: "0.1.0-alpha.1",
    updates: ready.updates,
    restartToUpdate: () => void restarts.push("restarted"),
  });
  return { core, workspace, events, restarts, spoil: ready.spoil };
}

describe("restarting into an update", () => {
  it("restarts when no conversation is working, and tells the window", async () => {
    const { core, events, restarts } = setUp();

    await core.receive(CHANNEL.restartToUpdate, []);

    expect(restarts).toEqual(["restarted"]);
    expect(events).toContainEqual({
      kind: "appUpdateChanged",
      data: {
        version: "0.1.0-alpha.1",
        checks: true,
        phase: { kind: "restarting", version: "0.1.0-alpha.2" },
      },
    });
  });

  it("refuses while a conversation is working, and restarts once it has finished", async () => {
    const { core, workspace, restarts } = setUp();
    await workspace.initialize();
    const taskId = await workspace.createTask();
    await core.receive(CHANNEL.sendMessage, [taskId, "Tidy the report"]);
    const conversation = () => workspace.snapshot().tasks[0];
    await until(() => conversation()?.phase.kind === "working");

    await expect(core.receive(CHANNEL.restartToUpdate, [])).rejects.toThrow(
      "A conversation is still working. Zhiyin can restart once it has finished or been stopped.",
    );
    expect(restarts).toEqual([]);

    release?.();
    await until(() => conversation()?.phase.kind === "completed");
    await core.receive(CHANNEL.restartToUpdate, []);
    expect(restarts).toEqual(["restarted"]);
  });

  it("does not restart when the update can no longer be installed", async () => {
    const { core, restarts, spoil } = setUp();
    spoil();

    await expect(core.receive(CHANNEL.restartToUpdate, [])).rejects.toThrow(
      "The downloaded installer is not the one the release's signature names.",
    );
    expect(restarts).toEqual([]);
  });

  it("says plainly when this copy does not update itself", async () => {
    const dependencies = stubDependencies(() => {});
    const core = new Core({
      workspace: loopFrom(dependencies),
      dataFolder: "C:/data",
      ownership: { claim: async () => {}, release: async () => {} },
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
      openPath: async () => {},
      showInFolder: async () => {},
      version: "0.1.0-alpha.1",
    });

    await expect(core.receive(CHANNEL.appUpdate, [])).rejects.toThrow(
      "This copy of Zhiyin does not update itself.",
    );
  });
});
