/**
 * One model round: the request sent, the answer streamed into the conversation
 * behind the model, and its tool calls assembled. ADR 0049.
 *
 * The model client decides whether a failed request is sent again. What the
 * round owns is taking back what it received from an attempt that failed: no
 * tool runs while a round streams, so that is only text. Text still held
 * behind the model was never shown and goes unseen. Text already shown is
 * withdrawn, and the working note says the answer is starting again.
 */

import type {
  ModelResponseRecord,
  ModelRetryRecord,
  ToolSpec,
} from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
  ModelUsage,
} from "@zhiyin/model-client";
import { estimatedRequestTokens } from "../context/conversation-context.js";
import { HeldReveal, type Revealed } from "../context/held-reveal.js";
import type { TurnRecords } from "./turn-records.js";
import type { AssembledToolCall } from "./turn-shared.js";
import type { WorkLedger } from "./work-limits.js";
import type { AgentLoopDependencies } from "../dependencies.js";

/**
 * How far the shown answer trails the model. Long enough to absorb the
 * failures that surface soon after output starts; short enough that the wait
 * for the first words is tolerable. The retries recorded on each response show
 * whether it is the right value.
 */
export const revealDelayMs = 5_000;

/** How long the composing note waits before it is repeated. */
const composingIntervalMs = 250;

export type RoundRequest = {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  readonly reasoning?: NonNullable<ModelRequest["reasoning"]>;
};

export type RoundResult = {
  /** Assembled tool calls, in the order the model gave them. */
  readonly calls: AssembledToolCall[];
  readonly text: string;
  readonly reasoning: string;
  readonly finishReason?: string;
  readonly response?: ModelResponseRecord;
  /** The provider's count of the request, when it gave one. */
  readonly usage?: ModelUsage;
  readonly assistantId: string;
  /** Set once the answer has appeared in the conversation. */
  readonly assistantSequence?: number;
};

/** What one attempt at the round gathered. A restart begins a new one. */
class Attempt {
  readonly calls = new Map<number, AssembledToolCall>();
  text = "";
  reasoning = "";
  finishReason: string | undefined;
  response: ModelResponseRecord | undefined;
  reportedUsage = false;
  usage: ModelUsage | undefined;
  composingSaidAt = 0;
}

export class ModelRound {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;

  constructor(deps: AgentLoopDependencies, records: TurnRecords) {
    this.#deps = deps;
    this.#records = records;
  }

