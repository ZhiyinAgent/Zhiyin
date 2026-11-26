/**
 * Answering one round of the model's calls, the same for a turn, a specialist
 * and a look back over a turn: the round is written down, each call is
 * answered in the order the model made it, and the round is closed.
 *
 * A call is answered by the first that takes it: the run's own refusal before
 * its input is read, a tool the loop answers itself, or the tool that owns it.
 * A call that stands for another, as the bridge's `call` does, is answered as
 * that other would be, and kept in the conversation as it was made. Once the
 * person declines one, the rest of the batch is answered as not run. What a tool answered is fitted to the round's room and given the notes of
 * the hooks after it; a quiet correction is taken back once the same tool
 * succeeds. What differs between runs is said by the rules they pass in.
 */

import type { ToolOwner, ToolSpec } from "@zhiyin/contract";
import { estimatedTokens } from "@zhiyin/context-budget";
import { unusedFields } from "@zhiyin/tool-input";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { RoundResults } from "../context/result-size.js";
import { selfDescription } from "../context/self-description.js";
import { notesAfter } from "../tools/after-calls.js";
import type { QuietFailures } from "../tools/quiet-failures.js";
import { skippedAfterDecline } from "../tools/refusals.js";
import type { ToolCallOutcome, ToolCalls } from "../tools/tool-calls.js";
import { personsAnswer, toolOutput } from "../turn/notices.js";
import {
  answerableCalls,
  maximumQuietRetries,
  protocolCall,
  type AssembledToolCall,
  type RoundTools,
} from "../turn/turn-shared.js";
import type { RoundResult } from "../turn/model-round.js";
import { Spoken, type LoopTool } from "./loop-tool.js";
import type { Transcript } from "./transcript.js";

/**
 * A call that stands for another, as the bridge's `call` runs an opened tool
 * (ADR 0017): the call to answer in its place, and the conversation's record
 * as the outer call keeps it; or what the model is answered instead.
 */
export type Unwrapped =
  | {
      readonly call: AssembledToolCall;
      /** The record as the outer call keeps it: its name, and its arguments wrapping the inner ones. */
      readonly transcript: (outer: Transcript) => Transcript;
    }
  | { readonly refused: object };

/** What answering a round uses. */
export type RoundAnswersDependencies = Pick<
  AgentLoopDependencies,
  "afterCalls" | "newMessageId" | "recordDefect"
>;

/** A call's input as a tool is handed it, or what the model is answered instead. */
type ReadCallInput = (
  call: AssembledToolCall,
  quietRetriesLeft: number,
) => Promise<
  | {
      readonly ok: true;
      readonly arguments: Record<string, unknown>;
      /** Told to the model with the call's result. */
      readonly note?: string;
    }
  | { readonly ok: false; readonly result: object; readonly quiet: boolean }
>;

/** How the pictures a call made reach the model; a run without it sends none. */
export interface RoundPictures {
  /**
   * Fits a call's pictures for the model: the fields its answer carries about
   * them, and the sending of those it is shown, after the answer.
   */
  fit(
    call: AssembledToolCall,
    outcome: ToolCallOutcome,
    owner: ToolOwner | undefined,
    offered: readonly ToolSpec[],
  ): Promise<{
    readonly fields: Readonly<Record<string, unknown>>;
    readonly send: () => Promise<void>;
  }>;
}

/** How a run hands the calls no loop tool answers to their tools. */
export type ToolRunning = {
  readonly toolCalls: Pick<ToolCalls, "runToolCall">;
  readonly ownerOf: (name: string) => ToolOwner | undefined;
  readonly controller: AbortController;
  readonly round: RoundTools;
  /** The round's answers, measured as they are added. */
  readonly sizes: RoundResults;
  readonly specialistRunId?: string;
  readonly pictures?: RoundPictures;
  /** Told what each call that ran came to. */
  readonly observe?: (
    name: string,
    input: Record<string, unknown>,
    outcome: ToolCallOutcome,
  ) => void;
};

