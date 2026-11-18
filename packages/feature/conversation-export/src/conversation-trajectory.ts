import type {
  ModelHistoryEntry,
  ModelResponseRecord,
  SpecialistRun,
  TaskAction,
  WorkspaceTask,
} from "@zhiyin/contract";
import { withoutCredentials } from "@zhiyin/credential-removal";
import { leftOut, type ExportAbout } from "./about.js";
import {
  atifVersion,
  type AtifFinalMetrics,
  type AtifStep,
  type AtifTrajectory,
} from "./atif.js";
import {
  trajectoryPictures,
  type PicturePart,
  type PictureReader,
} from "./trajectory-pictures.js";
import { transcriptSteps, type UnnumberedStep } from "./trajectory-steps.js";
import type { ArchivedFile } from "./zip.js";

/**
 * The conversation as an ATIF trajectory, with the pictures it refers to.
 * Steps follow what the model was sent; each specialist is a trajectory of
 * its own, named where it was delegated; what ATIF has no field for is under
 * `extra`, so nothing of the saved conversation is left out.
 */
export async function conversationTrajectory(
  task: WorkspaceTask,
  about: ExportAbout,
  read: PictureReader,
): Promise<{ readonly trajectory: string; readonly pictures: ArchivedFile[] }> {
  const pictures = await trajectoryPictures(task, read);
  const actions = byCall(task.actions);
  const placed = new Set<string>();
  const steps = transcriptSteps({
    entries: task.modelHistory,
    messages: new Map(task.messages.map((message) => [message.id, message])),
    rounds: byRound(task.modelResponses),
    actions,
    picture: pictures.part,
    before: condensingSteps(task),
    delegated: (result) =>
      result.runId && task.specialistRuns.some((run) => run.id === result.runId)
        ? [result.runId]
        : [],
  });
  for (const id of callsIn(task.modelHistory)) placed.add(id);
  const specialists = task.specialistRuns.map((run) => {
    for (const id of callsIn(run.transcript ?? [])) placed.add(id);
    return specialistTrajectory(run, task.id, about, actions, pictures.part);
  });

  const trajectory: AtifTrajectory = {
    schema_version: atifVersion,
    session_id: task.id,
    trajectory_id: task.id,
    agent: {
      name: "zhiyin",
      version: about.appVersion,
      ...modelOf(task.modelResponses),
      extra: {
        standingInstructions: task.standingInstructions,
        activatedPlugins: task.activatedPlugins,
      },
    },
    steps: numbered(steps),
    notes: leftOut.trajectory.join(" "),
    final_metrics: totals(task.modelResponses, steps.length),
    extra: {
      zhiyin: {
        format: "zhiyin.conversation",
        app: { name: "Zhiyin", version: about.appVersion },
        exportedAt: about.exportedAt.toISOString(),
        conversation: restOf(task),
        // Actions no kept call ran, and requests whose round kept nothing.
        unplacedActions: task.actions.filter(
          (action) => !action.callId || !placed.has(action.callId),
        ),
        unplacedRequests: unplaced(task.modelResponses, task.modelHistory),
      },
    },
    ...(specialists.length ? { subagent_trajectories: specialists } : {}),
  };
  return {
    trajectory: asciiJson(withoutCredentials(trajectory)),
    pictures: pictures.files,
  };
}

/**
 * JSON with every character past ASCII escaped: the same JSON, which a reader
 * that opens the file in the system's own encoding, as Python does on
 * Windows by default, still reads whole.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[^\x20-\x7e\n]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function specialistTrajectory(
  run: SpecialistRun,
  sessionId: string,
  about: ExportAbout,
  actions: ReadonlyMap<string, TaskAction>,
  picture: PicturePart,
): AtifTrajectory {
  const transcript = run.transcript ?? [];
  const responses = run.modelResponses ?? [];
  const steps: UnnumberedStep[] = [
    {
      source: "system",
      message: `The main agent delegated this task to the ${run.specialist.name} specialist: ${run.task}`,
      extra: { zhiyin: { instructions: run.specialist.instructions } },
    },
    ...transcriptSteps({
      entries: transcript,
      messages: new Map(),
      rounds: byRound(responses),
      actions,
      picture,
    }),
  ];
  const record: Record<string, unknown> = { ...run };
  delete record["transcript"];
  delete record["modelResponses"];
  return {
    schema_version: atifVersion,
    session_id: sessionId,
    trajectory_id: run.id,
    agent: {
      name: run.specialist.id,
      version: about.appVersion,
      ...modelOf(responses),
    },
    steps: numbered(steps),
    ...(run.transcript
      ? {}
      : {
          notes:
            "This run was kept before specialists kept what they said, or was cut off by Zhiyin closing: only its actions are in the record.",
        }),
    final_metrics: totals(responses, steps.length),
    extra: {
      zhiyin: {
        run: record,
        unplacedRequests: unplaced(responses, transcript),
      },
    },
  };
}

/**
 * Each condensing that took effect, as a step before the first entry it did
 * not cover: from there the model was sent its summary in place of what came
 * before.
 */
