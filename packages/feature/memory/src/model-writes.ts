/**
 * A `remember` call applied (ADR 0026): checked against the limits, the
 * person's words and what the conversation holds, then written, with a record
 * that takes it back.
 */

import {
  everythingScope,
  memoryLimits,
  type MemoryChange,
  type MemoryEntry,
  type MemoryHeld,
  type MemoryWaiting,
} from "@zhiyin/contract";
import { textWithoutCredentials } from "@zhiyin/credential-removal";
import {
  conversationOfScope,
  conversationScope,
} from "@zhiyin/memory-projects";
import type { RememberOutcome, WriteContext } from "./memory.js";
import type { MemoryFolder, Snapshot, StoredEntry } from "./memory-folder.js";
import { sectionTitles } from "./memory-folder.js";
import type { AskedScope, RememberRequest } from "./tools.js";
import {
  briefTooLong,
  entryTooLong,
  instructionsTooLong,
  lineTooLong,
  listLine,
  oneLine,
  projectLineTooLong,
} from "./limits.js";
import { personWrote, rulesOf, withRule } from "./rules.js";
import { snapshotOf, type WriteRecord } from "./writes.js";
import { lastUse } from "./start.js";
import { linkLines } from "./links.js";

type Writing = {
  readonly folder: MemoryFolder;
  readonly snapshot: Snapshot;
  readonly context: WriteContext;
  readonly now: string;
  readonly newId: () => string;
};

type Refused = { readonly ok: false; readonly reason: string };

const refused = (reason: string): Refused => ({ ok: false, reason });

const clean = (text: string | undefined) =>
  text === undefined ? undefined : textWithoutCredentials(text).trim();

/** The labels a write carries: what the entry held, and what the writing conversation holds. */
function heldWith(
  before: MemoryHeld | undefined,
  context: WriteContext,
): MemoryHeld | undefined {
  const held = {
    ...(before?.outside || context.held.outside
      ? { outside: true as const }
      : {}),
    ...(before?.private || context.held.private
      ? { private: true as const }
      : {}),
  };
  return Object.keys(held).length ? held : undefined;
}

/** The title of the conversation a scope of its own belongs to, as its entries keep it. */
function conversationTitle(scope: string, snapshot: Snapshot): string {
  return (
    snapshot.entries.find(
      (entry) => entry.scope === scope && entry.conversation?.title,
    )?.conversation?.title ?? "untitled"
  );
}

/** The scope as the person knows it: everything they do, a project, or a conversation. */
export function scopeName(scope: string, snapshot: Snapshot): string {
  if (scope === everythingScope) return "Everything you do";
  if (conversationOfScope(scope))
    return `Conversation “${conversationTitle(scope, snapshot)}”`;
  return (
    snapshot.projects.find((project) => project.id === scope)?.name ?? scope
  );
}

/** The scope as the model is told it, from the conversation writing or reading. */
export function scopeForModel(
  scope: string,
  snapshot: Snapshot,
  reader?: string,
): string {
  if (scope === everythingScope) return "everything";
  const conversation = conversationOfScope(scope);
  if (conversation)
    return conversation === reader
      ? "this conversation"
      : `the conversation “${conversationTitle(scope, snapshot)}”`;
  return scopeName(scope, snapshot);
}

/** The scope as the writing conversation's card names it. */
function scopeForCard(
  scope: string,
  snapshot: Snapshot,
  context: WriteContext,
): string {
  return conversationOfScope(scope) === context.conversation.id
    ? "This conversation"
    : scopeName(scope, snapshot);
}

const noProject =
  'This conversation is in no project: keep this work\'s memory with scope "conversation", or with "everything" when it holds for anything the person does.';

/** The scope a call names, as kept: everything, the conversation's project, or the conversation's own. */
function scopeOf(
  asked: AskedScope,
  context: WriteContext,
  snapshot: Snapshot,
): string | Refused {
  if (asked === everythingScope) return everythingScope;
  const project = snapshot.projects.find((one) => one.id === context.project);
  if (asked === "project") return project ? project.id : refused(noProject);
  return project
    ? refused(
        `This conversation is in the project ${project.name}: keep this work's memory with scope "project".`,
      )
    : conversationScope(context.conversation.id);
}

