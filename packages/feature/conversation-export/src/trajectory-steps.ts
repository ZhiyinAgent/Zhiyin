import type {
  ModelHistoryEntry,
  ModelResponseRecord,
  TaskAction,
  TaskMessage,
} from "@zhiyin/contract";
import type {
  AtifContentPart,
  AtifMetrics,
  AtifObservationResult,
  AtifStep,
  AtifToolCall,
} from "./atif.js";
import type { PicturePart } from "./trajectory-pictures.js";

/** A step without its number, which its place gives it. */
export type UnnumberedStep = Omit<AtifStep, "step_id">;

/** What the steps of one transcript are made from. */
export type StepSources = {
  readonly entries: readonly ModelHistoryEntry[];
  readonly messages: ReadonlyMap<string, TaskMessage>;
  /** Each request's record, by the round it names. */
  readonly rounds: ReadonlyMap<string, ModelResponseRecord>;
  /** Each action, by the call it ran. */
  readonly actions: ReadonlyMap<string, TaskAction>;
  readonly picture: PicturePart;
  /** Steps that come before the entry at an index, as a condensing does. */
  readonly before?: ReadonlyMap<number, readonly UnnumberedStep[]>;
  /** The trajectories a call's result names, as a delegation names its run. */
  readonly delegated?: (result: {
    readonly runId?: string;
  }) => readonly string[];
};

/**
 * One step per thing the model was sent or said, in the order sent: the
 * person's message, each round of the model with its calls and their results,
 * and what Zhiyin told it.
 */
export function transcriptSteps(sources: StepSources): UnnumberedStep[] {
  const steps: UnnumberedStep[] = [];
  /** Where each call is, so its result joins the round that made it. */
  const callAt = new Map<string, number>();
  const observed = new Map<number, AtifObservationResult[]>();
  const observe = (at: number, result: AtifObservationResult) => {
    const results = observed.get(at) ?? [];
    results.push(result);
    observed.set(at, results);
  };

  for (const [index, entry] of sources.entries.entries()) {
    steps.push(...(sources.before?.get(index) ?? []));
    switch (entry.kind) {
      case "message": {
        const message = sources.messages.get(entry.messageId);
        steps.push(messageStep(entry, message, sources));
        break;
      }
      case "calls": {
        const at = steps.length;
        for (const call of entry.calls) callAt.set(call.id, at);
        steps.push(
          agentStep(sources, entry.roundId, {
            message: entry.text,
            reasoning: entry.reasoning,
            calls: entry.calls.map((call) => toolCall(call, sources.actions)),
            zhiyin: zhiyinOf(entry),
          }),
        );
        break;
      }
      case "result": {
        const delegated = sources.delegated?.(entry) ?? [];
        const result: AtifObservationResult = {
          content: entry.content,
          ...(delegated.length
            ? {
                subagent_trajectory_ref: delegated.map((id) => ({
                  trajectory_id: id,
                })),
              }
            : {}),
          extra: { zhiyin: { entryId: entry.id, name: entry.name } },
        };
        const at = callAt.get(entry.callId);
        if (at === undefined)
          // A result whose call was not kept: said as Zhiyin's, unattached.
          steps.push({
            source: "system",
            message: `The answer to call ${entry.callId}, whose call is not in the record.`,
            observation: { results: [result] },
          });
        else observe(at, { source_call_id: entry.callId, ...result });
        break;
      }
      case "notice":
        steps.push({
          source: "system",
          message: entry.content,
          extra: { zhiyin: zhiyinOf(entry) },
        });
        break;
      case "pictures": {
        const content: AtifContentPart[] = [
          { type: "text", text: entry.text },
          ...entry.pictures.map((picture) => sources.picture(picture.source)),
        ];
        // Sent after the answer that produced them: what that round observed.
        const last = steps.length - 1;
        if (last >= 0 && steps[last]?.source === "agent" && observed.has(last))
          observe(last, { content, extra: { zhiyin: { entryId: entry.id } } });
        else
          steps.push({
            source: "system",
            message: content,
            extra: { zhiyin: zhiyinOf(entry) },
          });
        break;
      }
    }
  }
  steps.push(...(sources.before?.get(sources.entries.length) ?? []));
  return steps.map((step, at) => {
    const results = observed.get(at);
    return results ? { ...step, observation: { results } } : step;
  });
}

