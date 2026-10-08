/**
 * Light or dark: the person's choice, saved with their other choices, and
 * handed to whatever the application paints the window with.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, type Appearance } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function painted(root: string) {
  const applied: Appearance[] = [];
  const app = loopFrom({
    ...stubDependencies(() => {}),
    sessions: new FileSessions(root),
    appearance: { apply: (choice) => applied.push(choice) },
  });
  await app.initialize();
  return { app, applied };
}

describe("the appearance", () => {
  it("matches Windows until the person chooses, and paints the window with each choice", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-appearance-"));
    roots.push(root);
    const { app, applied } = await painted(root);

    expect(app.snapshot().appearance).toBeUndefined();
    expect(applied).toEqual(["system"]);

    await app.setAppearance("light");
    await app.setAppearance("system");

    expect(applied).toEqual(["system", "light", "system"]);
    expect(app.snapshot().appearance).toBeUndefined();
  });

  it("is the same after a restart, and painted before anything else is", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-appearance-"));
    roots.push(root);
    const before = await painted(root);
    await before.app.setAppearance("dark");
    await before.app.shutdown();

    expect(await new FileSessions(root).savedAppearance()).toBe("dark");
    const { app, applied } = await painted(root);
    expect(app.snapshot().appearance).toBe("dark");
    expect(applied).toEqual(["dark"]);
  });

  it("is chosen from the window as one of three words, and nothing else", async () => {
    const app = loopFrom(stubDependencies(() => {}));
    await app.initialize();
    const core = new Core({
      workspace: app,
      ownership: { claim: async () => {}, release: async () => {} },
      viewChecks: { answer: () => {}, abandon: () => {} },
      commands: {
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
      dataFolder: "C:/data",
      version: "1.0.0",
    });

    await core.receive(CHANNEL.setAppearance, ["light"]);
    expect(app.snapshot().appearance).toBe("light");
    await core.receive(CHANNEL.setAppearance, ["system"]);
    expect(app.snapshot().appearance).toBeUndefined();
    await expect(
      core.receive(CHANNEL.setAppearance, ["sepia"]),
    ).rejects.toThrow();
    await expect(core.receive(CHANNEL.setAppearance, [])).rejects.toThrow();
  });
});
