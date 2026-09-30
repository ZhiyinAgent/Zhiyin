/**
 * What the model has been sent of a conversation, kept so every request starts
 * with the whole of the one before it.
 *
 * A provider reuses its cached copy of a request's start only while the start
 * is the same, byte for byte. So the conversation is sent as it was first
 * sent — the person's messages, the model's words and tool calls, each result
 * as the model received it, Zhiyin's notices — in the order it happened, turn
 * after turn and after the app restarts, and new material only ever goes at
 * the end.
 *
 * Four things change what was already sent, each on purpose: a condensing
 * replaces what it condenses with its summary; older tool results are
 * cleared to a receipt many at a time once they pile up; pictures past the
 * most one request carries are let go of several at a time, so the start
 * changes once rather than with every new picture; and a proposal a tool
 * refused quietly is taken back out once the tool succeeds. That last kind is
 * never stored at all: it was a correction between the model and a tool, not
 * part of the conversation.
 */

import type {
  ModelHistoryEntry,
  StoredPicture,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelMessage, ModelToolCall } from "@zhiyin/model-client";
import { modelText } from "./attachments.js";
import { compactedSummaryMessage } from "./conversation-context.js";
import { harnessNotice, type NoticeKind } from "../turn/notices.js";
import { picturesLetGo } from "../turn/turn-pictures.js";
import { withdrawCalls } from "../tools/quiet-failures.js";

/**
 * How many messages carrying pictures one request may hold, and how many are
 * kept when that is passed. Letting go of several at once breaks the cached
 * start once for the next few pictures instead of once for each of them.
 */
const picturesKeptInOneRequest = 8;
const picturesKeptAfterLettingGo = 4;

type Item = {
  message: ModelMessage;
  /** The stored entry this is sent from; none for a quiet correction. */
  entryId?: string;
};

type Round = {
  readonly entryId: string;
  readonly item: Item;
  readonly messageId: string | undefined;
  stored: boolean;
};

export type SentPicture = {
  readonly mediaType: string;
  readonly data: string;
  /** Where the picture is stored; empty when it could not be. */
  readonly source: string;
};

export type HistoryOptions = {
  readonly newId: () => string;
  readonly readPicture: (source: string) => Promise<StoredPicture>;
  readonly save: (entries: readonly ModelHistoryEntry[]) => Promise<void>;
};

function isStoredMessage(
  entry: ModelHistoryEntry,
): entry is Extract<ModelHistoryEntry, { kind: "message" | "calls" }> {
  return entry.kind === "message" || entry.kind === "calls";
}

function carriesPictures(message: ModelMessage): boolean {
  return (
    message.role === "user" &&
    typeof message.content !== "string" &&
    message.content.some((part) => part.kind === "image")
  );
}

export class ModelHistory {
  readonly #entries: ModelHistoryEntry[];
  readonly #items: Item[];
  readonly #options: HistoryOptions;
  /** Calls whose results are stored, and so are stored themselves. */
  readonly #kept = new Set<string>();
  #round: Round | undefined;

  private constructor(
    entries: ModelHistoryEntry[],
    items: Item[],
    options: HistoryOptions,
  ) {
    this.#entries = entries;
    this.#items = items;
    this.#options = options;
  }

  /**
   * The conversation as it was sent, with any message written since added at
   * the end: the person's new message, or an answer that ended a turn.
   */
  static async open(
    task: WorkspaceTask,
    options: HistoryOptions,
  ): Promise<ModelHistory> {
    const entries = [...(task.modelHistory ?? [])];
    const sent = new Set(
      entries.flatMap((entry) =>
        "messageId" in entry && entry.messageId ? [entry.messageId] : [],
      ),
    );
    const unsent = task.messages.filter(
      (message) =>
        !sent.has(message.id) &&
        (message.role !== "assistant" || message.text.trim()),
    );
    for (const message of unsent)
      entries.push({
        id: options.newId(),
        kind: "message",
        messageId: message.id,
      });
    if (unsent.length) await options.save([...entries]);

    const messages = new Map(
      task.messages.map((message) => [message.id, message]),
    );
    const items: Item[] = [];
    const summary = compactedSummaryMessage(task);
    if (summary) items.push({ message: summary });
    for (const entry of entries.slice(firstAfterCondensing(task, entries))) {
      const message = await sentMessage(entry, messages, options.readPicture);
      if (message) items.push({ message, entryId: entry.id });
    }
    return new ModelHistory(entries, items, options);
  }

  /** What follows the fixed start of every request. */
  messages(): readonly ModelMessage[] {
    return this.#items.map((item) => item.message);
  }

