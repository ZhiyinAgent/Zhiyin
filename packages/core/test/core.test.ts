import { describe, expect, it } from "vitest";
import {
  CHANNEL,
  type AppEvent,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
import {
  Core,
  type CoreDependencies,
  type CoreWorkspace,
} from "../src/index.js";

const snapshot = (
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot =>
  ({
    runtime: { tasks: "available", capabilities: "available" },
    tasks: [],
    selectedTaskId: null,
    ...overrides,
  }) as WorkspaceSnapshot;

/**
 * A loop that answers plainly and writes down what reached it, in order, so a
 * test can see what the core asked of it and when.
 */
function recordingCore(
  overrides: Partial<CoreWorkspace> = {},
  dependencies: Partial<CoreDependencies> = {},
) {
  const happened: unknown[][] = [];
  const emitted: AppEvent[] = [];
  const note =
    (name: string, answer?: unknown) =>
    async (...args: unknown[]) => {
      happened.push([name, ...args]);
      return answer;
    };
  const loop = {
    initialize: note("initialize"),
    snapshot: () => snapshot(),
    emit: (event: AppEvent) => void emitted.push(event),
    settings: { current: () => ({ model: "a-model" }) },
    shutdown: note("shutdown"),
    selectWorkspace: note("selectWorkspace"),
    renameTask: note("renameTask"),
    turns: { cancel: note("cancel") },
    exportArtifact: async (
      taskId: string,
      path: string,
      choose: (name: string) => Promise<string | undefined>,
    ) => {
      happened.push(["exportArtifact", taskId, path, await choose("notes.md")]);
      return { status: "saved" };
    },
    ...overrides,
  } as unknown as CoreWorkspace;
  const core = new Core({
    workspace: loop,
    ownership: {
      claim: note("claim") as () => Promise<void>,
      release: note("release") as () => Promise<void>,
    },
    viewChecks: {
      answer: (...args) => void happened.push(["answerViewCheck", ...args]),
      abandon: () => void happened.push(["abandonViewChecks"]),
    },
    chooseFolder: async () => undefined,
    chooseSaveLocation: async (title, name) => `C:/saved/${title}/${name}`,
    version: "1.2.3",
    ...dependencies,
  });
  return { core, happened, emitted };
}

describe("a command from the window", () => {
  it("is refused without reaching the loop when its arguments are malformed", async () => {
    const { core, happened } = recordingCore();

    await expect(core.receive(CHANNEL.renameTask, ["task-1"])).rejects.toThrow(
      "This request is invalid.",
    );
    await expect(core.receive("zhiyin:not-a-command", [])).rejects.toThrow();
    expect(happened).toEqual([]);
  });

  it("reaches whoever answers it when its arguments are well formed", async () => {
    const { core, happened } = recordingCore();

    await core.receive(CHANNEL.interruptTask, ["task-1"]);
    await core.receive(CHANNEL.renameTask, ["task-1", "Plans"]);

    expect(happened).toEqual([
      ["cancel", "task-1"],
      ["renameTask", "task-1", "Plans"],
    ]);
  });

  it("turns a plugin on or off", async () => {
    const seen: unknown[] = [];
    const { core } = recordingCore({
      setPluginEnabled: async (id: string, enabled: boolean) => {
        seen.push([id, enabled]);
      },
    });

    await core.receive(CHANNEL.setPluginEnabled, [
      "software-engineering",
      false,
    ]);

    expect(seen).toEqual([["software-engineering", false]]);
  });

  it("asks for a folder and installs the plugin package chosen there", async () => {
    const seen: unknown[] = [];
    const { core } = recordingCore(
      {
        installPlugin: async (
          chooseSource: () => Promise<string | undefined>,
        ) => {
          seen.push(["installPlugin", await chooseSource()]);
          return { status: "applied" as const };
        },
      },
      { chooseFolder: async () => "C:/plugins/notes" },
    );

    const result = await core.receive(CHANNEL.installPlugin, []);

    expect(seen).toEqual([["installPlugin", "C:/plugins/notes"]]);
    expect(result).toEqual({ status: "applied" });
  });

  it("passes no folder to install when the person cancels the dialog", async () => {
    const seen: unknown[] = [];
    const { core } = recordingCore({
      installPlugin: async (
        chooseSource: () => Promise<string | undefined>,
      ) => {
        seen.push(["installPlugin", await chooseSource()]);
        return { status: "cancelled" as const };
      },
    });

    const result = await core.receive(CHANNEL.installPlugin, []);

    expect(seen).toEqual([["installPlugin", undefined]]);
    expect(result).toEqual({ status: "cancelled" });
  });

  it("asks for a folder and updates the named plugin with it", async () => {
    const seen: unknown[] = [];
    const { core } = recordingCore(
      {
        updatePlugin: async (
          id: string,
          chooseSource: () => Promise<string | undefined>,
        ) => {
          seen.push(["updatePlugin", id, await chooseSource()]);
          return { status: "applied" as const };
        },
      },
      { chooseFolder: async () => "C:/plugins/notes-2" },
    );

    const result = await core.receive(CHANNEL.updatePlugin, ["notes"]);

    expect(seen).toEqual([["updatePlugin", "notes", "C:/plugins/notes-2"]]);
    expect(result).toEqual({ status: "applied" });
  });

  it("rolls back and removes a plugin by id", async () => {
    const seen: unknown[] = [];
    const { core } = recordingCore({
      rollbackPlugin: async (id: string) => {
        seen.push(["rollbackPlugin", id]);
      },
      removePlugin: async (id: string) => {
        seen.push(["removePlugin", id]);
      },
    });

    await core.receive(CHANNEL.rollbackPlugin, ["notes"]);
    await core.receive(CHANNEL.removePlugin, ["notes"]);

    expect(seen).toEqual([
      ["rollbackPlugin", "notes"],
      ["removePlugin", "notes"],
    ]);
  });

  it("answers a view check through the view checks, not the loop", async () => {
    const { core, happened } = recordingCore();

    await core.receive(CHANNEL.answerViewCheck, ["check-1", { ok: true }]);

    expect(happened).toEqual([["answerViewCheck", "check-1", { ok: true }]]);
  });
});

describe("folders", () => {
  it("reopens only a folder that has been opened before", async () => {
    const { core, happened } = recordingCore({
      snapshot: () =>
        snapshot({ recentWorkspaces: [{ path: "C:/work", name: "work" }] }),
    });

    await expect(
      core.receive(CHANNEL.useRecentWorkspace, ["C:/somewhere-else"]),
    ).rejects.toThrow("That folder has not been opened before.");
    await core.receive(CHANNEL.useRecentWorkspace, ["C:/work"]);

    expect(happened).toEqual([["selectWorkspace", "C:/work"]]);
  });

  it("opens the folder a person chose, and nothing when they cancel", async () => {
    let chosen: string | undefined = undefined;
    const { core, happened } = recordingCore(
      {},
      { chooseFolder: async () => chosen },
    );

    await core.receive(CHANNEL.chooseWorkspace, []);
    chosen = "C:/picked";
    await core.chooseWorkspace();

    expect(happened).toEqual([["selectWorkspace", "C:/picked"]]);
  });
});

describe("saving a copy", () => {
  it("asks the person where to save, saying what is being saved", async () => {
    const { core, happened } = recordingCore();

    await core.receive(CHANNEL.exportArtifact, ["task-1", "notes.md"]);

    expect(happened).toEqual([
      ["exportArtifact", "task-1", "notes.md", "C:/saved/Save a copy/notes.md"],
    ]);
  });
});

describe("starting and stopping", () => {
  it("claims the saved data before starting the loop", async () => {
    const { core, happened } = recordingCore();

    core.start();
    await core.receive(CHANNEL.frontendReady, []);

    expect(happened).toEqual([["claim"], ["initialize"]]);
  });

  it("tells the window it is ready, with the workspace and provider settings", async () => {
    const { core, emitted } = recordingCore();

    core.start();
    await core.receive(CHANNEL.frontendReady, []);

    expect(emitted.map((event) => event.kind)).toEqual([
      "coreReady",
      "workspaceSnapshot",
      "providerSettingsChanged",
    ]);
    expect(emitted[0]).toEqual({
      kind: "coreReady",
      data: { version: "1.2.3" },
    });
  });

  it("leaves provider settings to arrive on their own when they are not yet known", async () => {
    const { core, emitted } = recordingCore({
      settings: {
        current: () => undefined,
      } as unknown as CoreWorkspace["settings"],
    });

    core.start();
    await core.receive(CHANNEL.frontendReady, []);

    expect(emitted.map((event) => event.kind)).toEqual([
      "coreReady",
      "workspaceSnapshot",
    ]);
  });

  it("tries starting again when the window arrives after startup failed", async () => {
    let attempts = 0;
    const { core, emitted } = recordingCore({
      initialize: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("The disk was not ready.");
      },
    });

    core.start();
    await core.receive(CHANNEL.frontendReady, []);

    expect(attempts).toBe(2);
    expect(emitted[0]?.kind).toBe("coreReady");
  });

  it("tries starting again when saved history could not be opened", async () => {
    let attempts = 0;
    const { core } = recordingCore({
      initialize: async () => {
        attempts += 1;
      },
      snapshot: () =>
        snapshot({
          runtime: {
            tasks: attempts < 2 ? "unavailable" : "available",
            capabilities: "available",
          },
        }),
    });

    core.start();
    await core.receive(CHANNEL.frontendReady, []);

    expect(attempts).toBe(2);
  });

  it("gives up the saved data only after the loop has stopped", async () => {
    const { core, happened } = recordingCore();

    await core.shutdown();

    expect(happened).toEqual([["shutdown"], ["release"]]);
  });

  it("abandons unanswered view checks when the window closes", () => {
    const { core, happened } = recordingCore();

    core.windowClosed();

    expect(happened).toEqual([["abandonViewChecks"]]);
  });
});
