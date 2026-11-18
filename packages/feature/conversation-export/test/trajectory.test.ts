/**
 * "Data to analyse" is an ATIF trajectory: one step for each thing the model
 * was sent or said, each round with its own request's counts, each specialist
 * a trajectory of its own, its pictures as files beside it, and the rest of
 * the saved conversation under `extra`.
 */

import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import {
  conversationTrajectory,
  type ExportAbout,
  type PictureReader,
} from "../src/index.js";

const about: ExportAbout = {
  appVersion: "0.1.0-alpha.3",
  exportedAt: new Date("2026-11-06T12:00:00.000Z"),
};

const reviewer = {
  id: "engineering/reviewer",
  name: "Reviewer",
  description: "Reviews work.",
  instructions: "Review the evidence.",
  provenance: { source: "plugin" as const, pluginId: "engineering" },
};

function usage(input: number, cost: number) {
  return {
    inputTokens: input,
    outputTokens: 50,
    cacheReadTokens: 400,
    costUsd: cost,
  };
}

function conversation(): WorkspaceTask {
  return {
    ...emptyConversationLists,
    id: "task-1",
    title: "Compare the charts",
    titleSource: "generated",
    updatedAt: "2026-11-06T11:00:00.000Z",
    updatedLabel: "Today",
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
    messages: [
      {
        id: "m1",
        role: "user",
        text: "Which quarter sold more?",
        attachments: [
          {
            kind: "picture",
            id: "p1",
            name: "q1.png",
            mediaType: "image/png",
            bytes: 5,
            source: "picture-1",
          },
        ],
        sequence: 0,
      },
      { id: "m2", role: "assistant", text: "Q2 sold more.", sequence: 9 },
    ],
    modelHistory: [
      { id: "h1", kind: "message", messageId: "m1" },
      {
        id: "h2",
        kind: "calls",
        roundId: "r1",
        text: "Reading the figures.",
        reasoning: "Both quarters are needed.",
        calls: [
          { id: "c1", name: "read_file", arguments: '{"path":"q2.csv"}' },
        ],
      },
      {
        id: "h3",
        kind: "result",
        callId: "c1",
        name: "read_file",
        content: "q2: 140",
      },
      {
        id: "h4",
        kind: "pictures",
        text: "The chart read_file drew.",
        pictures: [{ mediaType: "image/png", source: "picture-gone" }],
      },
      { id: "h5", kind: "notice", content: "Today is Friday." },
      {
        id: "h6",
        kind: "calls",
        roundId: "r2",
        text: "",
        calls: [
          {
            id: "d1",
            name: "delegate_specialist",
            arguments: '{"id":"engineering/reviewer","task":"Check q2.csv."}',
          },
        ],
      },
      {
        id: "h7",
        kind: "result",
        callId: "d1",
        name: "delegate_specialist",
        content:
          '<tool-output>{"ok":true,"runId":"run-1","report":"It holds."}</tool-output>',
        runId: "run-1",
      },
      {
        id: "h8",
        kind: "message",
        messageId: "m2",
        roundId: "r3",
        reasoning: "The figures agree.",
      },
    ],
    modelResponses: [
      {
        roundId: "r1",
        model: "deepseek/deepseek-v4",
        finishReason: "tool_calls",
        termination: "finishReason",
        complete: true,
        startedAt: "2026-11-06T11:00:01.000Z",
        usage: usage(1000, 0.01),
      },
      {
        roundId: "r9",
        model: "deepseek/deepseek-v4",
        finishReason: "tool_calls",
        termination: "finishReason",
        complete: true,
        usage: usage(1100, 0.02),
      },
      {
        roundId: "r2",
        model: "deepseek/deepseek-v4",
        finishReason: "tool_calls",
        termination: "finishReason",
        complete: true,
        usage: usage(1200, 0.03),
      },
      {
        roundId: "r3",
        model: "deepseek/deepseek-v4",
        finishReason: "stop",
        termination: "finishReason",
        complete: true,
        usage: usage(1300, 0.04),
      },
    ],
    actions: [
      {
        id: "a1",
        action: "Read a file",
        target: "q2.csv",
        callId: "c1",
        approval: { by: "you", at: "2026-11-06T11:00:02.000Z" },
        status: "completed",
        sequence: 1,
      },
      {
        id: "a2",
        action: "Read a file",
        target: "q2.csv",
        callId: "s1",
        specialistRunId: "run-1",
        status: "completed",
        sequence: 3,
      },
      {
        id: "a3",
        action: "Look back",
        target: "memory",
        status: "completed",
        sequence: 8,
      },
    ],
    specialistRuns: [
      {
        id: "run-1",
        specialist: reviewer,
        task: "Check q2.csv.",
        depth: 1,
        status: "completed",
        startedAt: "2026-11-06T11:00:03.000Z",
        finishedAt: "2026-11-06T11:00:05.000Z",
        sequence: 2,
        actionIds: ["a2"],
        handoff: { report: "It holds." },
        transcript: [
          {
            id: "s-h1",
            kind: "calls",
            roundId: "s-r1",
            text: "",
            calls: [
              { id: "s1", name: "read_file", arguments: '{"path":"q2.csv"}' },
            ],
          },
          {
            id: "s-h2",
            kind: "result",
            callId: "s1",
            name: "read_file",
            content: "q2: 140",
          },
          {
            id: "s-h3",
            kind: "calls",
            roundId: "s-r2",
            text: "",
            calls: [
              {
                id: "f1",
                name: "finish_specialist",
                arguments: '{"report":"It holds."}',
              },
            ],
          },
        ],
        modelResponses: [
          {
            roundId: "s-r1",
            model: "deepseek/deepseek-v4",
            finishReason: "tool_calls",
            termination: "finishReason",
            complete: true,
            usage: usage(500, 0.005),
          },
          {
            roundId: "s-r2",
            model: "deepseek/deepseek-v4",
            finishReason: "tool_calls",
            termination: "finishReason",
            complete: true,
            usage: usage(600, 0.006),
          },
        ],
      },
    ],
  };
}