function messageStep(
  entry: Extract<ModelHistoryEntry, { kind: "message" }>,
  message: TaskMessage | undefined,
  sources: StepSources,
): UnnumberedStep {
  if (!message)
    return {
      source: "system",
      message: "A message that is no longer in the conversation.",
      extra: { zhiyin: zhiyinOf(entry) },
    };
  if (message.role === "assistant")
    return agentStep(sources, entry.roundId, {
      message: message.text,
      reasoning: entry.reasoning,
      calls: [],
      zhiyin: zhiyinOf(entry),
    });
  const pictures = (message.attachments ?? []).flatMap((attachment) =>
    attachment.kind === "picture" ? [sources.picture(attachment.source)] : [],
  );
  return {
    source: "user",
    message: pictures.length
      ? [{ type: "text", text: message.text }, ...pictures]
      : message.text,
    extra: {
      zhiyin: {
        ...zhiyinOf(entry),
        ...(message.attachments?.length
          ? { attachments: message.attachments }
          : {}),
      },
    },
  };
}

function agentStep(
  sources: StepSources,
  roundId: string | undefined,
  round: {
    readonly message: string;
    readonly reasoning: string | undefined;
    readonly calls: readonly AtifToolCall[];
    readonly zhiyin: Readonly<Record<string, unknown>>;
  },
): UnnumberedStep {
  const response = roundId ? sources.rounds.get(roundId) : undefined;
  return {
    source: "agent",
    ...(response?.startedAt ? { timestamp: response.startedAt } : {}),
    ...(response?.model ? { model_name: response.model } : {}),
    message: round.message,
    ...(round.reasoning ? { reasoning_content: round.reasoning } : {}),
    ...(round.calls.length ? { tool_calls: round.calls } : {}),
    ...(response ? { metrics: metricsOf(response), llm_call_count: 1 } : {}),
    extra: {
      zhiyin: {
        ...round.zhiyin,
        ...(response ? { request: requestOf(response) } : {}),
      },
    },
  };
}

/** The tokens and cost a request's record names, as ATIF counts them. */
function metricsOf(response: ModelResponseRecord): AtifMetrics {
  const usage = response.usage;
  if (!usage) return {};
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    ...(usage.cacheReadTokens === undefined
      ? {}
      : { cached_tokens: usage.cacheReadTokens }),
    ...(usage.costUsd === undefined ? {} : { cost_usd: usage.costUsd }),
    extra: {
      ...(usage.reasoningTokens === undefined
        ? {}
        : { reasoning_tokens: usage.reasoningTokens }),
      ...(usage.cacheWriteTokens === undefined
        ? {}
        : { cache_write_tokens: usage.cacheWriteTokens }),
      ...(usage.estimatedCost ? { estimated_cost: usage.estimatedCost } : {}),
    },
  };
}

/** The rest of a request's record: who served it, when, and how it ended. */
function requestOf(response: ModelResponseRecord): Record<string, unknown> {
  const request: Record<string, unknown> = { ...response };
  delete request["usage"];
  return request;
}

function toolCall(
  call: {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
  },
  actions: ReadonlyMap<string, TaskAction>,
): AtifToolCall {
  const parsed = argumentsOf(call.arguments);
  const action = actions.get(call.id);
  return {
    tool_call_id: call.id,
    function_name: call.name,
    arguments: parsed ?? {},
    ...(action || !parsed
      ? {
          extra: {
            zhiyin: {
              ...(parsed ? {} : { arguments: call.arguments }),
              ...(action ? { action } : {}),
            },
          },
        }
      : {}),
  };
}

/** A call's arguments as an object, which is all ATIF takes. */
function argumentsOf(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** What of a history entry ATIF has no field for. */
function zhiyinOf(entry: ModelHistoryEntry): Record<string, unknown> {
  const kept: Record<string, unknown> = { entryId: entry.id, kind: entry.kind };
  if ("messageId" in entry && entry.messageId)
    kept["messageId"] = entry.messageId;
  if ("roundId" in entry && entry.roundId) kept["roundId"] = entry.roundId;
  if ("replay" in entry && entry.replay) kept["replay"] = entry.replay;
  if ("picturesLetGo" in entry && entry.picturesLetGo)
    kept["picturesLetGo"] = true;
  return kept;
}
