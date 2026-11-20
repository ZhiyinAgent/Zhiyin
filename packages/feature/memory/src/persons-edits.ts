/**
 * The person's own changes to memory from the Memory page and the
 * conversation's cards: adding, editing, removing and moving entries,
 * keeping or discarding a change that waits for them, and undoing a write.
 * Each change reads the folder afresh; the caller runs them one at a time.
 */

import {
  everythingScope,
  type MemoryDraft,
  type MemoryEdit,
  type MemoryEntry,
  type MemoryWaiting,
} from "@zhiyin/contract";
import { textWithoutCredentials } from "@zhiyin/credential-removal";
import {
  conversationOfScope,
  conversationScope,
} from "@zhiyin/memory-projects";
import type { PersonsOutcome } from "./memory.js";
import {
  sectionTitles,
  type MemoryFolder,
  type Snapshot,
} from "./memory-folder.js";
import { scopeName } from "./model-writes.js";
import { lineTooLong, oneLine, projectLineTooLong } from "./limits.js";
import {
  ruleTakenBack,
  snapshotOf,
  unchangedSince,
  type WriteRecord,
} from "./writes.js";
import { rulesOf, withRule } from "./rules.js";
import type { UndoRecords } from "./undo-records.js";
import type { TakenBack, TakenBackBy } from "./taken-back.js";
import {
  entryOnly,
  noRoomIn,
  ok,
  refused,
  scopeNow,
  textProblem,
} from "./outcomes.js";

export type PersonsEditsOptions = {
  readonly now: () => Date;
  readonly newId: () => string;
};

export class PersonsEdits {
  readonly #folder: MemoryFolder;
  readonly #options: PersonsEditsOptions;
  readonly #records: UndoRecords;
  readonly #taken: TakenBack;

  constructor(
    folder: MemoryFolder,
    options: PersonsEditsOptions,
    records: UndoRecords,
    taken: TakenBack,
  ) {
    this.#folder = folder;
    this.#options = options;
    this.#records = records;
    this.#taken = taken;
  }

