/**
 * A picture a person attaches, from the window's side: kept before its message
 * is sent when the chosen model can see pictures, refused with what to do
 * instead when it cannot, and on the message once sent. Whether the model sees
 * pictures is looked up again when the last look could not reach its details.
 */

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CHANNEL, type PasteOutcome } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const png = {
  name: "screenshot.png",
  mediaType: "image/png",
  data: Buffer.from("not really a png").toString("base64"),
};

/**
 * Waits until the model is asked something more, or half a second: long
 * enough for a turn or a condensing that did not wait for a held read to
 * reach the model.
 */
async function untilAskedOrHalfASecond(
  requests: readonly ModelRequest[],
  asked: number,
): Promise<void> {
  for (let waited = 0; waited < 500 && requests.length === asked; waited += 10)
    await new Promise((done) => setTimeout(done, 10));
}

/** What the model's settings say of pictures, read each time they are read. */
type Seeing = () => {
  readonly acceptsImages: boolean;
  readonly lookupFailed?: true;
};

async function coreSeeing(stated: boolean | Seeing) {
  const seeing: Seeing =
    typeof stated === "boolean" ? () => ({ acceptsImages: stated }) : stated;
  const root = await folders.make("zhiyin-attached-");
  const store = new FileSessions(root);
  const dependencies = stubDependencies(() => {});
  const requests: ModelRequest[] = [];
  let reads = 0;
  let held: Promise<void> | undefined;
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
      settings: async () => {
        reads += 1;
        if (held) await held;
        return { ...(await dependencies.model.settings()), ...seeing() };
      },
      send: async function* (request: ModelRequest) {
        requests.push(request);
        yield { kind: "textDelta" as const, text: "Seen." };
        yield { kind: "done" as const };
      },
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
  onTestFinished(() => workspace.settings.stop());
  /** Holds the next reads of the settings until the answer it returns. */
  const hold = () => {
    let release = () => {};
    held = new Promise((done) => {
      release = done;
    });
    return () => {
      held = undefined;
      release();
    };
  };
  return { core, workspace, requests, reads: () => reads, hold };
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

  it("is kept once the model's details arrive, after a first look that could not reach them", async () => {
    let reachable = false;
    const { core } = await coreSeeing(() =>
      reachable
        ? { acceptsImages: true }
        : { acceptsImages: false, lookupFailed: true },
    );
    reachable = true;

    const kept = (await core.receive(CHANNEL.keepPicture, [
      png,
    ])) as PasteOutcome;

    expect(kept.status).toBe("kept");
  });

  it("is refused while the model's details cannot be looked up, saying so rather than that it cannot see", async () => {
    const { core } = await coreSeeing(() => ({
      acceptsImages: false,
      lookupFailed: true,
    }));

    await expect(core.receive(CHANNEL.keepPicture, [png])).resolves.toEqual({
      status: "refused",
      reason:
        "Whether this model can see pictures is not known yet: its details could not be loaded. Try again in a moment.",
    });
  });

  it("is sent to a model whose details are looked up again as the message is sent, after a look that could not reach them", async () => {
    let reachable = true;
    const { core, workspace, requests, hold } = await coreSeeing(() =>
      reachable
        ? { acceptsImages: true }
        : { acceptsImages: false, lookupFailed: true },
    );
    const kept = (await core.receive(CHANNEL.keepPicture, [
      png,
    ])) as PasteOutcome;
    if (kept.status !== "kept") throw new Error(kept.reason);
    reachable = false;
    await workspace.settings.refresh();
    expect(workspace.settings.seesPictures()).toBeUndefined();
    reachable = true;
    const taskId = await workspace.createTask();
    // The look takes longer than starting a turn would.
    const release = hold();

    const sending = core.receive(CHANNEL.sendMessage, [
      taskId,
      "What does this show?",
      undefined,
      [kept.attachment.id],
    ]);
    await untilAskedOrHalfASecond(requests, 0);
    release();
    await sending;

    await until(() => requests.length > 0);
    expect(JSON.stringify(requests[0]?.messages)).toContain(png.data);
  });

  it("has the model looked up again before its conversation is condensed, after a look that could not reach its details", async () => {
    let reachable = true;
    const window = { contextWindow: 16_000, maximumOutputTokens: 1_000 };
    const { core, workspace, requests, hold } = await coreSeeing(() =>
      reachable
        ? { acceptsImages: true, ...window }
        : { acceptsImages: false, lookupFailed: true, ...window },
    );
    const kept = (await core.receive(CHANNEL.keepPicture, [
      png,
    ])) as PasteOutcome;
    if (kept.status !== "kept") throw new Error(kept.reason);
    const taskId = await workspace.createTask();
    await workspace.start(taskId, "What does this show?", undefined, [
      kept.attachment.id,
    ]);
    for (const ask of ["And the legend?", "The axis?", "The title?"])
      await workspace.start(taskId, `${ask} ${"Some detail. ".repeat(900)}`);
    reachable = false;
    await workspace.settings.refresh();
    reachable = true;
    const release = hold();

    const asked = requests.length;
    const condensing = core.receive(CHANNEL.condenseNow, [taskId]);
    await untilAskedOrHalfASecond(requests, asked);
    release();
    await condensing;

    const summarising = requests
      .slice(asked)
      .filter((request) =>
        JSON.stringify(request.messages.at(-1)).includes("condense"),
      );
    expect(summarising.length).toBeGreaterThan(0);
    expect(JSON.stringify(summarising[0]?.messages)).toContain(png.data);
  });

  it("is looked up again by itself no longer once the app is closing", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout"],
    });
    try {
      const { workspace, reads } = await coreSeeing(() => ({
        acceptsImages: false,
        lookupFailed: true,
      }));
      await workspace.shutdown();
      const before = reads();

      await vi.advanceTimersByTimeAsync(600_000);

      expect(reads()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
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
