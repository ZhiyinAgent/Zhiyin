/**
 * What memory's changes answer, and the shapes it hands out: the stored
 * forms carry where each is kept, which never leaves the package.
 */

import { conversationOfScope } from "@zhiyin/memory-projects";
import {
  everythingScope,
  memoryLimits,
  type MemoryEntry,
  type MemoryHeld,
  type MemoryProject,
} from "@zhiyin/contract";
import type { PersonsOutcome } from "./memory.js";
import type { Snapshot, StoredEntry, StoredProject } from "./memory-folder.js";
import { knowledgeIn, scopeName } from "./model-writes.js";
import { briefTooLong, entryTooLong } from "./limits.js";

export const ok: PersonsOutcome = { ok: true };

export const refused = (reason: string): PersonsOutcome & { ok: false } => ({
  ok: false,
  reason,
});

/** Whether anything sent came from outside the conversation, or was private. */
export function heldOf(entries: readonly MemoryEntry[]): MemoryHeld {
  return {
    ...(entries.some((entry) => entry.held?.outside)
      ? { outside: true as const }
      : {}),
    ...(entries.some((entry) => entry.held?.private)
      ? { private: true as const }
      : {}),
  };
}

/**
 * Why the person's text for an entry or a brief is past its limit, or
 * nothing. Text made no longer is let through, so one past it can shrink;
 * instructions are the person's own and are only cut when sent.
 */
export function textProblem(
  section: MemoryEntry["section"],
  before: string,
  after: string,
): string | undefined {
  if (after.length <= before.length) return undefined;
  if (section === "knowledge") return entryTooLong(after);
  if (section === "brief") return briefTooLong(after);
  return undefined;
}

/**
 * Where a scope is kept now: everything, a conversation's own, its project,
 * or the project it was merged into; nothing once its project is no longer
 * kept.
 */
export function scopeNow(
  scope: string,
  projects: readonly StoredProject[],
): string | undefined {
  if (scope === everythingScope || conversationOfScope(scope)) return scope;
  return projects.find(
    (project) => project.id === scope || project.merged?.includes(scope),
  )?.id;
}

/** Why a scope has no room for another Knowledge entry, or nothing. */
export function noRoomIn(
  scope: string,
  snapshot: Snapshot,
): string | undefined {
  return knowledgeIn(scope, snapshot).length >= memoryLimits.knowledge
    ? `${scopeName(scope, snapshot)} already holds ${memoryLimits.knowledge} Knowledge entries, the most it can. Remove or move one first.`
    : undefined;
}

export function projectOnly(project: StoredProject): MemoryProject {
  return {
    id: project.id,
    name: project.name,
    folders: project.folders,
    ...(project.archived ? { archived: true as const } : {}),
    created: project.created,
    ...(project.merged?.length ? { merged: project.merged } : {}),
  };
}

export function entryOnly(entry: StoredEntry): MemoryEntry {
  return {
    number: entry.number,
    scope: entry.scope,
    section: entry.section,
    title: entry.title,
    summary: entry.summary,
    text: entry.text,
    written: entry.written,
    ...(entry.used ? { used: entry.used } : {}),
    ...(entry.conversation ? { conversation: entry.conversation } : {}),
    ...(entry.held ? { held: entry.held } : {}),
  };
}
