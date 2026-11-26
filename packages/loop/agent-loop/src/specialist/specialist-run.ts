/**
 * One specialist run's rounds, from its first request to its report: each
 * request held to the conversation's budget, recovered from as a turn's is
 * where a specialist can be, its calls answered as a turn's are within its
 * role, and its report taken only when sent on its own.
 */

import type {
  ModelResponseRecord,
  SpecialistDefinition,
  SpecialistHandoff,
  SpecialistTranscriptEntry,
  ToolOwner,
  ToolSpec,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ModelMessage, TokenLimitDetail } from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "../dependencies.js";
import { resultLimits, RoundResults } from "../context/result-size.js";
import { MemoryCalls } from "../memory/memory-calls.js";
import type { ConversationMemory } from "../memory/conversation-memory.js";
import { RoundAnswers, type RoundRules } from "../round/round-answers.js";
import { QuietFailures } from "../tools/quiet-failures.js";
import { refusal } from "../tools/refusals.js";
import type { ToolCalls } from "../tools/tool-calls.js";
import { readToolInput } from "../tools/tool-input.js";
import {
  ModelRound,
  ThoughtTooLong,
  withLeastReasoning,
  type RoundResult,
} from "../turn/model-round.js";
import { toolOutput } from "../turn/notices.js";
import { PictureSending } from "../turn/picture-sending.js";
import { namedBySpecialist } from "../turn/turn-offering.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { stoppedTwiceForReasoning } from "../turn/turn-recovery.js";
import {
  answerableCalls,
  maximumQuietRetries,
  namelessCallFailure,
  protocolCall,
  refusedAsTooLong,
  type AssembledToolCall,
} from "../turn/turn-shared.js";
import type { WorkLedger } from "../turn/work-limits.js";
import {
  finishSpecialistTool,
  SpecialistMessages,
  type TaskPicture,
} from "./specialist-messages.js";

/** What running a specialist's rounds uses. */
export type SpecialistRunDependencies = Pick<
  AgentLoopDependencies,
  | "afterCalls"
  | "host"
  | "kept"
  | "memory"
  | "newMessageId"
  | "now"
  | "pictures"
  | "recordDefect"
>;

/** What a specialist run is made of, beside its dependencies. */
export type SpecialistRunParts = {
  readonly records: TurnRecords;
  readonly round: ModelRound;
  readonly answers: RoundAnswers;
  readonly toolCalls: ToolCalls;
  /** Memory, which a specialist reads and never writes (ADR 0026). */
  readonly memory: ConversationMemory;
  /** The size the conversation's requests are kept under. */
  readonly budget: (taskId: string) => number;
  /** Told of a request refused as too long, to plan with less. */
  readonly refused: (said: TokenLimitDetail, estimated: number) => void;
};

/**
 * Whose word that a tool only reads a read specialist takes: the app's own
 * code, and a connector's declaration in its plugin, which the connection
 * feature carries onto the tool. A server's annotations about itself never
 * reach `access`.
 */
const readingOwners = new Set<ToolOwner | undefined>(["built-in", "mcp"]);

/** What a finish without a usable report is answered. */
const noReport = refusal(
  "tool",
  "The report was missing or empty.",
  "Call finish_specialist again with your whole report as one Markdown text in report.",
);

/** What a specialist that ended in words alone is told, once. */
const reportInWords =
  "You ended without calling finish_specialist, so nothing reached the main agent. Call finish_specialist now with your whole report as one Markdown text in report; what you wrote above can be that report.";

/**
 * What a specialist whose request was stopped for reasoning at length is told
 * when it is asked again. It has no person to ask: a round that neither acts
 * nor finishes fails it.
 */
const specialistDecidesNow =
  "Your last request was stopped: you reasoned at length without calling a tool, and that reasoning is gone. Do not start the analysis over. Decide with what you know now: call a tool, or call finish_specialist with what you have found.";

function handoff(value: unknown): SpecialistHandoff | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const report = (value as Record<string, unknown>)["report"];
  return typeof report === "string" && report.trim()
    ? { report: report.trim() }
    : undefined;
}