/** What a run says about how its rounds are answered. */
export type RoundRules = {
  readonly taskId: string;
  readonly signal: AbortSignal;
  readonly transcript: Transcript;
  readonly quiet: QuietFailures;
  /** The conversation's message the round's words were shown as, if any. */
  readonly messageId?: string;
  /** The tools on offer as their own specs: what a call says of itself is read against them. */
  readonly offered: readonly ToolSpec[];
  readonly loopTools: readonly LoopTool[];
  readonly readInput: ReadCallInput;
  /**
   * The call another stands for, answered in its place as a direct call to
   * it would be; nothing for a call that stands for itself.
   */
  readonly unwrap?: (call: AssembledToolCall) => Unwrapped | undefined;
  /** Answers a call the run refuses before its input is read. */
  readonly screen?: (
    call: AssembledToolCall,
  ) => Promise<Readonly<Record<string, unknown>> | undefined>;
  /** Where every other call runs; a run without it answers only its loop tools. */
  readonly tools?: ToolRunning;
};

export type RoundAnswered = {
  /** Stopped while a call was answered: the rest were not, and the round is open. */
  readonly stopped: boolean;
  /** Calls without a name, which nobody could answer. */
  readonly nameless: number;
  /** Some call was more than a quiet correction of the model's own input. */
  readonly work: boolean;
};

type CallAnswered = "answered" | "declined" | "stopped";

export class RoundAnswers {
  readonly #deps: RoundAnswersDependencies;

  constructor(deps: RoundAnswersDependencies) {
    this.#deps = deps;
  }

  async answer(
    round: Pick<
      RoundResult,
      "calls" | "text" | "reasoning" | "replay" | "roundId"
    >,
    rules: RoundRules,
  ): Promise<RoundAnswered> {
    const { transcript, quiet, signal } = rules;
    const { answerable, nameless } = answerableCalls(
      round.calls,
      () => `call-${this.#deps.newMessageId()}`,
    );
    transcript.round(
      round.text,
      answerable.map(protocolCall),
      rules.messageId,
      {
        reasoning: round.reasoning,
        ...(round.replay ? { replay: round.replay } : {}),
        roundId: round.roundId,
      },
    );
    let declined = false;
    const quietBefore = quiet.total();
    for (const call of answerable) {
      // A stop while an earlier call was answered ends the round there,
      // whichever call it was.
      if (signal.aborted) return { stopped: true, nameless, work: false };
      if (declined) {
        await answerWith(transcript, call, skippedAfterDecline());
        continue;
      }
      const answered = await this.#answerCall(call, rules);
      if (answered === "stopped")
        return { stopped: true, nameless, work: false };
      if (answered === "declined") declined = true;
    }
    await transcript.endRound();
    return {
      stopped: false,
      nameless,
      work: quiet.total() - quietBefore < answerable.length,
    };
  }