/** Whether this conversation may change an entry: one of its own scopes. */
function mayChange(
  entry: MemoryEntry,
  context: WriteContext,
  snapshot: Snapshot,
): Refused | undefined {
  if (
    entry.scope === everythingScope ||
    entry.scope === context.project ||
    entry.scope === conversationScope(context.conversation.id)
  )
    return undefined;
  if (conversationOfScope(entry.scope))
    return refused(
      `#${entry.number} is kept for the conversation “${conversationTitle(entry.scope, snapshot)}”, so it is changed only from that conversation.`,
    );
  return refused(
    `#${entry.number} is kept for ${scopeName(entry.scope, snapshot)}, so it is changed only from a conversation in that project.`,
  );
}

function highest(snapshot: Snapshot): number {
  return Math.max(0, ...snapshot.entries.map((entry) => entry.number));
}

export async function applyRemember(
  request: RememberRequest,
  writing: Writing,
): Promise<RememberOutcome> {
  switch (request.kind) {
    case "new":
      return addKnowledge(request, writing);
    case "change":
      return changeKnowledge(request, writing);
    case "remove":
      return removeKnowledge(request, writing);
    case "brief":
      return writeBrief(request, writing);
    case "rule":
      return writeRule(request, writing);
  }
}

/**
 * Keeps the record that takes a write back, naming the conversation whose card
 * offers its Undo, then makes the write.
 */
function recorded<Value>(
  writing: Writing,
  record: WriteRecord,
  write: () => Promise<Value>,
): Promise<Value> {
  return writing.folder.recordedWrite(
    record.id,
    { ...record, conversation: writing.context.conversation.id },
    write,
  );
}

/** Keeps an entry as written, with the record that takes it back. */
async function kept(
  writing: Writing,
  entry: MemoryEntry,
  before: StoredEntry | undefined,
  change: "added" | "changed",
): Promise<RememberOutcome> {
  const { folder, snapshot, newId, now } = writing;
  const id = newId();
  const record: WriteRecord = {
    id,
    kind: "entry",
    at: now,
    number: entry.number,
    before: before && snapshotOf(before),
    after: snapshotOf(entry),
  };
  await recorded(writing, record, () =>
    folder.save(entry, snapshot.projects, before?.path),
  );
  const others = snapshot.entries.filter((one) => one.number !== entry.number);
  return {
    ok: true,
    answer: {
      kept: change,
      number: entry.number,
      title: entry.title,
      summary: entry.summary,
      scope: scopeForModel(
        entry.scope,
        snapshot,
        writing.context.conversation.id,
      ),
      section: entry.section,
      links: linkLines(entry, others),
    },
    change: {
      writeId: id,
      number: entry.number,
      title: entry.title,
      change,
      scope: entry.scope,
      scopeName: scopeForCard(entry.scope, snapshot, writing.context),
      section: entry.section,
    },
  };
}

export function knowledgeIn(scope: string, snapshot: Snapshot): StoredEntry[] {
  return snapshot.entries.filter(
    (entry) => entry.scope === scope && entry.section === "knowledge",
  );
}

/** The least recently used of a scope's Knowledge entries, as lines. */
export function leastUsedLines(
  scope: string,
  snapshot: Snapshot,
  count: number,
) {
  return knowledgeIn(scope, snapshot)
    .sort(
      (one, other) =>
        lastUse(one).localeCompare(lastUse(other)) || one.number - other.number,
    )
    .slice(0, count)
    .map((entry) => ({
      number: entry.number,
      title: entry.title,
      summary: entry.summary,
    }));
}

async function addKnowledge(
  request: Extract<RememberRequest, { kind: "new" }>,
  writing: Writing,
): Promise<RememberOutcome> {
  const { snapshot, context, now, folder } = writing;
  const scope = scopeOf(request.scope, context, snapshot);
  if (typeof scope !== "string") return scope;
  const title = clean(request.title)!;
  const summary = clean(request.summary)!;
  const text = clean(request.text)!;
  if (!oneLine(title, summary))
    return refused("A title and a summary are one line each.");
  const problem =
    lineTooLong(highest(snapshot) + 1, title, summary) ?? entryTooLong(text);
  if (problem) return refused(problem);
  if (knowledgeIn(scope, snapshot).length >= memoryLimits.knowledge)
    return refused(
      [
        `${scopeName(scope, snapshot)} already holds ${memoryLimits.knowledge} Knowledge entries, the most it can. Fold this into an entry that covers its subject, or remove one that no longer matters. Used least recently:`,
        ...leastUsedLines(scope, snapshot, 5).map((line) =>
          listLine(line.number, line.title, line.summary),
        ),
      ].join("\n"),
    );
  const number = await folder.nextNumber(highest(snapshot));
  const held = heldWith(undefined, context);
  return kept(
    writing,
    {
      number,
      scope,
      section: "knowledge",
      title,
      summary,
      text,
      written: now,
      used: now,
      conversation: context.conversation,
      ...(held ? { held } : {}),
    },
    undefined,
    "added",
  );
}

