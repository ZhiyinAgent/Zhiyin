/**
 * File recovery's fake, for the tests of the packages above it (ADR 0002).
 * It copies no file.
 */

import type { Recovery } from "../src/index.js";

/**
 * Recovery that answers every declared change as protected and keeps nothing:
 * no folder is copied, a review finds no files, and no versions are shown.
 * `answers` replaces any of those answers.
 */
export function fakeRecovery(answers: Partial<Recovery> = {}): Recovery {
  return {
    prepare: async (actionId, _workspaceRoot, changes) => ({
      actionId,
      files: changes.map((change) => ({
        path: change.path,
        status: "protected" as const,
      })),
    }),
    validate: async () => ({ ok: true }),
    commit: async () => {},
    keepCommandChanges: async () => {},
    copyFolder: async () => ({
      ok: false,
      reason: "No folder is copied in this test.",
    }),
    keepFolderChanges: async () => undefined,
    discard: async () => {},
    review: async (id, workspaceRoot) => ({
      id,
      workspaceRoot,
      files: [],
      targets: [],
    }),
    restore: async () => ({ files: [] }),
    versions: async () => ({
      ok: false,
      reason: "No versions in this test.",
    }),
    cleanup: async () => {},
    forgetConversation: async () => {},
    ...answers,
  };
}
