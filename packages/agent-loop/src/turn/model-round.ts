/**
 * One model round: the request sent, the answer streamed into the conversation
 * behind the model, and its tool calls assembled. ADR 0011. A specialist's
 * round is the same round, gathered without being shown.
 *
 * The model client decides whether a failed request is sent again. What the
 * round owns is taking back what it received from an attempt that failed: no
 * tool runs while a round streams, so that is only text. Text still held
 * behind the model was never shown and goes unseen. Text already shown is
 * withdrawn, and the working note says the answer is starting again.
 */

import {
  estimatedTokens,
  utf8Bytes,
  type ModelReplay,
  type ModelResponseRecord,
  type ModelResponseUsage,
  type ModelRetryRecord,
  type ToolSpec,
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
const revealDelayMs = 5_000;

/** How long the composing note waits before it is repeated. */
const composingIntervalMs = 250;

/**
 * How long the model may send nothing before the conversation says it is
 * waiting. Past what an answer usually takes to start, so the note is the
 * exception; well short of how long a dead connection is waited on, so a
 * person watching is told long before the request is given up and sent again.
 */
const quietAfterMs = 15_000;

/** Shown while nothing arrives: the turn is alive and it is the model's move. */
const waitingForModel = "Waiting for the model";

/** Shown while the model reasons and has said and called nothing yet. */
const thinkingNote = "Thinking";

/**
 * How much one request may reason before it has answered or called anything,
 * in tokens. Several times what a hard step takes a model that then acts, and
 * well short of a request that reasons for half an hour and answers nothing.
 * The same at every reasoning effort: it is already above the reasoning a
 * provider allows one request at its highest.
 */
const longestThoughtTokens = 50_000;

/**
 * The reasoning is counted as it arrives, in bytes, at the most bytes a token
 * has been measured to take, so no model measured is stopped before it has
 * reasoned the limit in its own tokens: DeepSeek V4.1 Flash wrote 4.48 bytes a
 * reasoning token in a 3D run (602,574 bytes for 134,429 tokens), Xiaomi MiMo
 * about 3.
 */
const reasoningBytesPerToken = 4.5;

/**
 * How long after a request the next one is taken to read it from the
 * provider's cache: the shortest any provider here keeps what it cached.
 */
const cacheLifeMs = 5 * 60_000;

/** A request stopped because it reasoned at length without answering or acting. */
export class ThoughtTooLong extends Error {
  constructor() {
    super("The model reasoned at length without answering or acting.");
  }
}

/** A request stopped because the person asked for the answer now. */
export class AnswerNow extends Error {
  constructor() {
    super("The person asked for the answer now.");
  }
}

/** A request stopped because the person had what they added sent now. */
export class SentNow extends Error {
  constructor() {
    super("The person had what they added sent now.");
  }
}

/** Whether a request ended because the person stopped its reasoning. */
const stoppedByPerson = (reason: unknown): reason is AnswerNow | SentNow =>
  reason instanceof AnswerNow || reason instanceof SentNow;

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
  /** What the provider needs back with this round, to keep with it. */
  readonly replay?: ModelReplay;
  /** The provider's count of the request, when it gave one. */
  readonly usage?: ModelUsage;
  readonly assistantId: string;
  /** Set once the answer has appeared in the conversation. */
  readonly assistantSequence?: number;
};

/** The tokens and cost of a usage report, without what the record names. */
function usageOf(usage: ModelUsage): ModelResponseUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.reasoningTokens }),
    ...(usage.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
    ...(usage.estimatedCost === undefined
      ? {}
      : { estimatedCost: usage.estimatedCost }),
  };
}

/** What one attempt at the round gathered. A restart begins a new one. */
class Attempt {
  readonly calls = new Map<number, AssembledToolCall>();
  text = "";
  reasoning = "";
  /** The reasoning's size, counted as it arrives. */
  reasoningBytes = 0;
  finishReason: string | undefined;
  response: ModelResponseRecord | undefined;
  replay: ModelReplay | undefined;
  reportedUsage = false;
  usage: ModelUsage | undefined;
  composingSaidAt = 0;
  /** When this attempt's first words, reasoning or call arrived. */
  firstTokenAt: string | undefined;
}

/**
 * Whose answer a round gathers. A turn's is shown in the conversation as it
 * arrives, with the notes that say it is waiting or starting again. A
 * specialist's is gathered unseen, and what it used is counted as the
 * specialist's.
 */
export type RoundAudience = "conversation" | "specialist";

export class ModelRound {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #shown: boolean;
  /** Told when the lab refuses a request for how many are being sent. */
  readonly #rateLimited: (taskId: string) => void;
  /** What each conversation's last counted request sent, and when. */
  readonly #lastCounted = new Map<
    string,
    { readonly inputTokens: number; readonly at: number }
  >();
  /** The stop of each conversation's request that has only reasoned so far. */
  readonly #reasoning = new Map<string, AbortController>();