export class SpecialistRun {
  readonly #deps: SpecialistRunDependencies;
  readonly #parts: SpecialistRunParts;
  readonly #taskId: string;
  readonly #runId: string;
  readonly #specialist: SpecialistDefinition;
  /** The tools the turn offers, its role's and the rest. */
  readonly #offered: readonly ToolSpec[];
  readonly #ownerOf: (name: string) => ToolOwner | undefined;
  readonly #controller: AbortController;
  readonly #ledger: WorkLedger;
  readonly #messages: SpecialistMessages;
  readonly #quiet = new QuietFailures();
  /** Memory as the run reads it, once it is offered. */
  #memory: MemoryCalls | undefined;
  /** The last request was stopped for reasoning at length. */
  #overthought = false;
  readonly #leastReasoning: boolean;
  /** It was asked to report now and did not. */
  #unreported = false;
  /** It ended in words alone once, and was asked for its report. */
  #endedInWords = false;
  /** The record of each of its requests that ended with one, in order. */
  readonly #responses: ModelResponseRecord[] = [];

  constructor(
    deps: SpecialistRunDependencies,
    parts: SpecialistRunParts,
    run: {
      readonly taskId: string;
      readonly runId: string;
      readonly specialist: SpecialistDefinition;
      readonly task: string;
      /** Pictures handed over with its task, each with where it is stored. */
      readonly pictures?: readonly TaskPicture[];
      /** Zhiyin started it, not the main agent. */
      readonly fromZhiyin?: boolean;
      /** Each of its requests asks for the least reasoning the model allows. */
      readonly leastReasoning?: boolean;
      readonly tools: readonly ToolSpec[];
      readonly ownerOf: (name: string) => ToolOwner | undefined;
      /** The start of its requests, naming the tools it has. */
      readonly start: (tools: readonly ToolSpec[]) => readonly ModelMessage[];
      readonly controller: AbortController;
      readonly ledger: WorkLedger;
    },
  ) {
    this.#deps = deps;
    this.#parts = parts;
    this.#taskId = run.taskId;
    this.#runId = run.runId;
    this.#specialist = run.specialist;
    this.#offered = run.tools;
    this.#ownerOf = run.ownerOf;
    this.#controller = run.controller;
    this.#ledger = run.ledger;
    this.#leastReasoning = run.leastReasoning === true;
    // Each tool as its own code describes it, which a call is checked
    // against; offered with the purpose every call gives (ADR 0014).
    const tools = run.tools.filter(
      (tool) =>
        // The space beside the conversation is the main agent's to give
        // back; a specialist never had it.
        !tool.conversationOnly &&
        (!run.specialist.tools || namedBySpecialist(run.specialist, tool)) &&
        (run.specialist.access !== "read" ||
          (readingOwners.has(run.ownerOf(tool.name)) &&
            tool.access === "read")),
    );
    this.#messages = new SpecialistMessages(deps, {
      taskId: run.taskId,
      runId: run.runId,
      budget: () => parts.budget(run.taskId),
      // Its start names the tools it has, and no other (ADR 0016).
      fixedMessages: run.start(tools),
      specialist: run.specialist,
      task: run.task,
      ...(run.pictures ? { pictures: run.pictures } : {}),
      ...(run.fromZhiyin ? { fromZhiyin: true } : {}),
      tools,
    });
  }

  /** It was asked for its report and did not send one. */
  get unreported(): boolean {
    return this.#unreported;
  }

  /** What it said and was answered, and what each of its requests used. */
  get kept(): {
    readonly transcript: readonly SpecialistTranscriptEntry[];
    readonly modelResponses: readonly ModelResponseRecord[];
  } {
    return {
      transcript: this.#messages.transcript,
      modelResponses: [...this.#responses],
    };
  }

  /** Runs rounds until the specialist reports; anything else ends it with an error. */
  async run(): Promise<SpecialistHandoff> {
    await this.#readMemory();
    for (;;) {
      const answered = await this.#ask();
      if (!answered) continue;
      this.#overthought = false;
      this.#controller.signal.throwIfAborted();
      const report = await this.#finish(answered);
      if (report === "again") continue;
      if (report) return report;
      await this.#answer(answered);
    }
  }

  /**
   * What memory holds, as the conversation's model was sent it: data. It
   * reads memory; what it finds worth keeping goes in its report.
   */
  async #readMemory(): Promise<void> {
    const { memory, records } = this.#parts;
    const known = await memory.knownFor(this.#taskId);
    if (known) await this.#messages.notice("memory", known);
    const offered = await memory.offered(
      records.task(this.#taskId),
      "specialist",
    );
    this.#messages.offerFirst(offered);
    this.#memory = new MemoryCalls(memory, {
      taskId: this.#taskId,
      offered,
      writer: { outsideTurn: false, specialistRunId: this.#runId },
    });
  }

  /**
   * One request, held to the conversation's budget as every request is: one
   * that would pass it asks for the report instead. Nothing comes back from a
   * request that failed and was recovered from: the run asks again.
   */
  async #ask(): Promise<RoundResult | undefined> {
    const messages = this.#messages;
    const offered = messages.advertised();
    const sent = messages.parts(offered);
    const size = messages.size(sent);
    if (
      !messages.wrappingUp &&
      size.tokens > this.#parts.budget(this.#taskId)
    ) {
      await messages.wrapUp("context");
      return undefined;
    }
    // The same round a turn runs, gathered without being shown, and asked
    // again as a turn's is when it reasons at length.
    const request = messages.request(
      this.#parts.records.task(this.#taskId),
      offered,
    );
    const answered = await this.#parts.round
      .run(
        this.#taskId,
        this.#controller,
        this.#ledger,
        this.#overthought || this.#leastReasoning
          ? withLeastReasoning(request, this.#deps.host.leastReasoning())
          : request,
        () => !this.#controller.signal.aborted,
      )
      .catch(async (error: unknown) => {
        await this.#recover(error, sent, size);
        return undefined;
      });
    if (answered?.usage) messages.counted(sent, answered.usage);
    if (answered?.response) this.#responses.push(answered.response);
    return answered;
  }

  /**
   * What a failed request is recovered from: one stopped for reasoning at
   * length, asked once to decide now, and one refused as too long, asked
   * once, with less on offer, for the report it has, and fitted again once.
   * Everything else is thrown on.
   */
  async #recover(
    error: unknown,
    sent: ReturnType<SpecialistMessages["parts"]>,
    size: ReturnType<SpecialistMessages["size"]>,
  ): Promise<void> {
    const messages = this.#messages;
    if (this.#controller.signal.aborted) throw error;
    if (error instanceof ThoughtTooLong) {
      if (this.#overthought) throw new VisibleError(stoppedTwiceForReasoning);
      this.#overthought = true;
      await messages.notice("thinking", specialistDecidesNow);
      return;
    }
    const said = refusedAsTooLong(error);
    if (said) {
      this.#parts.refused(said, messages.refused(said, sent, size));
      if (!messages.wrappingUp) {
        await messages.wrapUp("refused");
        return;
      }
      // Its request for the report, fitted again once to the smaller window
      // the refusal showed.
      if (await messages.refitOnce()) return;
    }
    throw error;
  }

  /**
   * The report, when the round sent one on its own. A finish beside other
   * calls is answered, not taken: the report would be written before the
   * results it asked for. Once it was asked to report nothing else is on
   * offer, so the report is all there is to take. A finish without a usable
   * report is answered so the specialist can send it again: `again`.
   */
  async #finish(
    answered: RoundResult,
  ): Promise<SpecialistHandoff | "again" | undefined> {
    const { calls, text, reasoning, replay } = answered;
    const messages = this.#messages;
    const finish = calls.find(
      (call) => call.name === finishSpecialistTool.name,
    );
    if (finish && (calls.length === 1 || messages.wrappingUp)) {
      const input = readToolInput(finish.arguments);
      const result = input.ok ? handoff(input.arguments) : undefined;
      if (result) {
        await messages.history.lastRound(text, [protocolCall(finish)], {
          reasoning,
          ...(replay ? { replay } : {}),
          roundId: answered.roundId,
        });
        return result;
      }
      if (!messages.wrappingUp) {
        if (this.#quiet.attempts(finish.name) >= maximumQuietRetries)
          throw new VisibleError(
            "The specialist did not send a usable report.",
          );
        // Answered as any call it could fix itself, and not counted as work
        // done.
        if (!input.ok) finish.arguments = "{}";
        const { answerable } = answerableCalls(
          calls,
          () => `call-${this.#deps.newMessageId()}`,
        );
        messages.history.round(text, answerable.map(protocolCall), undefined, {
          reasoning,
          ...(replay ? { replay } : {}),
          roundId: answered.roundId,
        });
        await messages.history.result(
          finish,
          toolOutput(finish.name, JSON.stringify(noReport)),
        );
        this.#quiet.remember(finish.name, finish.callId);
        return "again";
      }
    }
    const wrappingUp = messages.wrappingUp;
    if (wrappingUp) {
      this.#unreported = true;
      const now = this.#deps.now();
      throw new VisibleError(
        wrappingUp === "work"
          ? `The specialist used up its work budget (${this.#ledger.describe(now, this.#ledger.reached(now))}) and did not report.`
          : wrappingUp === "context"
            ? "The specialist reached the conversation's context budget and did not report."
            : "The specialist's request grew too long for the model, and it did not report.",
      );
    }
    if (calls.length > 0) return undefined;
    // An answer in words alone reaches no one: it is asked once to send it
    // as its report, and a second such answer ends it.
    if (this.#endedInWords)
      throw new VisibleError("The specialist stopped without reporting.");
    this.#endedInWords = true;
    if (text.trim()) {
      messages.history.round(text, [], undefined, {
        reasoning,
        ...(replay ? { replay } : {}),
        roundId: answered.roundId,
      });
      await messages.history.endRound();
    }
    await messages.notice("report", reportInWords);
    return "again";
  }

  /**
   * Answers the round's calls as a turn's are, within the specialist's role,
   * and gives it one request to report what it has once its own budget is
   * spent: a specialist has no one to ask for more.
   */
  async #answer(answered: RoundResult): Promise<void> {
    const round = await this.#parts.answers.answer(answered, this.#rules());
    this.#controller.signal.throwIfAborted();
    if (round.nameless) throw new VisibleError(namelessCallFailure);
    this.#ledger.completeToolRound();
    if (this.#ledger.reached(this.#deps.now()).length > 0)
      await this.#messages.wrapUp("work");
  }

  /**
   * How a specialist's round is answered: pictures as a turn's, no plan; memory
   * read as its own; a tool outside its role refused and recorded, and a
   * finish beside other calls refused, before their input is read.
   */
  #rules(): RoundRules {
    const messages = this.#messages;
    const taskId = this.#taskId;
    const runId = this.#runId;
    const { toolCalls } = this.#parts;
    const signal = this.#controller.signal;
    const round = { tools: messages.own };
    return {
      taskId,
      signal,
      transcript: messages.history,
      quiet: this.#quiet,
      offered: messages.own,
      loopTools: this.#memory ? [this.#memory] : [],
      readInput: (call, quietRetriesLeft) =>
        toolCalls.readInput(taskId, call, {
          round,
          quietRetriesLeft,
          signal,
          specialistRunId: runId,
        }),
      screen: (call) => this.#screen(call),
      tools: {
        toolCalls,
        ownerOf: this.#ownerOf,
        controller: this.#controller,
        round,
        sizes: new RoundResults(
          (text) => this.#deps.kept.keep("output", taskId, { text }),
          resultLimits(this.#parts.budget(taskId)),
        ),
        specialistRunId: runId,
        pictures: new PictureSending(
          this.#deps,
          this.#parts.records,
          taskId,
          messages.history,
        ),
      },
    };
  }

  /** A call refused before its input is read, and why; nothing for the rest. */
  async #screen(
    call: AssembledToolCall,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    if (call.name === finishSpecialistTool.name)
      return refusal(
        "tool",
        "The report was sent together with other actions, before their results were known.",
        "Read the results of the other actions, then call finish_specialist on its own.",
      );
    // A name nobody offers is no tool outside its role: it is answered as
    // any unknown name is, with the name likely meant.
    if (
      this.#messages.own.some((tool) => tool.name === call.name) ||
      !this.#ownerOf(call.name)
    )
      return undefined;
    const reason =
      this.#specialist.access === "read"
        ? "This specialist can only read."
        : "This specialist is not allowed to use this tool.";
    const result = refusal(
      "permission",
      reason,
      "Use a tool allowed for this specialist or report the limitation.",
    );
    await this.#parts.toolCalls.recordFailedProposal(this.#taskId, call, {
      description: "The specialist requested a tool outside its role.",
      reason,
      specialistRunId: this.#runId,
      status: "blocked",
      answer: result,
      tools: this.#offered,
    });
    return result;
  }
}