const pictures: PictureReader = async (source) =>
  source === "picture-1"
    ? { status: "ready", mediaType: "image/png", data: "aGVsbG8=" }
    : source === "picture-2"
      ? { status: "ready", mediaType: "image/jpeg", data: "dmlldw==" }
      : {
          status: "missing",
          reason: "It was deleted to stay inside its limits.",
        };

type Step = {
  step_id: number;
  source: string;
  message: unknown;
  reasoning_content?: string;
  model_name?: string;
  tool_calls?: {
    tool_call_id: string;
    function_name: string;
    arguments: unknown;
    extra?: { zhiyin?: Record<string, unknown> };
  }[];
  observation?: {
    results: {
      source_call_id?: string;
      content?: unknown;
      subagent_trajectory_ref?: { trajectory_id: string }[];
    }[];
  };
  metrics?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

type Trajectory = {
  schema_version: string;
  agent: { name: string; version: string; model_name?: string };
  steps: Step[];
  notes?: string;
  final_metrics?: Record<string, unknown>;
  extra?: { zhiyin: Record<string, unknown> };
  subagent_trajectories?: (Trajectory & { trajectory_id: string })[];
};

async function exported(task: WorkspaceTask = conversation()) {
  const { trajectory, pictures: files } = await conversationTrajectory(
    task,
    about,
    pictures,
  );
  return { trajectory: JSON.parse(trajectory) as Trajectory, files };
}

describe("the trajectory for analysis", () => {
  it("has a step for each thing the model was sent or said, in the order sent", async () => {
    const { trajectory } = await exported();

    expect(trajectory.schema_version).toBe("ATIF-v1.8");
    expect(trajectory.agent).toMatchObject({
      name: "zhiyin",
      version: "0.1.0-alpha.3",
      model_name: "deepseek/deepseek-v4",
    });
    expect(trajectory.steps.map((step) => [step.step_id, step.source])).toEqual(
      [
        [1, "user"],
        [2, "agent"],
        [3, "system"],
        [4, "agent"],
        [5, "agent"],
      ],
    );
    expect(trajectory.steps[1]).toMatchObject({
      message: "Reading the figures.",
      reasoning_content: "Both quarters are needed.",
      tool_calls: [
        {
          tool_call_id: "c1",
          function_name: "read_file",
          arguments: { path: "q2.csv" },
        },
      ],
    });
    expect(trajectory.steps[2]?.message).toBe("Today is Friday.");
    expect(trajectory.steps[4]).toMatchObject({
      message: "Q2 sold more.",
      reasoning_content: "The figures agree.",
    });
  });

  it("gives each round its own request's tokens and cost, and counts every request in the totals", async () => {
    const { trajectory } = await exported();

    expect(
      trajectory.steps
        .filter((step) => step.source === "agent")
        .map((step) => step.metrics),
    ).toEqual([
      expect.objectContaining({
        prompt_tokens: 1000,
        cached_tokens: 400,
        cost_usd: 0.01,
      }),
      expect.objectContaining({ prompt_tokens: 1200, cost_usd: 0.03 }),
      expect.objectContaining({ prompt_tokens: 1300, cost_usd: 0.04 }),
    ]);
    expect(trajectory.final_metrics).toMatchObject({
      total_prompt_tokens: 1000 + 1100 + 1200 + 1300,
      total_completion_tokens: 200,
      total_cached_tokens: 1600,
      total_steps: 5,
    });
    expect(trajectory.final_metrics?.["total_cost_usd"]).toBeCloseTo(0.1);
    expect(trajectory.extra?.zhiyin["unplacedRequests"]).toMatchObject([
      { roundId: "r9" },
    ]);
  });

  it("puts each call's answer, and the pictures it produced, with the round that made the call", async () => {
    const { trajectory } = await exported();

    expect(trajectory.steps[1]?.observation?.results).toMatchObject([
      { source_call_id: "c1", content: "q2: 140" },
      {
        content: [
          { type: "text", text: "The chart read_file drew." },
          {
            type: "text",
            text: "[Picture not included: It was deleted to stay inside its limits.]",
          },
        ],
      },
    ]);
  });

  it("includes the person's pictures as files beside it, by the path the step names", async () => {
    const { trajectory, files } = await exported();

    expect(trajectory.steps[0]?.message).toEqual([
      { type: "text", text: "Which quarter sold more?" },
      {
        type: "image",
        source: { media_type: "image/png", path: "images/picture-1.png" },
      },
    ]);
    expect(files).toEqual([
      { path: "images/picture-1.png", data: Buffer.from("hello") },
    ]);
  });

  it("includes the pictures a specialist was shown, beside the call that made them", async () => {
    const task = conversation();
    const [run] = task.specialistRuns;
    const { trajectory, files } = await exported({
      ...task,
      specialistRuns: [
        {
          ...run!,
          transcript: [
            ...(run!.transcript ?? []).slice(0, 2),
            {
              id: "s-p1",
              kind: "pictures",
              text: "The view read_file made.",
              pictures: [{ mediaType: "image/jpeg", source: "picture-2" }],
            },
            ...(run!.transcript ?? []).slice(2),
          ],
        },
      ],
    });

    expect(files).toContainEqual({
      path: "images/picture-2.jpg",
      data: Buffer.from("view"),
    });
    expect(
      JSON.stringify(trajectory.subagent_trajectories?.[0]?.steps[1]),
    ).toContain("images/picture-2.jpg");
  });

  it("says who allowed each action, beside the call that ran it", async () => {
    const { trajectory } = await exported();

    expect(trajectory.steps[1]?.tool_calls?.[0]?.extra?.zhiyin).toMatchObject({
      action: {
        id: "a1",
        status: "completed",
        approval: { by: "you" },
      },
    });
    expect(trajectory.extra?.zhiyin["unplacedActions"]).toMatchObject([
      { id: "a3" },
    ]);
  });

  it("embeds each specialist as its own trajectory, named in the answer that delegated to it", async () => {
    const { trajectory } = await exported();

    expect(trajectory.steps[3]?.observation?.results[0]).toMatchObject({
      source_call_id: "d1",
      subagent_trajectory_ref: [{ trajectory_id: "run-1" }],
    });
    const [run] = trajectory.subagent_trajectories ?? [];
    expect(run).toMatchObject({
      trajectory_id: "run-1",
      agent: { name: "engineering/reviewer" },
      final_metrics: { total_prompt_tokens: 1100 },
    });
    expect(run?.steps.map((step) => step.source)).toEqual([
      "system",
      "agent",
      "agent",
    ]);
    expect(run?.steps[0]?.message).toContain("Check q2.csv.");
    expect(run?.steps[1]).toMatchObject({
      tool_calls: [
        { tool_call_id: "s1", extra: { zhiyin: { action: { id: "a2" } } } },
      ],
      observation: { results: [{ source_call_id: "s1", content: "q2: 140" }] },
      metrics: { prompt_tokens: 500 },
    });
    expect(run?.steps[2]?.tool_calls?.[0]).toMatchObject({
      function_name: "finish_specialist",
      arguments: { report: "It holds." },
    });
  });

  it("marks a condensing as a compaction that replaces what came before", async () => {
    const task = conversation();
    const { trajectory } = await exported({
      ...task,
      condensings: [
        {
          id: "k1",
          sequence: 5,
          createdAt: "2026-11-06T11:00:04.000Z",
          targetTokens: 60_000,
          tokensBefore: 90_000,
          outcome: "condensed",
          revision: 1,
          throughMessageId: "m1",
          tokensAfter: 20_000,
          messages: 1,
          actions: 1,
          summary: "The person asked which quarter sold more.",
        },
      ],
      compaction: {
        revision: 1,
        throughMessageId: "m1",
        throughEntryId: "h5",
        summary: "The person asked which quarter sold more.",
        retainedActionIds: [],
        createdAt: "2026-11-06T11:00:04.000Z",
      },
    });

    const at = trajectory.steps.findIndex((step) =>
      Boolean(step.extra?.["context_management"]),
    );
    expect(trajectory.steps[at]).toMatchObject({
      source: "system",
      observation: {
        results: [{ content: "The person asked which quarter sold more." }],
      },
      extra: {
        context_management: { type: "compaction", boundary: "replace" },
      },
    });
    // After the notice it covered, before the round that followed.
    expect(trajectory.steps[at - 1]?.message).toBe("Today is Friday.");
    expect(trajectory.steps[at + 1]?.tool_calls?.[0]?.tool_call_id).toBe("d1");
  });

  it("keeps the rest of the saved conversation under extra, each part once", async () => {
    const task = conversation();
    const { trajectory } = await exported(task);

    const rest = trajectory.extra?.zhiyin["conversation"] as Record<
      string,
      unknown
    >;
    expect(Object.keys(rest).sort()).toEqual(
      Object.keys(task)
        .filter(
          (key) =>
            ![
              "modelHistory",
              "modelResponses",
              "actions",
              "specialistRuns",
            ].includes(key),
        )
        .sort(),
    );
    expect(rest["messages"]).toEqual(task.messages);
    expect(
      trajectory.subagent_trajectories?.[0]?.extra?.zhiyin["run"],
    ).toMatchObject({
      id: "run-1",
      handoff: { report: "It holds." },
    });
    expect(trajectory.notes).toContain("does not reach inside pictures");
  });

  it("writes plain ASCII that reads back as the same text", async () => {
    const task = conversation();
    const text = "第二季度 “Q2” 🙂";
    const { trajectory } = await conversationTrajectory(
      {
        ...task,
        messages: [{ ...task.messages[0]!, text, attachments: [] }],
        modelHistory: [{ id: "h1", kind: "message", messageId: "m1" }],
      },
      about,
      pictures,
    );

    expect(trajectory).toMatch(/^[\x20-\x7e\n]*$/);
    expect((JSON.parse(trajectory) as Trajectory).steps[0]?.message).toBe(text);
  });

  it("keeps a call's arguments as written when they are not an object", async () => {
    const task = conversation();
    const { trajectory } = await exported({
      ...task,
      modelHistory: [
        {
          id: "h1",
          kind: "calls",
          text: "",
          calls: [
            { id: "c1", name: "read_file", arguments: '{"path": "q2.cs' },
          ],
        },
      ],
    });

    expect(trajectory.steps[0]?.tool_calls?.[0]).toMatchObject({
      arguments: {},
      extra: { zhiyin: { arguments: '{"path": "q2.cs' } },
    });
  });
});
