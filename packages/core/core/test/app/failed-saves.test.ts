/**
 * A save that fails ends one way, whatever changed: the change stays on
 * screen and in effect, the window says it is not yet stored, the last saved
 * state stays on disk, and the next save that succeeds stores it.
 */

import type { SavedWorkspace } from "@zhiyin/session";
import type { Appearance } from "@zhiyin/contract";
import { describe, expect, it } from "vitest";
import {
  loopFrom,
  pluginStore,
  pluginView,
  stubDependencies,
} from "./support.js";

const notStored = "Recent changes could not be saved.";

function withDisk() {
  let disk: SavedWorkspace | undefined;
  let failing = false;
  const painted: Appearance[] = [];
  const roots = new Map<string, string>();
  const plugins = pluginStore(
    ["engineering", "publishing"].map((name) =>
      pluginView({ name, enabled: false }),
    ),
  );
  const deps = stubDependencies(() => {});
  const app = loopFrom({
    ...deps,
    sessions: {
      ...deps.sessions,
      loadWorkspace: async () => disk,
      saveWorkspace: async (snapshot: SavedWorkspace) => {
        if (failing) throw new Error("The disk is full.");
        disk = structuredClone(snapshot);
      },
    },
    workspace: {
      ...deps.workspace,
      workspaceRoot: (id: string | undefined) =>
        id === undefined ? undefined : roots.get(id),
      enterFolder: async (id: string, path: string) => {
        roots.set(id, path);
        return path.split("/").at(-1) ?? path;
      },
      checkFolder: async (path: string) => path.split("/").at(-1) ?? path,
      leaveFolder: (id: string) => {
        roots.delete(id);
      },
    },
    appearance: { apply: (choice) => painted.push(choice) },
    plugins,
    newTaskId: () => `task-${Math.random()}`,
  });
  return {
    app,
    painted,
    disk: () => disk,
    toolRoot: (id: string) => roots.get(id),
    enabledPlugins: () => plugins.enabledPlugins(),
    fail: () => {
      failing = true;
    },
    recover: () => {
      failing = false;
    },
    told: () => app.snapshot().issues?.map((issue) => issue.message) ?? [],
  };
}

describe("a save that fails", () => {
  it("keeps a renamed conversation renamed on screen, says it is not stored, and stores it with the next change", async () => {
    const world = withDisk();
    await world.app.initialize();
    const id = await world.app.createTask();
    world.fail();

    await expect(world.app.renameTask(id, "Quarterly report")).rejects.toThrow(
      "The disk is full.",
    );

    expect(world.app.snapshot().conversations?.[0]?.title).toBe(
      "Quarterly report",
    );
    expect(world.told()).toContainEqual(expect.stringContaining(notStored));
    expect(world.disk()?.tasks[0]?.title).toBe("New conversation");

    world.recover();
    await world.app.setContextBudget(id, "ultra");

    expect(world.disk()?.tasks[0]?.title).toBe("Quarterly report");
    expect(world.told().join(" ")).not.toContain(notStored);
  });

  it("keeps a setting in effect, the window painted as the snapshot says, and stores it with the next change", async () => {
    const world = withDisk();
    await world.app.initialize();
    world.fail();

    await expect(world.app.setAppearance("dark")).rejects.toThrow(
      "The disk is full.",
    );

    expect(world.app.snapshot().appearance).toBe("dark");
    expect(world.painted.at(-1)).toBe("dark");
    expect(world.told()).toContainEqual(expect.stringContaining(notStored));
    expect(world.disk()?.appearance).toBeUndefined();

    world.recover();
    await world.app.setDefaultContextBudget("ultra");

    expect(world.disk()?.appearance).toBe("dark");
  });

  it("keeps a conversation in the folder chosen for it, where its tools work, and stores it with the next change", async () => {
    const world = withDisk();
    await world.app.initialize();
    const id = await world.app.createTask();
    world.fail();

    await expect(world.app.selectWorkspace("C:/work/reports")).rejects.toThrow(
      "The disk is full.",
    );

    const folder = { path: "C:/work/reports", name: "reports" };
    expect(world.app.snapshot().workspace).toEqual(folder);
    expect(world.app.snapshot().tasks[0]?.workspace).toEqual(folder);
    expect(world.app.snapshot().recentWorkspaces).toEqual([folder]);
    expect(world.toolRoot(id)).toBe("C:/work/reports");
    expect(world.told()).toContainEqual(expect.stringContaining(notStored));
    expect(world.disk()?.tasks[0]?.workspace).toBeUndefined();

    world.recover();
    await world.app.renameTask(id, "Reports");

    expect(world.disk()?.tasks[0]?.workspace).toEqual(folder);
    expect(world.disk()?.workspace).toEqual(folder);
  });

  it("keeps the folder chosen with no conversation open for the next one", async () => {
    const world = withDisk();
    await world.app.initialize();
    world.fail();

    await expect(world.app.selectWorkspace("C:/work/notes")).rejects.toThrow(
      "The disk is full.",
    );

    expect(world.app.snapshot().workspace?.path).toBe("C:/work/notes");
    world.recover();
    const id = await world.app.createTask();

    expect(
      world.app.snapshot().tasks.find((task) => task.id === id),
    ).toMatchObject({ workspace: { path: "C:/work/notes" } });
    expect(world.disk()?.workspace?.path).toBe("C:/work/notes");
  });

  it("keeps onboarding's answers as chosen but not yet applied, enabling nothing, and stores them with the next change", async () => {
    const world = withDisk();
    await world.app.initialize();
    world.fail();

    await expect(world.app.configureProfile(["publishing"])).rejects.toThrow(
      "The disk is full.",
    );

    expect(world.app.snapshot().preferences).toEqual({
      onboarded: true,
      interests: ["publishing"],
      capabilitiesApplied: false,
    });
    expect(world.enabledPlugins()).toEqual([]);
    expect(world.told()).toContainEqual(expect.stringContaining(notStored));
    expect(world.disk()?.preferences).toBeUndefined();

    world.recover();
    await world.app.setDefaultContextBudget("ultra");

    expect(world.disk()?.preferences).toEqual({
      onboarded: true,
      interests: ["publishing"],
      capabilitiesApplied: false,
    });
  });
});