  #now(): string {
    return this.#options.now().toISOString();
  }

  async add(
    entry: MemoryDraft,
  ): Promise<PersonsOutcome & { readonly number?: number }> {
    const snapshot = await this.#folder.read();
    const forConversation = conversationOfScope(entry.scope) !== undefined;
    if (
      entry.scope !== everythingScope &&
      !forConversation &&
      !snapshot.projects.some((one) => one.id === entry.scope)
    )
      return refused("That project is no longer kept.");
    if (entry.section === "how" && forConversation)
      return refused("How to work is kept for everything or a project.");
    if (entry.section !== "knowledge") {
      const there = snapshot.entries.find(
        (one) => one.scope === entry.scope && one.section === entry.section,
      );
      if (there)
        return refused(
          `${sectionTitles[entry.section]} is already kept as #${there.number}.`,
        );
      if (entry.section === "about" && entry.scope !== everythingScope)
        return refused("About you is kept for everything the person does.");
      if (entry.section === "brief" && entry.scope === everythingScope)
        return refused("Only a project has a brief.");
    }
    const title =
      entry.section === "knowledge"
        ? textWithoutCredentials(entry.title ?? "").trim()
        : sectionTitles[entry.section];
    const summary = textWithoutCredentials(entry.summary ?? "").trim();
    const top = Math.max(0, ...snapshot.entries.map((one) => one.number));
    const problem = lineProblem(
      entry.section,
      entry.scope,
      top + 1,
      title,
      summary,
      snapshot,
    );
    if (problem) return refused(problem);
    if (entry.section === "knowledge" && !title)
      return refused("A Knowledge entry needs a title.");
    const beyond =
      textProblem(entry.section, "", entry.text) ??
      (entry.section === "knowledge"
        ? noRoomIn(entry.scope, snapshot)
        : undefined);
    if (beyond) return refused(beyond);
    const number = await this.#folder.nextNumber(top);
    const now = this.#now();
    await this.#folder.save(
      {
        number,
        scope: entry.scope,
        section: entry.section,
        title,
        summary,
        text: textWithoutCredentials(entry.text).trim(),
        written: now,
        used: now,
      },
      snapshot.projects,
    );
    return { ok: true, number };
  }

  async edit(number: number, edit: MemoryEdit): Promise<PersonsOutcome> {
    const snapshot = await this.#folder.read();
    const before = snapshot.entries.find((entry) => entry.number === number);
    if (!before) return refused(`#${number} is no longer kept.`);
    const title =
      before.section === "knowledge"
        ? edit.title?.trim() || before.title
        : before.title;
    const summary = edit.summary?.trim() ?? before.summary;
    const problem =
      lineProblem(
        before.section,
        before.scope,
        number,
        title,
        summary,
        snapshot,
      ) ?? textProblem(before.section, before.text, edit.text ?? before.text);
    if (problem) return refused(problem);
    await this.#folder.save(
      {
        ...entryOnly(before),
        title: textWithoutCredentials(title),
        summary: textWithoutCredentials(summary),
        text: textWithoutCredentials(edit.text ?? before.text).trim(),
        written: this.#now(),
      },
      snapshot.projects,
      before.path,
    );
    return ok;
  }

  async remove(
    number: number,
  ): Promise<PersonsOutcome & { readonly writeId?: string }> {
    const snapshot = await this.#folder.read();
    const before = snapshot.entries.find((entry) => entry.number === number);
    if (!before) return refused(`#${number} is no longer kept.`);
    const id = this.#options.newId();
    const record: WriteRecord = {
      id,
      kind: "entry",
      at: this.#now(),
      number,
      before: snapshotOf(before),
    };
    await this.#folder.recordedWrite(id, record, () =>
      this.#folder.forget(before.path),
    );
    return { ok: true, writeId: id };
  }

  /**
   * Removes, as the person chose, what a deleted conversation kept for itself
   * (`own`) and each of the person's Knowledge entries it wrote (`general`),
   * keeping no record to undo it: the conversation, and every place its Undo was offered, is gone.
   * An instruction it added a rule to is the person's too, and stays.
   */
  async forgetConversation(
    conversationId: string,
    { own, general }: { readonly own: boolean; readonly general: boolean },
  ): Promise<PersonsOutcome> {
    const snapshot = await this.#folder.read();
    const its = conversationScope(conversationId);
    for (const entry of snapshot.entries)
      if (
        (own && entry.scope === its) ||
        (general &&
          entry.scope !== its &&
          entry.section === "knowledge" &&
          entry.conversation?.id === conversationId)
      )
        await this.#folder.forget(entry.path);
    await this.#folder.dropConversationFolder(conversationId);
    return ok;
  }

  async move(number: number, scope: string): Promise<PersonsOutcome> {
    const snapshot = await this.#folder.read();
    const entry = snapshot.entries.find((one) => one.number === number);
    if (!entry) return refused(`#${number} is no longer kept.`);
    if (entry.section !== "knowledge")
      return refused("Only a Knowledge entry moves to another scope.");
    if (conversationOfScope(scope) && scope !== entry.scope)
      return refused(
        "An entry is kept for a conversation only by that conversation.",
      );
    if (
      !conversationOfScope(scope) &&
      scope !== everythingScope &&
      !snapshot.projects.some((one) => one.id === scope)
    )
      return refused("That project is no longer kept.");
    const full = scope === entry.scope ? undefined : noRoomIn(scope, snapshot);
    if (full) return refused(full);
    await this.#folder.save(
      { ...entryOnly(entry), scope },
      snapshot.projects,
      entry.path,
    );
    return ok;
  }

  async keep(waitingId: string): Promise<PersonsOutcome> {
    const waiting = await this.#folder.ownRecord<MemoryWaiting>(
      "waiting",
      waitingId,
    );
    if (!waiting) return refused("That change is no longer waiting.");
    const snapshot = await this.#folder.read();
    const scope = scopeNow(waiting.scope, snapshot.projects);
    if (!scope) return refused("That project is no longer kept.");
    const before = snapshot.entries.find(
      (entry) => entry.scope === scope && entry.section === waiting.section,
    );
    // Kept already, by a Keep that stopped before letting the change go,
    // or by the person's own hand.
    const there =
      waiting.replaces === undefined &&
      rulesOf(before?.text ?? "").includes(waiting.rule.trim());
    const text = there
      ? before!.text
      : withRule(before?.text ?? "", {
          rule: waiting.rule || undefined,
          replaces: waiting.replaces,
        });
    if (text === undefined)
      return refused(
        `The rule it changes, “${waiting.replaces}”, is no longer there.`,
      );
    const now = this.#now();
    const number =
      before?.number ??
      (await this.#folder.nextNumber(
        Math.max(0, ...snapshot.entries.map((one) => one.number)),
      ));
    await this.#folder.save(
      {
        number,
        scope,
        section: waiting.section,
        title: sectionTitles[waiting.section],
        summary: "",
        text,
        written: now,
        used: now,
        conversation: waiting.conversation,
        held: { ...before?.held, outside: true },
      },
      snapshot.projects,
      before?.path,
    );
    await this.#folder.dropOwnRecord("waiting", waitingId);
    await this.#records.waitingDecided(waitingId);
    return ok;
  }

  async discard(waitingId: string): Promise<PersonsOutcome> {
    if (!(await this.#folder.ownRecord("waiting", waitingId)))
      return refused("That change is no longer waiting.");
    await this.#folder.dropOwnRecord("waiting", waitingId);
    await this.#records.waitingDecided(waitingId);
    return ok;
  }

  /**
   * Takes back one write. With `by`, the write is taken back with the turn
   * that made it, and its number is noted for its conversation.
   */
  async undo(writeId: string, by?: TakenBackBy): Promise<PersonsOutcome> {
    const write = await this.#folder.ownRecord<WriteRecord>("writes", writeId);
    if (!write) return refused("That change is no longer known.");
    if (!this.#records.usable(write)) {
      await this.#folder.dropOwnRecord("writes", writeId);
      return refused("That change is no longer known.");
    }
    const planned = await this.#takeBack(write);
    if (!planned.ok) return planned;
    await planned.apply();
    await this.#folder.dropOwnRecord("writes", writeId);
    if (by && write.conversation && write.kind !== "waiting")
      await this.#taken.note(write.conversation, write.number, by);
    return ok;
  }

  /** Whether `undo` would take the write back now; nothing is changed. */
  async undoable(writeId: string): Promise<PersonsOutcome> {
    const write = await this.#folder.ownRecord<WriteRecord>("writes", writeId);
    if (!write || !this.#records.usable(write))
      return refused("That change is no longer known.");
    const planned = await this.#takeBack(write);
    return planned.ok ? ok : planned;
  }

  /** How the write would be taken back, made only by `apply`, or why it would not be. */
  async #takeBack(write: WriteRecord): Promise<TakingBack> {
    if (write.kind === "waiting")
      return {
        ok: true,
        apply: () => this.#folder.dropOwnRecord("waiting", write.waitingId),
      };
    const snapshot = await this.#folder.read();
    const now = snapshot.entries.find((entry) => entry.number === write.number);
    const changedSince = () =>
      refused(
        `#${write.number} ${now?.title ?? ""} was changed since, so it was left as it is.`.replace(
          "  ",
          " ",
        ),
      );
    if (write.kind === "rule") {
      if (!now) return changedSince();
      const text = ruleTakenBack(now.text, write);
      if (text === undefined) return changedSince();
      return {
        ok: true,
        apply: async () => {
          if (text.trim())
            await this.#folder.save(
              { ...entryOnly(now), text, written: this.#now() },
              snapshot.projects,
              now.path,
            );
          else await this.#folder.forget(now.path);
        },
      };
    }
    if (!unchangedSince(now, write.after)) return changedSince();
    const writtenSince =
      !now &&
      write.before &&
      write.before.section !== "knowledge" &&
      snapshot.entries.find(
        (entry) =>
          entry.scope === write.before!.scope &&
          entry.section === write.before!.section,
      );
    if (writtenSince)
      return refused(
        `${writtenSince.title} was written again since, so the one removed was left out.`,
      );
    const before = write.before;
    if (before) {
      const scope = scopeNow(before.scope, snapshot.projects);
      if (!scope)
        return refused(
          `#${write.number} ${before.title} belonged to a project no longer kept, so it was left out.`,
        );
      return {
        ok: true,
        apply: async () => {
          await this.#folder.save(
            { ...before, scope },
            snapshot.projects,
            now?.path,
          );
        },
      };
    }
    return {
      ok: true,
      apply: async () => {
        if (now) await this.#folder.forget(now.path);
      },
    };
  }
}

type TakingBack =
  | { readonly ok: true; readonly apply: () => Promise<void> }
  | { readonly ok: false; readonly reason: string };

/** Why a line would not fit its list, for Knowledge and a brief, or nothing. */
function lineProblem(
  section: MemoryEntry["section"],
  scope: string,
  number: number,
  title: string,
  summary: string,
  snapshot: Snapshot,
): string | undefined {
  if (!oneLine(title, summary))
    return "A title and a summary are one line each.";
  if (section === "knowledge") return lineTooLong(number, title, summary);
  if (section === "brief")
    return conversationOfScope(scope)
      ? lineTooLong(number, title, summary)
      : projectLineTooLong(number, scopeName(scope, snapshot), summary);
  return undefined;
}
