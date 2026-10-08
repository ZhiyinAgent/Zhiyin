/**
 * What happens when a save fails.
 *
 * A change that spans two stores is the dangerous case: half of it lands, the
 * app keeps showing the whole of it, and the next launch reads a state nobody
 * chose. These tests inject the failure rather than waiting for a disk to do
 * it.
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import {
  loopFrom,
  pluginStore,
  pluginView,
  stubDependencies,
} from "./support.js";

const BUILT_IN = ["engineering", "publishing", "data-science", "research"];

function gate() {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release() };
}

/**
 * A pair of stores that outlive one launch, so a second launch reads exactly
 * what the first one managed to write.
 */
function durableStores() {
  const plugins = pluginStore(
    BUILT_IN.map((name) => pluginView({ name, enabled: false })),
    { failSwitch: (name) => failedSwitches.has(name) },
  );
  let saved: WorkspaceSnapshot | undefined;
  let failSavesAfter = Number.POSITIVE_INFINITY;
  let failedSwitches = new Set<string>();
  let saves = 0;

  return {
    enabledPlugins: () => plugins.enabledPlugins(),
    savedPreferences: () => saved?.preferences,
    savedTasks: () => saved?.tasks.map((task) => task.id) ?? [],
    failSavesAfter: (count: number) => {
      failSavesAfter = count;
    },
    failPluginSwitch: (...names: string[]) => {
      failedSwitches = new Set(names);
    },
    allowEverything: () => {
      failSavesAfter = Number.POSITIVE_INFINITY;
      failedSwitches = new Set();
    },
    launch() {
      const deps = stubDependencies(() => {});
      return loopFrom({
        ...deps,
        sessions: {
          ...deps.sessions,
          loadWorkspace: async () => saved,
          saveWorkspace: async (snapshot) => {
            saves += 1;
            if (saves > failSavesAfter)
              throw new Error("Task history could not be saved.");
            saved = snapshot;
          },
        },
        plugins,
      });
    },
  };
}

describe("AgentLoop onboarding across two stores", () => {
  it("enables no capability when the choice itself could not be saved", async () => {
    const stores = durableStores();
    const first = stores.launch();
    await first.initialize();
    stores.failSavesAfter(0);

    await expect(
      first.configureProfile(["publishing", "engineering"]),
    ).rejects.toThrow("Task history could not be saved.");

    expect(stores.enabledPlugins()).toEqual([]);
    expect(stores.savedPreferences()).toBeUndefined();
  });

  it("finishes an interrupted profile on the next launch instead of leaving capabilities the preferences never asked for", async () => {
    const stores = durableStores();
    const first = stores.launch();
    await first.initialize();
    stores.failPluginSwitch("engineering");

    await expect(
      first.configureProfile(["publishing", "engineering"]),
    ).rejects.toThrow();

    stores.allowEverything();
    const second = stores.launch();
    await second.initialize();

    expect(stores.enabledPlugins()).toEqual(["engineering", "publishing"]);
    expect(stores.savedPreferences()).toEqual({
      onboarded: true,
      interests: ["publishing", "engineering"],
    });
  });

  it("does not undo a plugin turned off after onboarding finished", async () => {
    const stores = durableStores();
    const first = stores.launch();
    await first.initialize();
    await first.configureProfile(["publishing", "engineering"]);
    await first.setPluginEnabled("engineering", false);

    const second = stores.launch();
    await second.initialize();

    expect(stores.enabledPlugins()).toEqual(["publishing"]);
  });

  it("says the profile is unsaved rather than showing it as chosen", async () => {
    const stores = durableStores();
    const loop = stores.launch();
    await loop.initialize();
    stores.failSavesAfter(0);

    await expect(loop.configureProfile(["publishing"])).rejects.toThrow();

    expect(loop.snapshot().preferences).toBeUndefined();
  });
});

describe("AgentLoop after a save that failed", () => {
  it("says the change is unsaved instead of showing it as recorded", async () => {
    const stores = durableStores();
    const loop = stores.launch();
    await loop.initialize();
    stores.failSavesAfter(0);

    await expect(loop.createTask()).rejects.toThrow();

    expect(
      loop
        .snapshot()
        .issues?.map((issue) => issue.message)
        .join(" "),
    ).toContain("could not be saved");
  });

  it("keeps the last committed state on disk when a later save fails", async () => {
    const stores = durableStores();
    const loop = stores.launch();
    await loop.initialize();
    await loop.createTask();
    const committed = stores.savedTasks();
    stores.failSavesAfter(0);

    await expect(loop.createTask()).rejects.toThrow();

    expect(stores.savedTasks()).toEqual(committed);
  });

  it("stops saying changes are unsaved once one is saved", async () => {
    const stores = durableStores();
    const loop = stores.launch();
    await loop.initialize();
    stores.failSavesAfter(0);
    await expect(loop.createTask()).rejects.toThrow();

    stores.allowEverything();
    await loop.createTask();

    expect(loop.snapshot().issues ?? []).toEqual([]);
  });
});

describe("AgentLoop durable turn ownership", () => {
  it("does not commit a held save after its turn is stopped", async () => {
    const held = gate();
    let sayStarted = () => {};
    const started = new Promise<void>((resolve) => {
      sayStarted = resolve;
    });
    let heldOnce = false;
    let saved: WorkspaceSnapshot | undefined;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: async (snapshot, options) => {
          const text = snapshot.tasks
            .flatMap((task) => task.messages)
            .map((message) => message.text)
            .join(" ");
          if (text.includes("Too late.") && !heldOnce) {
            heldOnce = true;
            sayStarted();
            await held.opened;
          }
          if (options?.commit?.() ?? true) saved = structuredClone(snapshot);
        },
      },
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "textDelta" as const, text: "Too late." };
          yield { kind: "done" as const };
        },
      },
    });
    await loop.initialize();
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Hold the final save");
    await started;
    const stopping = loop.cancel(taskId);
    held.release();
    await Promise.all([running, stopping]);

    expect(saved?.tasks[0]?.phase.kind).toBe("interrupted");
    expect(
      saved?.tasks[0]?.messages.map((message) => message.text).join(" "),
    ).not.toContain("Too late.");
  });
});