  /**
   * Where a kept tail may begin: before a message, a notice or a round's
   * calls, never between a call and its result or a result and its pictures.
   */
  boundaries(): number[] {
    const kinds = new Map(this.#entries.map((entry) => [entry.id, entry.kind]));
    return this.#items.flatMap((item, index) => {
      const kind = item.entryId && kinds.get(item.entryId);
      return kind === "message" || kind === "notice" || kind === "calls"
        ? [index]
        : [];
    });
  }

  /**
   * The last stored entry before the item at `index`, and the last message
   * entry at or before that: the condensing checkpoint for a tail from there.
   */
  checkpointBefore(
    index: number,
  ): { readonly entryId: string; readonly messageId?: string } | undefined {
    const entryId = this.#items
      .slice(0, index)
      .findLast((item) => item.entryId)?.entryId;
    if (!entryId) return undefined;
    const through = this.#entries.findIndex((entry) => entry.id === entryId);
    const message = this.#entries
      .slice(0, through + 1)
      .findLast(
        (entry) => isStoredMessage(entry) && entry.messageId !== undefined,
      );
    return {
      entryId,
      ...(message && isStoredMessage(message) && message.messageId
        ? { messageId: message.messageId }
        : {}),
    };
  }

  /**
   * Stored results, each with how many complete rounds came after the round
   * it answered; a quiet one is never stored and never listed.
   */
  results(): {
    readonly entryId: string;
    readonly content: string;
    readonly roundsAfter: number;
  }[] {
    const rounds = this.#items.flatMap((item, index) =>
      item.message.role === "assistant" && item.message.toolCalls?.length
        ? [index]
        : [],
    );
    return this.#items.flatMap((item, index) => {
      if (item.message.role !== "tool" || !item.entryId) return [];
      const round = rounds.findLastIndex((start) => start < index);
      return [
        {
          entryId: item.entryId,
          content: item.message.content,
          roundsAfter: rounds.length - 1 - round,
        },
      ];
    });
  }

  /** Results replaced by what stands for them, stored in one write. */
  async replaceResults(
    replacements: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (!replacements.size) return;
    for (const item of this.#items) {
      const content = item.entryId && replacements.get(item.entryId);
      if (
        content === undefined ||
        content === "" ||
        item.message.role !== "tool"
      )
        continue;
      item.message = { ...item.message, content };
    }
    for (const [index, entry] of this.#entries.entries()) {
      const content = replacements.get(entry.id);
      if (entry.kind === "result" && content)
        this.#entries[index] = { ...entry, content };
    }
    await this.#save();
  }

  async notice(
    kind: NoticeKind,
    text: string,
    messageId?: string,
  ): Promise<void> {
    const content = harnessNotice(kind, text);
    await this.#add({ role: "user", content }, (id) => ({
      id,
      kind: "notice",
      content,
      ...(messageId ? { messageId } : {}),
    }));
  }

  /** The content of the latest notice of this kind still being sent. */
  latestNotice(kind: NoticeKind): string | undefined {
    const opening = harnessNotice(kind, "").replace(/<\/zhiyin-notice>$/, "");
    return this.#items
      .map((item) => item.message)
      .findLast(
        (message) =>
          message.role === "user" &&
          typeof message.content === "string" &&
          message.content.startsWith(opening),
      )?.content as string | undefined;
  }

  /**
   * The model's words and calls in one round. Stored with the first result
   * that is, so a call is never kept without its answer.
   */
  round(text: string, calls: readonly ModelToolCall[], messageId?: string) {
    const item: Item = {
      message: { role: "assistant", content: text, toolCalls: [...calls] },
    };
    this.#items.push(item);
    this.#round = {
      entryId: this.#options.newId(),
      item,
      messageId,
      stored: false,
    };
  }

  /** The arguments that ran, in place of the draft the model wrote. */
  async rewriteCall(callId: string, args: string): Promise<void> {
    for (const item of this.#items) {
      const message = item.message;
      if (message.role !== "assistant" || !message.toolCalls) continue;
      if (
        !message.toolCalls.some(
          (call) => call.id === callId && call.arguments !== args,
        )
      )
        continue;
      item.message = {
        ...message,
        toolCalls: message.toolCalls.map((call) =>
          call.id === callId ? { ...call, arguments: args } : call,
        ),
      };
      if (this.#kept.has(callId)) await this.#storeRound();
    }
  }

  /** A tool's answer. A quiet one is sent until taken back, and never stored. */
  async result(
    call: { readonly callId: string; readonly name: string },
    content: string,
    quiet: boolean,
  ): Promise<void> {
    const message: ModelMessage = {
      role: "tool",
      toolCallId: call.callId,
      name: call.name,
      content,
    };
    if (quiet) {
      this.#items.push({ message });
      return;
    }
    this.#kept.add(call.callId);
    const entryId = this.#options.newId();
    this.#items.push({ message, entryId });
    this.#upsertRound();
    this.#entries.push({
      id: entryId,
      kind: "result",
      callId: call.callId,
      name: call.name,
      content,
    });
    await this.#save();
  }

  /** Keeps the round's words when none of its calls were kept. */
  async endRound(): Promise<void> {
    const round = this.#round;
    if (round && !round.stored && round.item.message.content.length)
      await this.#storeRound();
    this.#round = undefined;
  }

  /** Takes quietly refused proposals back out of what is sent. */
  forget(callIds: ReadonlySet<string>): void {
    withdrawCalls(
      this.#items,
      callIds,
      (item) => item.message,
      (item, message) => {
        item.message = message;
        return item;
      },
    );
  }

  /** Pictures sent as themselves, after the result that produced them. */
  async pictures(
    text: string,
    pictures: readonly SentPicture[],
  ): Promise<void> {
    await this.#add(
      {
        role: "user",
        content: [
          { kind: "text", text },
          ...pictures.map((picture) => ({
            kind: "image" as const,
            mediaType: picture.mediaType,
            data: picture.data,
          })),
        ],
      },
      (id) => ({
        id,
        kind: "pictures",
        text,
        pictures: pictures.map(({ mediaType, source }) => ({
          mediaType,
          source,
        })),
      }),
    );
    await this.#letGoOfOlderPictures();
  }

  async #letGoOfOlderPictures(): Promise<void> {
    const carrying = this.#items.filter((item) =>
      carriesPictures(item.message),
    );
    if (carrying.length <= picturesKeptInOneRequest) return;
    for (const item of carrying.slice(0, -picturesKeptAfterLettingGo)) {
      const content = item.message.content;
      const gone =
        typeof content === "string"
          ? 0
          : content.filter((part) => part.kind === "image").length;
      const text = picturesLetGo(gone);
      item.message = { role: "user", content: [{ kind: "text", text }] };
      const index = this.#entries.findIndex(
        (entry) => entry.id === item.entryId,
      );
      if (index >= 0)
        this.#entries[index] = {
          id: item.entryId as string,
          kind: "pictures",
          text,
          pictures: [],
        };
    }
    await this.#save();
  }

  async #add(
    message: ModelMessage,
    entry: (id: string) => ModelHistoryEntry,
  ): Promise<void> {
    const entryId = this.#options.newId();
    this.#items.push({ message, entryId });
    this.#entries.push(entry(entryId));
    await this.#save();
  }

  /** Writes the round's entry as its message now stands, keeping only kept calls. */
  #upsertRound(): void {
    const round = this.#round;
    if (!round) return;
    const message = round.item.message;
    if (message.role !== "assistant") return;
    round.item.entryId = round.entryId;
    const entry: ModelHistoryEntry = {
      id: round.entryId,
      kind: "calls",
      ...(round.messageId ? { messageId: round.messageId } : {}),
      text: message.content,
      calls: (message.toolCalls ?? []).filter((call) =>
        this.#kept.has(call.id),
      ),
    };
    const index = this.#entries.findIndex((item) => item.id === round.entryId);
    if (index >= 0) this.#entries[index] = entry;
    else this.#entries.push(entry);
    round.stored = true;
  }

  async #storeRound(): Promise<void> {
    this.#upsertRound();
    await this.#save();
  }

  async #save(): Promise<void> {
    await this.#options.save([...this.#entries]);
  }
}

