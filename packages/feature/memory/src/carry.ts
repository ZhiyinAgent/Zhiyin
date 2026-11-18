/**
 * A conversation's own memory carried into the project it joined (ADR 0026):
 * each entry keeps its number; its brief becomes the project's, or a
 * Knowledge entry when the project already has one.
 */

import type { MemoryEntry } from "@zhiyin/contract";
import { conversationScope } from "@zhiyin/memory-projects";
import type { MemoryFolder, Snapshot, StoredProject } from "./memory-folder.js";
import { entryOnly } from "./outcomes.js";

/** Moves what a conversation kept for itself into `project`; says whether anything moved. */
export async function carryConversation(
  folder: MemoryFolder,
  snapshot: Snapshot,
  conversationId: string,
  project: StoredProject,
): Promise<boolean> {
  const scope = conversationScope(conversationId);
  const its = snapshot.entries.filter((entry) => entry.scope === scope);
  if (!its.length) return false;
  const briefKept = snapshot.entries.some(
    (entry) => entry.scope === project.id && entry.section === "brief",
  );
  for (const entry of its) {
    const moved: MemoryEntry =
      entry.section === "brief" && briefKept
        ? {
            ...entryOnly(entry),
            scope: project.id,
            section: "knowledge",
            title: `Where “${entry.conversation?.title ?? "a conversation"}” stood`,
          }
        : { ...entryOnly(entry), scope: project.id };
    await folder.save(moved, snapshot.projects, entry.path);
  }
  await folder.dropConversationFolder(conversationId);
  return true;
}