function condensingSteps(
  task: WorkspaceTask,
): ReadonlyMap<number, readonly UnnumberedStep[]> {
  const steps = new Map<number, UnnumberedStep[]>();
  for (const condensing of task.condensings) {
    if (condensing.outcome !== "condensed") continue;
    const at = firstAfter(task, condensing);
    const content = [condensing.summary, condensing.carried]
      .filter(Boolean)
      .join("\n\n");
    const list = steps.get(at) ?? [];
    list.push({
      source: "system",
      message: "Earlier messages were condensed to fit the model's window.",
      observation: { results: [{ content }] },
      extra: {
        context_management: { type: "compaction", boundary: "replace" },
        zhiyin: { condensing },
      },
    });
    steps.set(at, list);
  }
  return steps;
}

/** The first history entry after what a condensing covered. */
function firstAfter(
  task: WorkspaceTask,
  condensing: Extract<
    WorkspaceTask["condensings"][number],
    { outcome: "condensed" }
  >,
): number {
  const entries = task.modelHistory;
  if (task.compaction?.revision === condensing.revision) {
    const through = entries.findIndex(
      (entry) => entry.id === task.compaction?.throughEntryId,
    );
    if (through >= 0) return through + 1;
  }
  const through = task.messages.findIndex(
    (message) => message.id === condensing.throughMessageId,
  );
  if (through < 0) return 0;
  const later = new Set(task.messages.slice(through + 1).map(({ id }) => id));
  const first = entries.findIndex(
    (entry) =>
      (entry.kind === "message" || entry.kind === "calls") &&
      entry.messageId !== undefined &&
      later.has(entry.messageId),
  );
  return first < 0 ? entries.length : first;
}

function numbered(steps: readonly UnnumberedStep[]): AtifStep[] {
  return steps.map((step, index) => ({ step_id: index + 1, ...step }));
}

function byRound(
  responses: readonly ModelResponseRecord[],
): ReadonlyMap<string, ModelResponseRecord> {
  return new Map(
    responses.flatMap((response) =>
      response.roundId ? [[response.roundId, response] as const] : [],
    ),
  );
}

function byCall(
  actions: readonly TaskAction[],
): ReadonlyMap<string, TaskAction> {
  return new Map(
    actions.flatMap((action) =>
      action.callId ? [[action.callId, action] as const] : [],
    ),
  );
}

function callsIn(entries: readonly ModelHistoryEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "calls" ? entry.calls.map((call) => call.id) : [],
  );
}

/** The model most of its requests went to, as the trajectory's own. */
function modelOf(responses: readonly ModelResponseRecord[]): {
  readonly model_name?: string;
} {
  const counts = new Map<string, number>();
  for (const response of responses)
    if (response.model)
      counts.set(response.model, (counts.get(response.model) ?? 0) + 1);
  const [model] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return model ? { model_name: model } : {};
}

/** Every request counted, whether or not its round kept anything. */
function totals(
  responses: readonly ModelResponseRecord[],
  steps: number,
): AtifFinalMetrics {
  let prompt = 0;
  let completion = 0;
  let cached = 0;
  let cost = 0;
  let costed = 0;
  for (const { usage } of responses) {
    if (!usage) continue;
    prompt += usage.inputTokens;
    completion += usage.outputTokens;
    cached += usage.cacheReadTokens ?? 0;
    if (usage.costUsd !== undefined) {
      cost += usage.costUsd;
      costed += 1;
    }
  }
  const counted = responses.filter((response) => response.usage).length;
  return {
    total_prompt_tokens: prompt,
    total_completion_tokens: completion,
    total_cached_tokens: cached,
    ...(costed ? { total_cost_usd: cost } : {}),
    total_steps: steps,
    extra: {
      requests: responses.length,
      requestsWithUsage: counted,
      requestsWithProviderCost: costed,
    },
  };
}

function unplaced(
  responses: readonly ModelResponseRecord[],
  entries: readonly ModelHistoryEntry[],
): ModelResponseRecord[] {
  const kept = new Set(
    entries.flatMap((entry) =>
      "roundId" in entry && entry.roundId ? [entry.roundId] : [],
    ),
  );
  return responses.filter(
    (response) => !response.roundId || !kept.has(response.roundId),
  );
}

/**
 * The saved conversation without what the steps and the specialists'
 * trajectories already carry: its history, its requests' records, its
 * specialists' runs and its actions, which are with their calls or listed
 * apart.
 */
function restOf(task: WorkspaceTask): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...task };
  delete rest["specialistRuns"];
  delete rest["modelHistory"];
  delete rest["modelResponses"];
  delete rest["actions"];
  return rest;
}