/**
 * Where the conversation resumes after its condensed part: the first entry
 * that sends a message the condensing did not cover.
 */
function firstAfterCondensing(
  task: WorkspaceTask,
  entries: readonly ModelHistoryEntry[],
): number {
  if (!task.compaction) return 0;
  const throughEntry = task.compaction.throughEntryId
    ? entries.findIndex((entry) => entry.id === task.compaction?.throughEntryId)
    : -1;
  if (throughEntry >= 0) return throughEntry + 1;
  const through = task.messages.findIndex(
    (message) => message.id === task.compaction?.throughMessageId,
  );
  if (through < 0) return 0;
  const kept = new Set(task.messages.slice(through + 1).map(({ id }) => id));
  const first = entries.findIndex(
    (entry) =>
      isStoredMessage(entry) &&
      entry.messageId !== undefined &&
      kept.has(entry.messageId),
  );
  return first < 0 ? entries.length : first;
}

/** One entry as it is sent, or nothing when what it sends is gone. */
async function sentMessage(
  entry: ModelHistoryEntry,
  messages: ReadonlyMap<string, WorkspaceTask["messages"][number]>,
  readPicture: HistoryOptions["readPicture"],
): Promise<ModelMessage | undefined> {
  switch (entry.kind) {
    case "message": {
      const message = messages.get(entry.messageId);
      return message && { role: message.role, content: modelText(message) };
    }
    case "calls":
      return {
        role: "assistant",
        content: entry.text,
        toolCalls: entry.calls.map(({ id, name, arguments: args }) => ({
          id,
          name,
          arguments: args,
        })),
      };
    case "result":
      return {
        role: "tool",
        toolCallId: entry.callId,
        name: entry.name,
        content: entry.content,
      };
    case "notice":
      return { role: "user", content: entry.content };
    case "pictures": {
      const parts = await Promise.all(
        entry.pictures.map(async (picture) => {
          const stored = await readPicture(picture.source).catch(() => ({
            status: "missing" as const,
            reason: "It could not be read.",
          }));
          return stored.status === "ready"
            ? {
                kind: "image" as const,
                mediaType: picture.mediaType,
                data: stored.data,
              }
            : {
                kind: "text" as const,
                text: harnessNotice(
                  "picture",
                  `A picture shown here is no longer stored. ${stored.reason}`,
                ),
              };
        }),
      );
      return {
        role: "user",
        content: [{ kind: "text", text: entry.text }, ...parts],
      };
    }
  }
}
