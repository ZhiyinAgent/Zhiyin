/**
 * What a conversation's first request carries of memory (ADR 0026): the
 * instructions, cut to their limits, and the data the model reads as known,
 * every list held by a count of whole lines.
 */

import {
  everythingScope,
  memoryLimits,
  memoryListLengths,
  type MemoryEntry,
  type MemoryProject,
} from "@zhiyin/contract";
import { estimatedTokens, utf8Bytes } from "@zhiyin/context-budget";
import { instructionCut } from "@zhiyin/text-and-names";
import type { SentInstruction } from "./memory.js";
import { listLine } from "./limits.js";

/** When an entry was last used, or written when never used. */
export function lastUse(entry: MemoryEntry): string {
  return entry.used ?? entry.written;
}

/** Most recently used first; of two used at once, the newer. */
function byUse<Entry extends MemoryEntry>(entries: readonly Entry[]): Entry[] {
  return [...entries].sort(
    (one, other) =>
      lastUse(other).localeCompare(lastUse(one)) || other.number - one.number,
  );
}

function sent(text: string, tokens: number): SentInstruction {
  const cut = instructionCut(text, tokens);
  return { text: cut.text, truncated: cut.truncated, bytes: utf8Bytes(text) };
}

/**
 * About you and How to work for everything, sharing one limit: each has
 * whatever the other leaves, and never less than half, so a long one cannot
 * crowd the other out.
 */
export function personsInstructions(
  about: string | undefined,
  how: string | undefined,
): { about?: SentInstruction; how?: SentInstruction } {
  const limit = memoryLimits.instructions;
  const room = (other: string | undefined) =>
    Math.max(limit - (other ? estimatedTokens(other) : 0), limit / 2);
  return {
    ...(about ? { about: sent(about, room(how)) } : {}),
    ...(how ? { how: sent(how, room(about)) } : {}),
  };
}

export function projectInstructions(how: string): SentInstruction {
  return sent(how, memoryLimits.projectHow);
}

/** A list of lines held to `count`, saying how many more are kept. */
function heldList(
  heading: string,
  lines: readonly string[],
  count: number,
): string[] {
  if (!lines.length) return [];
  const more = lines.length - count;
  return [
    heading,
    ...lines.slice(0, count),
    ...(more > 0 ? [`${more} more are kept; recall finds them by words.`] : []),
  ];
}

/** When a project was last worked in: its latest use or write, or its making. */
function activeAt(
  project: MemoryProject,
  entries: readonly MemoryEntry[],
): string {
  return entries
    .filter((entry) => entry.scope === project.id)
    .reduce(
      (latest, entry) => (lastUse(entry) > latest ? lastUse(entry) : latest),
      project.created,
    );
}

/**
 * The data part: the brief of the project, or of the conversation outside
 * any (`alone`, its own scope), the Projects list and the Knowledge lists.
 */
export function knownText(
  project: MemoryProject | undefined,
  projects: readonly MemoryProject[],
  entries: readonly MemoryEntry[],
  alone?: string,
): string {
  const briefOf = (id: string) =>
    entries.find((entry) => entry.scope === id && entry.section === "brief");
  const brief = project && briefOf(project.id);
  const ownBrief = !project && alone ? briefOf(alone) : undefined;
  const listed = projects
    .filter((one) => !one.archived)
    .map((one) => ({ one, at: activeAt(one, entries) }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ one }) => {
      const its = briefOf(one.id);
      return its
        ? listLine(its.number, one.name, its.summary)
        : `${one.name}: no brief yet`;
    });
  const knowledge = (scope: string) =>
    byUse(
      entries.filter(
        (entry) => entry.scope === scope && entry.section === "knowledge",
      ),
    ).map((entry) => listLine(entry.number, entry.title, entry.summary));
  // Outside a project, the conversation's own lines come first, and the
  // person's fill what they leave of the lines sent.
  const own = !project && alone ? knowledge(alone) : [];
  const ownShown = Math.min(own.length, memoryListLengths.conversation);
  const parts = [
    brief
      ? [
          `Brief of ${project.name}, the project this conversation is in (#${brief.number}):`,
          brief.text,
        ]
      : ownBrief
        ? [`Brief of this conversation (#${ownBrief.number}):`, ownBrief.text]
        : [],
    heldList("Projects:", listed, memoryListLengths.projects),
    project
      ? heldList(
          `Knowledge for ${project.name}:`,
          knowledge(project.id),
          memoryListLengths.project,
        )
      : heldList(
          "Knowledge for this conversation:",
          own,
          memoryListLengths.conversation,
        ),
    heldList(
      "Knowledge for everything the person does:",
      knowledge(everythingScope),
      project
        ? memoryListLengths.besideProject
        : memoryListLengths.alone - ownShown,
    ),
  ];
  return parts
    .filter((part) => part.length)
    .map((part) => part.join("\n"))
    .join("\n\n");
}
