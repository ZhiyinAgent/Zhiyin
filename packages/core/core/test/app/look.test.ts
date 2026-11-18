/**
 * The look: the person's choice of the listed looks and a strength, saved
 * with their other choices, and handed to whatever dresses the window.
 */

import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, type LookChoice } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/test-support";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies, storedIn } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function dressed(root: string) {
  const applied: LookChoice[] = [];
  const app = loopFrom({
    ...stubDependencies(() => {}),
    ...storedIn(new FileSessions(root)),
    look: { apply: (choice) => applied.push(choice) },
  });
  await app.initialize();
  return { app, applied };
}

describe("the look", () => {
  it("is Ink at the default strength until the person chooses, and dresses the window with each choice", async () => {
    const root = await folders.make("zhiyin-look-");
    const { app, applied } = await dressed(root);

    expect(app.snapshot().look).toBeUndefined();
    expect(applied).toEqual([{ look: "ink", strength: "default" }]);

    await app.setLook({ look: "neutral", strength: "default" });
    await app.setLook({ look: "ink", strength: "vivid" });

    expect(applied).toEqual([
      { look: "ink", strength: "default" },
      { look: "neutral", strength: "default" },
      { look: "ink", strength: "vivid" },
    ]);
    expect(app.snapshot().look).toEqual({ look: "ink", strength: "vivid" });

    await app.setLook({ look: "ink", strength: "default" });
    expect(app.snapshot().look).toBeUndefined();
  });

  it("is the same after a restart, and dresses the window before anything else is drawn", async () => {
    const root = await folders.make("zhiyin-look-");
    const before = await dressed(root);
    await before.app.setLook({ look: "neutral", strength: "subtle" });
    await before.app.shutdown();

    expect(await new FileSessions(root).savedLook()).toEqual({
      look: "neutral",
      strength: "subtle",
    });
    const { app, applied } = await dressed(root);
    expect(app.snapshot().look).toEqual({
      look: "neutral",
      strength: "subtle",
    });
    expect(applied).toEqual([{ look: "neutral", strength: "subtle" }]);
  });

  it("is chosen from the window among the listed looks and strengths, and nothing else", async () => {
    const app = loopFrom(stubDependencies(() => {}));
    await app.initialize();
    const core = new Core({
      workspace: app,
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
      dataFolder: "C:/data",
      version: "1.0.0",
    });

    await core.receive(CHANNEL.setLook, [
      { look: "neutral", strength: "vivid" },
    ]);
    expect(app.snapshot().look).toEqual({ look: "neutral", strength: "vivid" });
    for (const refused of [
      [{ look: "sepia", strength: "default" }],
      [{ look: "ink", strength: "loud" }],
      ["ink"],
      [],
    ])
      await expect(core.receive(CHANNEL.setLook, refused)).rejects.toThrow();
    expect(app.snapshot().look).toEqual({ look: "neutral", strength: "vivid" });
  });
});