  constructor(
    deps: AgentLoopDependencies,
    records: TurnRecords,
    audience: RoundAudience = "conversation",
    rateLimited: (taskId: string) => void = () => {},
  ) {
    this.#deps = deps;
    this.#records = records;
    this.#shown = audience === "conversation";
    this.#rateLimited = rateLimited;
  }

  /**
   * Stops the conversation's request where it has only reasoned so far, for
   * the answer to be asked for again. Says whether there was one to stop.
   */
  answerNow(taskId: string): boolean {
    return this.#stopReasoning(taskId, new AnswerNow());
  }

  /**
   * Stops the same request, for what the person added to be sent with the
   * one that follows.
   */
  sendNow(taskId: string): boolean {
    return this.#stopReasoning(taskId, new SentNow());
  }

  #stopReasoning(taskId: string, why: AnswerNow | SentNow): boolean {
    const thought = this.#reasoning.get(taskId);
    if (!thought || thought.signal.aborted) return false;
    thought.abort(why);
    return true;
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
    const startedAt = this.#deps.now().toISOString();
    // An answer nobody is shown is no message, and takes no message's id.
    const assistantId = this.#shown ? this.#deps.newMessageId() : "";
    let assistantSequence: number | undefined;
    /** Shown characters each restart withdrew, in order. */
    const withdrawn: number[] = [];
    /** A retry or restart note is showing, and goes once new text does. */
    let noting = false;
    const holding = () =>
      new HeldReveal(
        // Nothing is held back from an answer nobody is shown.
        this.#shown ? (this.#deps.revealDelayMs ?? revealDelayMs) : 0,
        async (revealed: Revealed) => {
          if (!owns() || !this.#shown) return;
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
    /** The thinking note is showing, and goes when the answer or a call begins. */
    let thinking = false;
    // The round's own stop, for reasoning that leads nowhere; the turn's
    // stops it too.
    const thought = new AbortController();
    const longestThought =
      this.#deps.longestThoughtTokens ?? longestThoughtTokens;
    /** The waiting note is showing, and goes when anything arrives. */
    let waiting = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const quietAfter = this.#deps.quietAfterMs ?? quietAfterMs;
    /** Says the turn is waiting, should nothing arrive for this long. */
    const listen = (forMs: number) => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        if (!owns() || controller.signal.aborted) return;
        waiting = true;
        thinking = false;
        void this.#note(taskId, waitingForModel).catch(() => undefined);
      }, forMs);
    };

