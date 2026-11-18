/**
 * What the packages above the history rely on its fakes to answer, held to
 * the real history: the same expectations run against both (ADR 0002).
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { FileSessions, type KeptStore, type Sessions } from "../src/index.js";
import { fakeKeptStore, fakeSessions } from "./fakes.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const realHistory = async () =>
  new FileSessions(await folders.make("zhiyin-fake-history-"));

const keptStores: readonly [string, () => Promise<KeptStore>][] = [
  ["the real store", realHistory],
  ["the fake", async () => fakeKeptStore()],
];

describe.each(keptStores)("what %s keeps beside a conversation", (_, make) => {
  it("keeps each text under an id of its own, counting its bytes as UTF-8", async () => {
    const kept = await make();

    const first = await kept.keep("output", "conversation-1", {
      text: "déjà vu",
    });
    const second = await kept.keep("output", "conversation-1", {
      text: "again",
    });

    expect(first).toMatchObject({ status: "kept", bytes: 9 });
    expect(second).toMatchObject({ status: "kept", bytes: 5 });
    const ids = [first, second].map((item) =>
      item.status === "kept" ? item.id : undefined,
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("says an output, a picture or an attached picture it never kept is missing", async () => {
    const kept = await make();

    expect(
      await kept.locate("output", "conversation-1", "never-kept"),
    ).toMatchObject({ status: "missing" });
    expect(await kept.readPicture("never-kept")).toMatchObject({
      status: "missing",
    });
    expect(
      await kept.readAttachedPicture("conversation-1", "never-kept"),
    ).toMatchObject({ status: "missing" });
  });

  it("moves no draft when a message names none", async () => {
    const kept = await make();

    expect(await kept.claimDrafts("conversation-1", [])).toEqual([]);
  });
});

const histories: readonly [string, () => Promise<Sessions>][] = [
  ["the real history", realHistory],
  ["the fake", async () => fakeSessions()],
];

describe.each(histories)("%s with nothing saved", (_, make) => {
  it("reads no workspace and no index", async () => {
    const sessions = await make();

    expect(await sessions.loadWorkspace()).toBeUndefined();
    expect(await sessions.loadIndex()).toBeUndefined();
  });

  it("opens no conversation", async () => {
    const sessions = await make();

    await expect(sessions.openConversation("conversation-1")).rejects.toThrow();
  });
});
