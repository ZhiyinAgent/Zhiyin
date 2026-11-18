/**
 * What the Memory page shows, and the reading it does of it: the scopes,
 * where an entry links, what links to it, and what a search finds. ADR 0026.
 */

import {
  everythingScope,
  type MemoryEntry,
  type MemoryLimits,
  type MemorySection,
  type MemoryState,
  type MemoryWaiting,
} from "@zhiyin/contract";
import { estimatedTokens } from "@zhiyin/context-budget";
import { conversationOfScope } from "@zhiyin/memory-projects";

/** Everything the person does, a project or a conversation, as the page lists it. */
export type MemoryScope = {
  readonly id: string;
  readonly name: string;
  /** One line on where its work stands: its brief's summary. */
  readonly summary?: string | undefined;
};

/** Everything the person does first, then each project still in use. */
export function scopesOf(memory: MemoryState): MemoryScope[] {
  return [
    { id: everythingScope, name: "Everything you do" },
    ...projectScopes(memory, false),
  ];
}

/** The projects whose work is done, kept apart from the list. */
export function archivedScopesOf(memory: MemoryState): MemoryScope[] {
  return projectScopes(memory, true);
}

/**
 * The conversations that kept memory for themselves (ADR 0026), by the title
 * they had when they wrote it, most recently written first. One deleted
 * with its memory kept stays here until that memory is moved or deleted.
 */
export function conversationScopesOf(memory: MemoryState): MemoryScope[] {
  const briefs = briefsOf(memory);
  const scopes = new Map<string, MemoryScope>();
  for (const entry of byWriting(memory.entries)) {
    if (!conversationOfScope(entry.scope) || scopes.has(entry.scope)) continue;
    scopes.set(entry.scope, {
      id: entry.scope,
      name: entry.conversation?.title || "A conversation",
      summary: briefs.get(entry.scope) || undefined,
    });
  }
  return [...scopes.values()];
}

/** Whether a scope is a conversation's own. */
export function isConversationScope(scope: string): boolean {
  return conversationOfScope(scope) !== undefined;
}

function briefsOf(memory: MemoryState): Map<string, string> {
  return new Map(
    memory.entries
      .filter((entry) => entry.section === "brief")
      .map((entry) => [entry.scope, entry.summary]),
  );
}

function byWriting(entries: readonly MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((one, other) =>
    other.written.localeCompare(one.written),
  );
}

function projectScopes(memory: MemoryState, archived: boolean): MemoryScope[] {
  const briefs = briefsOf(memory);
  return memory.projects
    .filter((project) => (project.archived === true) === archived)
    .map((project) => ({
      id: project.id,
      name: project.name,
      summary: briefs.get(project.id) || undefined,
    }));
}

/** The changes to one instruction that wait for the person, oldest first. */
export function waitingIn(
  memory: MemoryState,
  scope: string,
  section: MemorySection,
): MemoryWaiting[] {
  return memory.waiting.filter(
    (waiting) => waiting.scope === scope && waiting.section === section,
  );
}

/**
 * The space an entry's text has, and how much of it the entry sharing that
 * space already takes: about the person and how to work for everything are
 * sent together, so they share one.
 */
export type Room = {
  readonly space: number;
  readonly beside: number;
  /** For a Knowledge entry, the limit of its line in the list. */
  readonly line?: number | undefined;
};

export function roomOf(
  entry: MemoryEntry,
  entries: readonly MemoryEntry[],
  limits: MemoryLimits,
): Room {
  if (entry.section === "brief") return { space: limits.brief, beside: 0 };
  if (entry.section === "knowledge") {
    return { space: limits.entry, beside: 0, line: limits.line };
  }
  if (entry.scope !== "everything") {
    return { space: limits.projectHow, beside: 0 };
  }
  const partner = entry.section === "about" ? "how" : "about";
  const other = entries.find(
    (one) => one.scope === "everything" && one.section === partner,
  );
  return {
    space: limits.instructions,
    beside: other ? estimatedTokens(other.text) : 0,
  };
}

/** A piece of an entry's text: words, or a link by number. */
export type TextPiece =
  | { readonly kind: "words"; readonly text: string }
  | { readonly kind: "link"; readonly number: number };

const link = /#(\d+)\b/g;

/** An entry's text split into words and the links in it. */
export function textPieces(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let from = 0;
  for (const found of text.matchAll(link)) {
    if (found.index > from) {
      pieces.push({ kind: "words", text: text.slice(from, found.index) });
    }
    pieces.push({ kind: "link", number: Number(found[1]) });
    from = found.index + found[0].length;
  }
  if (from < text.length)
    pieces.push({ kind: "words", text: text.slice(from) });
  return pieces;
}

/** The numbers an entry links to, each once, in the order written. */
export function linksOf(entry: MemoryEntry): number[] {
  return [
    ...new Set(
      textPieces(entry.text).flatMap((piece) =>
        piece.kind === "link" && piece.number !== entry.number
          ? [piece.number]
          : [],
      ),
    ),
  ];
}

/** The entries that link to this one. */
export function linkedFrom(
  number: number,
  entries: readonly MemoryEntry[],
): MemoryEntry[] {
  return entries.filter((other) => linksOf(other).includes(number));
}

/** Most recently used first; never used, by when it was written. */
export function byUse(entries: readonly MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((one, other) =>
    (other.used ?? other.written).localeCompare(one.used ?? one.written),
  );
}

/**
 * The entries whose title, summary or text hold every word searched for,
 * whatever their case or accents.
 */
export function searched(
  query: string,
  entries: readonly MemoryEntry[],
): MemoryEntry[] {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return byUse(
    entries.filter((entry) => {
      const haystack = folded(
        `${entry.title} ${entry.summary} ${entry.text} #${entry.number}`,
      );
      return words.every((word) => haystack.includes(word));
    }),
  );
}

function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/** An entry's line in the Knowledge list the model is sent. */
export function listLine(
  number: number,
  title: string,
  summary: string,
): string {
  return `#${number} ${title}: ${summary}`;
}

/** What a waiting change would do, in words: a rule added, changed or taken out. */
export function waitingWords(change: {
  readonly rule: string;
  readonly replaces?: string | undefined;
}): string {
  if (!change.rule) return `Take out: ${change.replaces ?? ""}`;
  return change.replaces
    ? `${change.rule} (in place of: ${change.replaces})`
    : change.rule;
}
