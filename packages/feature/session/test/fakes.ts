/**
 * The history's fakes, for the tests of the packages above it (ADR 0002).
 * They hold nothing on disk and reach nothing.
 */

import type {
  HistoryRepair,
  HistoryUpdates,
  KeptSource,
  KeptStore,
  Sessions,
} from "../src/index.js";

/**
 * A store that numbers what it is given to keep and reads nothing back: every
 * kept item, picture or paste it is asked for is no longer there.
 */
export function fakeKeptStore(): KeptStore {
  let keptNumber = 0;
  return {
    savePicture: async () => "picture-1",
    readPicture: async () => ({
      status: "missing" as const,
      reason: "This picture is no longer stored with the conversation.",
    }),
    keep: async (
      _kind: string,
      _conversationId: string | undefined,
      source: KeptSource,
    ) => ({
      status: "kept" as const,
      id: `kept-${++keptNumber}`,
      bytes: "text" in source ? Buffer.byteLength(source.text) : 0,
    }),
    locate: async () => ({
      status: "missing" as const,
      reason: "This output is no longer stored with the conversation.",
    }),
    keepPicture: async () => ({
      status: "kept" as const,
      id: `kept-${++keptNumber}`,
      bytes: 0,
    }),
    readAttachedPicture: async () => ({
      status: "missing" as const,
      reason: "This picture is no longer stored with the conversation.",
    }),
    claimDrafts: async () => [],
    forgetConversation: async () => {},
  };
}

/**
 * A history with nothing saved, and saving nothing. A test that gives it a
 * saved workspace through `loadWorkspace` states the history once, whole:
 * the index and each conversation are read from it, as they would be from
 * disk.
 */
export function fakeSessions(): Sessions {
  return {
    loadWorkspace: async () => undefined,
    async loadIndex() {
      const saved = await this.loadWorkspace();
      return (
        saved && {
          ...saved,
          conversations:
            saved.conversations ??
            saved.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              titleSource: task.titleSource,
              updatedAt: task.updatedAt,
              updatedLabel: task.updatedLabel,
            })),
        }
      );
    },
    async openConversation(id: string) {
      const task = (await this.loadWorkspace())?.tasks.find(
        (item) => item.id === id,
      );
      if (!task) throw new Error("No such conversation is saved.");
      return { task, lost: false };
    },
    saveWorkspace: async () => {},
  };
}

/** A history whose settings cannot be read at all, kept aside and changed by nothing. */
export function fakeHistoryRepair(): HistoryRepair {
  return {
    inspectDamage: async () => ({ kind: "unreadable" as const }),
    preserveDamaged: async () => "damaged-history/workspace.json",
    startAfresh: async () => {},
    recoverReadable: async () => ({
      recovered: 0,
      discarded: 0,
      kept: "damaged-history/workspace.json",
    }),
  };
}

/** No conversation waits for an update. */
export function fakeHistoryUpdates(): HistoryUpdates {
  return {
    updateConversations: async () => ({ updated: [], failed: 0 }),
    recycleOutdatedConversations: async () => ({ recycled: [], failed: 0 }),
  };
}