  async #answerCall(
    outer: AssembledToolCall,
    roundRules: RoundRules,
  ): Promise<CallAnswered> {
    const unwrapped = roundRules.unwrap?.(outer);
    if (unwrapped && "refused" in unwrapped) {
      await answerWith(roundRules.transcript, outer, unwrapped.refused);
      return "answered";
    }
    const call = unwrapped?.call ?? outer;
    const rules = unwrapped
      ? {
          ...roundRules,
          transcript: unwrapped.transcript(roundRules.transcript),
        }
      : roundRules;
    const { transcript, quiet, signal } = rules;
    const refused = await rules.screen?.(call);
    if (refused) {
      await answerWith(transcript, call, refused);
      return "answered";
    }
    const quietRetriesLeft = maximumQuietRetries - quiet.attempts(call.name);
    const input = await rules.readInput(call, quietRetriesLeft);
    await transcript.rewriteCall(call.callId, call.arguments);
    if (!input.ok) {
      await transcript.result(
        call,
        toolOutput(call.name, JSON.stringify(input.result)),
      );
      if (input.quiet) quiet.remember(call.name, call.callId);
      return "answered";
    }
    // A call says what it is for; that is the person's to read, not the
    // tool's input.
    const { args, said } = selfDescription(
      input.arguments,
      rules.offered.find((tool) => tool.name === call.name),
    );
    const note = input.note ? { note: input.note } : {};
    // A stop while this call's input was read hands nothing on.
    if (signal.aborted) return "stopped";
    const loopTool = rules.loopTools.find((tool) => tool.answers(call.name));
    if (loopTool) {
      const answer = await loopTool.answer(call, args);
      if (answer instanceof Spoken)
        await transcript.result(call, answer.content(call.name, input.note));
      else
        await answerWith(
          transcript,
          call,
          { ...answer, ...note },
          loopTool.startedRun?.(call.callId),
        );
      return signal.aborted ? "stopped" : "answered";
    }
    if (!rules.tools)
      throw new Error(`${call.name} reached a run that answers no tools.`);
    return this.#run(
      call,
      { args, said, note, quietRetriesLeft },
      rules,
      rules.tools,
    );
  }

  /**
   * Runs a call through its tool and tells the model what it answered: the
   * answer without the person's copy of it, cut to what the round can carry,
   * with the hooks' notes, and the pictures it made where the run sends them.
   */
  async #run(
    call: AssembledToolCall,
    {
      args,
      said,
      note,
      quietRetriesLeft,
    }: {
      readonly args: Record<string, unknown>;
      readonly said: ReturnType<typeof selfDescription>["said"];
      readonly note: Record<string, unknown>;
      readonly quietRetriesLeft: number;
    },
    rules: RoundRules,
    tools: ToolRunning,
  ): Promise<CallAnswered> {
    const { taskId, transcript, quiet, signal } = rules;
    const owner = tools.ownerOf(call.name);
    const outcome = await tools.toolCalls.runToolCall(taskId, call, {
      proposedArguments: args,
      owner,
      controller: tools.controller,
      quietRetriesLeft,
      round: tools.round,
      said,
      ...(tools.specialistRunId
        ? { specialistRunId: tools.specialistRunId }
        : {}),
      // What is left of the round, less the note sent beside the answer.
      answerTokens:
        tools.sizes.room() -
        (Object.keys(note).length ? estimatedTokens(JSON.stringify(note)) : 0),
    });
    tools.observe?.(call.name, args, outcome);
    if (signal.aborted) return "stopped";
    const pictures = await tools.pictures?.fit(
      call,
      outcome,
      owner,
      tools.round.tools,
    );
    const after =
      outcome.result.ok && !outcome.quiet
        ? await notesAfter(
            this.#deps.afterCalls ?? [],
            call.name,
            { input: args, answer: outcome.result.value },
            (error) => this.#deps.recordDefect?.({ taskId, error }),
          )
        : {};
    // A field the tool does not take is dropped without a word by the tool,
    // so the model is told the call ran without it.
    const unused =
      outcome.result.ok && !outcome.quiet
        ? unusedFields(
            args,
            rules.offered.find((tool) => tool.name === call.name)?.inputSchema,
          )
        : [];
    const notes = [
      typeof note["note"] === "string" ? note["note"] : undefined,
      unused.length
        ? `${unused.map((field) => `“${field}”`).join(", ")} ${unused.length === 1 ? "is not a field" : "are not fields"} of ${call.name}, so the call ran without ${unused.length === 1 ? "it" : "them"}.`
        : undefined,
    ].filter((line) => line !== undefined);
    // `details` is the tool's copy for the person, and is not sent again.
    const answered = {
      ...outcome.result,
      images: undefined,
      details: undefined,
      ...pictures?.fields,
      ...after,
      ...(notes.length ? { note: notes.join(" ") } : {}),
    };
    const sent = await tools.sizes.fit(
      JSON.stringify(answered),
      answered,
      owner === "built-in" ? args : undefined,
    );
    await transcript.result(
      call,
      outcome.fromPerson ? personsAnswer(sent) : toolOutput(call.name, sent),
    );
    await pictures?.send();
    await transcript.rewriteCall(call.callId, call.arguments);
    if (outcome.quiet) quiet.remember(call.name, call.callId);
    else if (outcome.result.ok)
      await transcript.forget(quiet.succeeded(call.name));
    return outcome.denied ? "declined" : "answered";
  }
}

/** Answers a call with what the loop says of it, kept with the conversation. */
async function answerWith(
  transcript: Transcript,
  call: AssembledToolCall,
  answer: object,
  runId?: string,
): Promise<void> {
  await transcript.result(
    call,
    toolOutput(call.name, JSON.stringify(answer)),
    runId,
  );
}