async function changeKnowledge(
  request: Extract<RememberRequest, { kind: "change" }>,
  writing: Writing,
): Promise<RememberOutcome> {
  const { snapshot, context, now } = writing;
  const before = snapshot.entries.find(
    (entry) => entry.number === request.number,
  )!;
  const denied = mayChange(before, context, snapshot);
  if (denied) return denied;
  const title = clean(request.title) || before.title;
  const summary = clean(request.summary) || before.summary;
  const text = clean(request.text) || before.text;
  if (!oneLine(title, summary))
    return refused("A title and a summary are one line each.");
  const problem =
    lineTooLong(before.number, title, summary) ?? entryTooLong(text);
  if (problem) return refused(problem);
  const held = heldWith(before.held, context);
  return kept(
    writing,
    {
      ...snapshotOf(before),
      title,
      summary,
      text,
      written: now,
      used: now,
      conversation: context.conversation,
      ...(held ? { held } : {}),
    },
    before,
    "changed",
  );
}

async function removeKnowledge(
  request: Extract<RememberRequest, { kind: "remove" }>,
  writing: Writing,
): Promise<RememberOutcome> {
  const { snapshot, context, folder, newId, now } = writing;
  const before = snapshot.entries.find(
    (entry) => entry.number === request.number,
  )!;
  const denied = mayChange(before, context, snapshot);
  if (denied) return denied;
  if (
    request.mergedInto !== undefined &&
    !snapshot.entries.some((entry) => entry.number === request.mergedInto)
  )
    return refused(
      `Nothing is kept as #${request.mergedInto}, so nothing was merged into it.`,
    );
  const id = newId();
  const record: WriteRecord = {
    id,
    kind: "entry",
    at: now,
    number: before.number,
    before: snapshotOf(before),
  };
  await recorded(writing, record, () => folder.forget(before.path));
  return {
    ok: true,
    answer: { kept: "removed", number: before.number, title: before.title },
    change: {
      writeId: id,
      number: before.number,
      title: before.title,
      change: "removed",
      scope: before.scope,
      scopeName: scopeForCard(before.scope, snapshot, context),
      section: before.section,
      ...(request.mergedInto !== undefined
        ? { mergedInto: request.mergedInto }
        : {}),
    },
  };
}

async function writeBrief(
  request: Extract<RememberRequest, { kind: "brief" }>,
  writing: Writing,
): Promise<RememberOutcome> {
  const { snapshot, context, now, folder } = writing;
  // A project's brief, or outside any project the conversation's own.
  const project = snapshot.projects.find((one) => one.id === context.project);
  const scope = project?.id ?? conversationScope(context.conversation.id);
  const before = snapshot.entries.find(
    (entry) => entry.scope === scope && entry.section === "brief",
  );
  const text = clean(request.text) || before?.text;
  const summary = clean(request.summary) || before?.summary;
  if (!text || summary === undefined)
    return refused(
      project
        ? "A new brief needs a text, and a summary: the project's one line in the Projects list."
        : "A new brief needs a text, and a summary: its one line.",
    );
  if (!oneLine(summary)) return refused("A summary is one line.");
  const number = before?.number ?? highest(snapshot) + 1;
  const problem =
    briefTooLong(text) ??
    (project
      ? projectLineTooLong(number, project.name, summary)
      : lineTooLong(number, context.conversation.title, summary));
  if (problem) return refused(problem);
  const held = heldWith(before?.held, context);
  return kept(
    writing,
    {
      number: before?.number ?? (await folder.nextNumber(highest(snapshot))),
      scope,
      section: "brief",
      title: sectionTitles.brief,
      summary,
      text,
      written: now,
      used: now,
      conversation: context.conversation,
      ...(held ? { held } : {}),
    },
    before,
    before ? "changed" : "added",
  );
}

const quoteMissing =
  "The quote is not in the person's messages. A rule for how to work, or about the person, rests on their own words: quote them exactly, as they wrote them in this conversation.";