  /**
   * Runs the round to its end. A failure the client did not recover is
   * thrown after what was held is shown, so the text that did arrive stays
   * with the failed turn.
   */
  async run(
    taskId: string,
    controller: AbortController,
    ledger: WorkLedger,
    request: RoundRequest,
    owns: () => boolean,
  ): Promise<RoundResult> {
    const assistantId = this.#deps.newMessageId();
    let assistantSequence: number | undefined;
    /** Shown characters each restart withdrew, in order. */
    const withdrawn: number[] = [];
    /** A retry or restart note is showing, and goes once new text does. */
    let noting = false;
    const holding = () =>
      new HeldReveal(
        this.#deps.revealDelayMs ?? revealDelayMs,
        async (revealed: Revealed) => {
          if (!owns()) return;
          assistantSequence ??= this.#records.nextTimelineSequence(
            this.#records.task(taskId),
          );
          if (noting) {
            noting = false;
            await this.#note(taskId, undefined);
          }
          await this.#records.showAssistantProgress(
            taskId,
            assistantId,
            revealed.text,
            assistantSequence,
            ...(revealed.reasoning
              ? [
                  {
                    text: revealed.reasoning,
                    status: revealed.text
                      ? ("complete" as const)
                      : ("streaming" as const),
                  },
                ]
              : []),
          );
        },
      );
    let attempt = new Attempt();
    let reveal = holding();

    try {
      for await (const event of this.#deps.model.send({
        ...request,
        signal: controller.signal,
        restartable: true,
      })) {
        if (!owns()) break;
        if (event.kind === "restarting") {
          const shown = reveal.revealed.text.length;
          const recorded = shown + reveal.revealed.reasoning.length;
          await reveal.discard();
          this.#account(ledger, request, attempt);
          withdrawn.push(shown);
          if (recorded)
            await this.#records.withdrawAssistantMessage(taskId, assistantId);
          await this.#note(
            taskId,
            shown
              ? "The answer was interrupted. Starting it again"
              : waitingNote(event.reason),
            {
              readyAt: new Date(Date.now() + event.delayMs).toISOString(),
              count: `${event.restart} of ${event.maximumRestarts}`,
            },
          );
          noting = true;
          attempt = new Attempt();
          reveal = holding();
          continue;
        }
        if (event.kind === "retrying") {
          await this.#note(taskId, waitingNote(event.reason), {
            readyAt: new Date(Date.now() + event.delayMs).toISOString(),
            count: `${event.attempt} of ${event.maximumAttempts}`,
          });
          noting = true;
          continue;
        }
        await this.#receive(taskId, event, attempt, reveal, ledger);
      }
    } catch (error) {
      await reveal.flush().catch(() => undefined);
      this.#account(ledger, request, attempt);
      throw error;
    }
    // A turn that no longer owns the conversation writes nothing more to it.
    if (owns()) await reveal.flush();
    else await reveal.discard();
    this.#account(ledger, request, attempt);
    const response = attempt.response && {
      ...attempt.response,
      ...(attempt.response.retries
        ? { retries: shownAtRestarts(attempt.response.retries, withdrawn) }
        : {}),
    };
    return {
      calls: [...attempt.calls.values()].sort(
        (left, right) => left.index - right.index,
      ),
      text: attempt.text,
      reasoning: attempt.reasoning,
      ...(attempt.finishReason === undefined
        ? {}
        : { finishReason: attempt.finishReason }),
      ...(response ? { response } : {}),
      ...(attempt.usage ? { usage: attempt.usage } : {}),
      assistantId,
      ...(assistantSequence === undefined ? {} : { assistantSequence }),
    };
  }

  async #receive(
    taskId: string,
    event: ModelEvent,
    attempt: Attempt,
    reveal: HeldReveal,
    ledger: WorkLedger,
  ): Promise<void> {
    if (event.kind === "reasoningDelta") {
      attempt.reasoning += event.text;
      await reveal.add("reasoning", event.text);
    } else if (event.kind === "textDelta") {
      attempt.text += event.text;
      await reveal.add("text", event.text);
    } else if (event.kind === "toolCallDelta") {
      const current = attempt.calls.get(event.index) ?? {
        index: event.index,
        callId: "",
        name: "",
        arguments: "",
      };
      if (event.callId) current.callId = event.callId;
      if (event.name) current.name += event.name;
      if (event.argumentsDelta) current.arguments += event.argumentsDelta;
      attempt.calls.set(event.index, current);
      /*
       * Zero at first, so the first fragment says so at once: the whole
       * complaint is that nothing happens for a while, and a delay before
       * admitting to a delay is the same silence with extra steps. After that
       * it is paced, because the note only has to stay true.
       */
      if (Date.now() - attempt.composingSaidAt >= composingIntervalMs) {
        attempt.composingSaidAt = Date.now();
        await this.#note(
          taskId,
          current.name
            ? `Composing a request: ${this.#records.humanizeIdentifier(current.name)}`
            : "Composing a request",
        );
      }
    } else if (event.kind === "usage") {
      attempt.reportedUsage = true;
      attempt.usage = event.usage;
      ledger.record(event.usage);
      await this.#deps.host.recordUsage(event.usage);
    } else if (event.kind === "done") {
      attempt.finishReason = event.finishReason;
      attempt.response = event.response;
    }
  }

  /**
   * An attempt the provider did not account for is estimated, whether it
   * finished or failed: the provider bills what it read and wrote either way.
   */
  #account(ledger: WorkLedger, request: RoundRequest, attempt: Attempt) {
    if (attempt.reportedUsage) return;
    ledger.estimate(
      estimatedRequestTokens(
        [
          ...request.messages,
          {
            role: "assistant",
            content: `${attempt.reasoning}\n${attempt.text}`,
          },
        ],
        request.tools,
      ),
    );
  }

  async #note(
    taskId: string,
    note: string | undefined,
    retry?: { readonly readyAt: string; readonly count?: string },
  ) {
    await this.#records.showWorking(
      taskId,
      note,
      this.#records.visibleSteps(taskId),
      retry,
    );
  }
}

/**
 * The client's record of each attempt, with what the person saw. A restart
 * whose text was still held behind the model withdrew nothing anyone saw, so it
 * is recorded as silent; one that withdrew shown text says how much.
 */
function shownAtRestarts(
  retries: readonly ModelRetryRecord[],
  withdrawn: readonly number[],
): ModelRetryRecord[] {
  let restart = 0;
  return retries.map((retry) => {
    if (retry.kind !== "restart") return retry;
    const shown = withdrawn[restart++] ?? 0;
    return shown
      ? { ...retry, discardedCharacters: shown }
      : { ...retry, kind: "silent" };
  });
}

function waitingNote(reason: string): string {
  const who =
    reason === "rateLimited" || reason === "modelUnavailable"
      ? "The model is busy"
      : "The model could not be reached";
  return `${who}. Trying again`;
}
