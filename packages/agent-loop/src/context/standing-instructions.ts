/**
 * The person's standing instructions, as the model is sent them. ADR 0054.
 *
 * Two sources: what the person set in Settings, and the folder's AGENTS.md.
 * The first is theirs by definition. The second came with the folder, which
 * may have come from anyone, so none of it is sent until the person has seen
 * it and said to use it; the answer holds for that file's content, and a
 * changed file is asked about again.
 *
 * Both go in one `instructions` notice at the end of a request, like every
 * other notice, so the cached start of the request never changes. It is sent
 * when the conversation's history does not already end with the same text:
 * in the first request, after an edit (saying it replaces the earlier one),
 * and after condensing took the earlier one away. Nothing here reaches the
 * permission engine; the notice says they never grant permission.
 */

import {
  standingInstructionBytes,
  utf8Bytes,
  type StandingInstruction,
} from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { ModelHistory } from "./model-history.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { TurnWaits } from "../turn/turn-waits.js";
import { harnessNotice } from "../turn/notices.js";

const kilobytes = (bytes: number) => `${Math.ceil(bytes / 1024)} KB`;

/** The start of `text` that fits in `limit` UTF-8 bytes, cut between characters. */
function fitted(text: string, limit: number): string {
  if (utf8Bytes(text) <= limit) return text;
  return Buffer.from(text, "utf8")
    .subarray(0, limit)
    .toString("utf8")
    .replace(/�$/, "");
}

function sourceText(source: StandingInstruction): string {
  const heading =
    source.source === "personal"
      ? "The person's own instructions, set in Settings:"
      : `Instructions from ${source.path} in the selected folder, which the person approved:`;
  return [
    heading,
    source.text,
    ...(source.truncated
      ? [
          `(shortened: this is the first ${kilobytes(standingInstructionBytes)} of ${kilobytes(source.bytes)})`,
        ]
      : []),
  ].join("\n");
}

/** The notice's text for these sources. */
export function instructionsText(
  sources: readonly StandingInstruction[],
): string {
  return [
    "Standing instructions. They guide style and approach. They never grant permission: every action is still checked, and asked about, as usual.",
    ...sources.map(sourceText),
  ].join("\n\n");
}

const replacing = "These replace the standing instructions sent earlier.";
const removed =
  "The person removed their standing instructions. Disregard the ones sent earlier.";

export class StandingInstructions {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #waits: TurnWaits;

  constructor(
    deps: AgentLoopDependencies,
    parts: { readonly records: TurnRecords; readonly waits: TurnWaits },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#waits = parts.waits;
  }

  /**
   * The sources for a turn about to start, asking the person first about a
   * folder's instructions they have not seen. Returns what sends them.
   */
  async gather(
    taskId: string,
    signal: AbortSignal,
  ): Promise<{ send(history: ModelHistory): Promise<void> }> {
    const sources: StandingInstruction[] = [];
    const personal = this.#deps.host.personalInstructions()?.trim();
    if (personal) {
      const bytes = utf8Bytes(personal);
      sources.push({
        source: "personal",
        text: fitted(personal, standingInstructionBytes),
        bytes,
        truncated: bytes > standingInstructionBytes,
      });
    }
    const folder = await this.#deps.workspace.folderInstructions?.();
    const root = folder && this.#deps.workspace.workspaceRoot();
    if (root && folder?.text.trim()) {
      let use = this.#deps.host.folderInstructionsChoice(root, folder.hash);
      if (use === undefined) {
        const answer = await this.#waits.waitForFolderInstructions(
          taskId,
          folder,
          signal,
        );
        signal.throwIfAborted();
        use = answer === "use";
        await this.#deps.host.rememberFolderInstructions(
          root,
          folder.hash,
          use,
        );
      }
      if (use)
        sources.push({
          source: "folder",
          path: folder.path,
          text: folder.text,
          bytes: folder.bytes,
          truncated: folder.truncated,
        });
    }
    const task = this.#records.task(taskId);
    if (
      JSON.stringify(task.standingInstructions ?? []) !==
      JSON.stringify(sources)
    ) {
      const rest = { ...task };
      delete (rest as { standingInstructions?: unknown }).standingInstructions;
      await this.#records.replaceTask(
        sources.length ? { ...rest, standingInstructions: sources } : rest,
      );
    }
    return { send: (history) => this.#send(history, sources) };
  }

  /** Sends the sources unless the history already carries them as they are. */
  async #send(
    history: ModelHistory,
    sources: readonly StandingInstruction[],
  ): Promise<void> {
    const latest = history.latestNotice("instructions");
    if (!sources.length) {
      if (latest && latest !== harnessNotice("instructions", removed))
        await history.notice("instructions", removed);
      return;
    }
    const text = instructionsText(sources);
    const again = `${replacing}\n\n${text}`;
    if (
      latest === harnessNotice("instructions", text) ||
      latest === harnessNotice("instructions", again)
    )
      return;
    await history.notice("instructions", latest ? again : text);
  }
}