async function writeRule(
  request: Extract<RememberRequest, { kind: "rule" }>,
  writing: Writing,
): Promise<RememberOutcome> {
  const { snapshot, context, now, folder, newId } = writing;
  const { section } = request;
  const title = sectionTitles[section];
  const numbered = snapshot.entries.find(
    (entry) => entry.number === request.number,
  );
  let scope: string;
  if (numbered) scope = numbered.scope;
  else if (section === "about") {
    if (request.scope === "project")
      return refused(
        'About you is kept for everything the person does: use scope "everything".',
      );
    scope = everythingScope;
  } else {
    if (!request.scope)
      return refused(
        'Say whose rule it is: scope "everything" for anything the person does, or "project" for this project only.',
      );
    if (request.scope === "conversation")
      return refused(
        'A rule for how to work holds for everything the person does, or for a project: use scope "everything".',
      );
    const found = scopeOf(request.scope, context, snapshot);
    if (typeof found !== "string") return found;
    scope = found;
  }
  if (numbered) {
    const denied = mayChange(numbered, context, snapshot);
    if (denied) return denied;
  }
  if (!personWrote(request.quote, context.personsWords))
    return refused(quoteMissing);
  const rule = clean(request.rule);
  const replaces = request.replaces?.trim();
  if (!rule && !replaces)
    return refused(
      "Give the rule to keep, or with remove: true the rule to take out, in replaces.",
    );
  if (!oneLine(rule, replaces)) return refused("A rule is one line.");
  const before =
    numbered ??
    snapshot.entries.find(
      (entry) => entry.scope === scope && entry.section === section,
    );
  const text = withRule(before?.text ?? "", { rule, replaces });
  if (text === undefined)
    return refused(
      [
        `${title} has no rule that reads exactly “${replaces}”. Its rules:`,
        ...rulesOf(before?.text ?? "").map((one) => `- ${one}`),
      ].join("\n"),
    );
  const partner =
    scope === everythingScope
      ? (snapshot.entries.find(
          (entry) =>
            entry.scope === everythingScope &&
            entry.section === (section === "about" ? "how" : "about"),
        )?.text ?? "")
      : "";
  const problem = instructionsTooLong(
    scope === everythingScope ? "everything" : "project",
    before?.text ?? "",
    text,
    partner,
  );
  if (problem) return refused(problem);
  const change = replaces === undefined ? "added" : "changed";

  if (context.held.outside) {
    const id = newId();
    const waiting: MemoryWaiting = {
      id,
      scope,
      section,
      rule: rule ?? "",
      ...(replaces !== undefined ? { replaces } : {}),
      conversation: context.conversation,
      because: context.held.because ?? "outside content",
      at: now,
    };
    const writeId = newId();
    const record: WriteRecord = {
      id: writeId,
      kind: "waiting",
      at: now,
      waitingId: id,
    };
    await recorded(writing, record, () =>
      folder.keepOwnRecord("waiting", id, waiting),
    );
    const shown: MemoryChange = {
      writeId,
      ...(before ? { number: before.number } : {}),
      title,
      change: "waiting",
      scope,
      scopeName: scopeName(scope, snapshot),
      section,
      waiting: {
        id,
        rule: rule ?? "",
        ...(replaces !== undefined ? { replaces } : {}),
        because: waiting.because,
      },
    };
    return {
      ok: true,
      answer: {
        kept: "waiting",
        section,
        scope: scopeForModel(scope, snapshot),
        note: "This conversation read outside content, so the person keeps this change themselves. It is not in effect until they do; do not ask them about it, the conversation shows it to them.",
      },
      change: shown,
    };
  }

  const number = before?.number ?? (await folder.nextNumber(highest(snapshot)));
  const held = heldWith(before?.held, context);
  const entry: MemoryEntry = {
    number,
    scope,
    section,
    title,
    summary: "",
    text,
    written: now,
    used: now,
    conversation: context.conversation,
    ...(held ? { held } : {}),
  };
  const id = newId();
  const record: WriteRecord = {
    id,
    kind: "rule",
    at: now,
    number,
    scope,
    section,
    ...(rule ? { rule } : {}),
    ...(replaces !== undefined ? { replaces } : {}),
  };
  await recorded(writing, record, () =>
    folder.save(entry, snapshot.projects, before?.path),
  );
  return {
    ok: true,
    answer: {
      kept: change,
      number,
      section,
      scope: scopeForModel(scope, snapshot),
      rules: rulesOf(text),
    },
    change: {
      writeId: id,
      number,
      title,
      change,
      scope,
      scopeName: scopeName(scope, snapshot),
      section,
      rule: {
        ...(rule ? { added: rule } : {}),
        ...(replaces !== undefined ? { replaced: replaces } : {}),
      },
    },
  };
}