    listen(quietAfter);
    try {
      for await (const event of this.#deps.model.send({
        ...request,
        signal: AbortSignal.any([controller.signal, thought.signal]),
        restartable: true,
      })) {
        if (!owns()) break;
        if (waiting) {
          waiting = false;
          await this.#note(taskId, undefined);
        }
        // The wait before a repeat is counted down already; silence is
        // counted from when the repeat is sent.
        if (
          (event.kind === "restarting" || event.kind === "retrying") &&
          event.reason === "rateLimited"
        )
          this.#rateLimited(taskId);
        listen(
          quietAfter +
            (event.kind === "restarting" || event.kind === "retrying"
              ? event.delayMs
              : 0),
        );
        if (event.kind === "restarting") {
          const shown = reveal.revealed.text.length;
          const recorded = shown + reveal.revealed.reasoning.length;
          await reveal.discard();
          await this.#account(taskId, ledger, request, attempt);
          withdrawn.push(shown);
          if (recorded && this.#shown)
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
          thinking = false;
          this.#reasoning.delete(taskId);
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
        if (!this.#shown) continue;
        if (event.kind === "textDelta" || event.kind === "toolCallDelta") {
          // A call's composing note has already taken the thinking note's place.
          if (thinking && event.kind === "textDelta")
            await this.#note(taskId, undefined);
          thinking = false;
          this.#reasoning.delete(taskId);
          continue;
        }
        if (
          event.kind !== "reasoningDelta" ||
          attempt.text ||
          attempt.calls.size > 0
        )
          continue;
        this.#reasoning.set(taskId, thought);
        if (!thinking) {
          thinking = true;
          await this.#note(taskId, thinkingNote);
        }
        if (attempt.reasoningBytes / reasoningBytesPerToken > longestThought) {
          thought.abort();
          throw new ThoughtTooLong();
        }
      }
      // A stream that ends quietly once stopped was stopped all the same.
      if (stoppedByPerson(thought.signal.reason)) throw thought.signal.reason;
    } catch (error) {
      await reveal.flush().catch(() => undefined);
      await this.#account(taskId, ledger, request, attempt);
      // Whatever a stream ends with once the person stopped its reasoning,
      // that is why it ended; their stopping the turn comes first.
      const asked = thought.signal.reason;
      throw stoppedByPerson(asked) && !controller.signal.aborted
        ? asked
        : error;
    } finally {
      clearTimeout(quiet);
      if (this.#reasoning.get(taskId) === thought)
        this.#reasoning.delete(taskId);
    }
    // A turn that no longer owns the conversation writes nothing more to it.
    if (owns()) await reveal.flush();
    else await reveal.discard();
    await this.#account(taskId, ledger, request, attempt);
    const response = attempt.response && {
      ...attempt.response,
      ...(attempt.response.retries
        ? { retries: shownAtRestarts(attempt.response.retries, withdrawn) }
        : {}),
      startedAt,
      ...(attempt.firstTokenAt ? { firstTokenAt: attempt.firstTokenAt } : {}),
      finishedAt: this.#deps.now().toISOString(),
      ...(attempt.usage ? { usage: usageOf(attempt.usage) } : {}),
    };
    return {
      calls: [...attempt.calls.values()].sort(
        (left, right) => left.index - right.index,
      ),
      text: attempt.text,
      reasoning: attempt.reasoning,
      ...(attempt.replay ? { replay: attempt.replay } : {}),
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
    event: Exclude<ModelEvent, { readonly kind: "retrying" | "restarting" }>,
    attempt: Attempt,
    reveal: HeldReveal,
    ledger: WorkLedger,
  ): Promise<void> {
    if (
      !attempt.firstTokenAt &&
      (event.kind === "reasoningDelta" ||
        event.kind === "textDelta" ||
        event.kind === "toolCallDelta")
    )
      attempt.firstTokenAt = this.#deps.now().toISOString();
    switch (event.kind) {
      case "reasoningDelta":
        attempt.reasoning += event.text;
        attempt.reasoningBytes += utf8Bytes(event.text);
        await reveal.add("reasoning", event.text);
        break;
      case "textDelta":
        attempt.text += event.text;
        await reveal.add("text", event.text);
        break;
      case "toolCallDelta": {
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
         * Zero at first, so the first fragment says so at once: the note is
         * there because nothing else shows for a while, and waiting to show it
         * would only lengthen that silence. After that it is paced, because the
         * note only has to stay true.
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
        break;
      }
      case "usage":
        attempt.reportedUsage = true;
        attempt.usage = event.usage;
        this.#lastCounted.set(taskId, {
          inputTokens: event.usage.inputTokens,
          at: this.#deps.now().getTime(),
        });
        ledger.record(event.usage);
        await this.#deps.host.recordUsage({
          ...event.usage,
          conversationId: taskId,
          purpose: this.#shown ? "turn" : "specialist",
        });
        break;
      case "done":
        attempt.finishReason = event.finishReason;
        attempt.response = event.response;
        attempt.replay = event.replay;
        break;
      default: {
        const unnamed: never = event;
        return unnamed;
      }
    }
  }

  /**
   * An attempt the provider did not account for is estimated, whether it
   * finished or failed: the provider bills what it read and wrote either way.
   * Once any of an answer has arrived the request was served, so the estimate
   * goes in the usage history too, at the price list's prices; a request that
   * nothing came back from is counted against the work limits alone.
   */
  async #account(
    taskId: string,
    ledger: WorkLedger,
    request: RoundRequest,
    attempt: Attempt,
  ): Promise<void> {
    if (attempt.reportedUsage) return;
    const inputTokens = estimatedRequestTokens(request.messages, request.tools);
    const reasoningTokens = Math.ceil(attempt.reasoningBytes / 3);
    const outputTokens =
      reasoningTokens +
      estimatedTokens(
        [...attempt.calls.values()].reduce(
          (written, call) => written + call.name + call.arguments,
          attempt.text,
        ),
      );
    const usage = attempt.firstTokenAt
      ? await this.#deps.model
          .uncounted?.({
            inputTokens,
            outputTokens,
            ...this.#readFromCache(taskId, inputTokens),
            ...(reasoningTokens ? { reasoningTokens } : {}),
          })
          .catch(() => undefined)
      : undefined;
    ledger.estimate(inputTokens + outputTokens, usage?.estimatedCost);
    if (!usage) return;
    await this.#deps.host.recordUsage({
      ...usage,
      conversationId: taskId,
      purpose: this.#shown ? "turn" : "specialist",
    });
  }

  /**
   * What of a request the provider is taken to have read from its cache: all
   * that the conversation's last counted request sent, while a cache would
   * still hold it. A guess, since the provider never said.
   */
  #readFromCache(taskId: string, inputTokens: number) {
    const last = this.#lastCounted.get(taskId);
    if (!last || this.#deps.now().getTime() - last.at > cacheLifeMs) return {};
    return { cacheReadTokens: Math.min(last.inputTokens, inputTokens) };
  }

  async #note(
    taskId: string,
    note: string | undefined,
    retry?: { readonly readyAt: string; readonly count?: string },
  ) {
    // The working note is the turn's; a specialist's waiting is not said there.
    if (!this.#shown) return;
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
