/**
 * A picture a person attaches, from the window's side: kept before its message
 * is sent when the chosen model can see pictures, refused with what to do
 * instead when it cannot, and on the message once sent.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, type PasteOutcome } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies, until } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const png = {
  name: "screenshot.png",
  mediaType: "image/png",
  data: Buffer.from("not really a png").toString("base64"),
};

async function coreSeeing(acceptsImages: boolean) {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-attached-"));
  roots.push(root);
  const store = new FileSessions(root);
  const dependencies = stubDependencies(() => {});
  const workspace = loopFrom({
    ...dependencies,
    sessions: {
      ...dependencies.sessions,
      keepPicture: (picture) => store.keepPicture(picture),
      claimDrafts: (conversationId, ids) =>
        store.claimDrafts(conversationId, ids),
      readPicture: (source) => store.readPicture(source),
    },
    model: {
      ...dependencies.model,
      settings: async () => ({
        ...(await dependencies.model.settings()),
        acceptsImages,
      }),
    },
  });
  const core = new Core({
    workspace,
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
    dataFolder: root,
    version: "1.0.0",
  });
  await workspace.initialize();
  await until(() => workspace.settings.current() !== undefined);
  return { core, workspace };
}

describe("a picture a person attaches", () => {
  it("is kept for a model that can see pictures, and is on the message once sent", async () => {
    const { core, workspace } = await coreSeeing(true);

    const kept = (await core.receive(CHANNEL.keepPicture, [
      png,
    ])) as PasteOutcome;
    if (kept.status !== "kept") throw new Error(kept.reason);
    expect(kept.attachment).toMatchObject({
      kind: "picture",
      name: "screenshot.png",
      mediaType: "image/png",
      bytes: 16,
    });
    const taskId = await workspace.createTask();
    await core.receive(CHANNEL.sendMessage, [
      taskId,
      "What does this show?",
      undefined,
      [kept.attachment.id],
    ]);

    expect(workspace.snapshot().tasks[0]?.messages[0]?.attachments).toEqual([
      {
        ...kept.attachment,
        source: expect.stringMatching(/^pasted-pictures\//),
      },
    ]);
  });

  it("is refused for a model that cannot see pictures, saying what to do instead", async () => {
    const { core } = await coreSeeing(false);

    await expect(core.receive(CHANNEL.keepPicture, [png])).resolves.toEqual({
      status: "refused",
      reason:
        "This model can't see pictures. Choose one that can, or describe what's in it.",
    });
  });

  it("is refused when it is not a picture at all", async () => {
    const { core } = await coreSeeing(true);

    await expect(
      core.receive(CHANNEL.keepPicture, [{ ...png, data: "not base64!" }]),
    ).resolves.toEqual({
      status: "refused",
      reason: "This is not a picture Zhiyin can read.",
    });
  });
});
