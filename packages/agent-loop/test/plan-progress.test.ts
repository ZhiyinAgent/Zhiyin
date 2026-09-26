/**
 * The working model sees the plan it is judged on and reports its progress on
 * it. Progress is its claim; the verdict stays the judge's.
 */

import { describe, expect, it } from "vitest";
import { planText } from "../src/plan-progress.js";
import type { WorkspaceTask } from "@zhiyin/contract";
import {
  notices,
  resultOf,
  reviewedIds,
  withPlan,
  type Step,
} from "./plan-fixture.js";

const listing = (id: string, path = "reports"): Step => ({
  calls: [{ name: "list_directory", args: { path }, id }],
});
const update = (id: string, args: Record<string, unknown>): Step => ({
  calls: [{ name: "update_plan", args, id }],
});
const finish: Step = { text: "Done." };

const plan = (fixture: ReturnType<typeof withPlan>) =>
  fixture.loop.snapshot().tasks[0]?.plan ?? [];

describe("the plan the working model sees", () => {
  it("is in the first request of the turn, every item with its criterion", async () => {
    const fixture = withPlan({ script: () => finish });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const [notice] = notices(fixture.requests[0], "plan");
    expect(notice?.content).toContain("plan-1");
    expect(notice?.content).toContain(
      "The reports folder was listed and its files named.",
    );
    expect(notice?.content).toContain("plan-2");
    expect(notice?.content).toContain(
      "summary.md exists and names every report.",
    );
  });

  it("is not sent when the request needed no plan", async () => {
    const fixture = withPlan({ plan: { items: [] }, script: () => finish });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Hello");

    expect(notices(fixture.requests[0], "plan")).toHaveLength(0);
  });

  it("is no longer said to be shown only by the interface", async () => {
    const fixture = withPlan({ script: () => finish });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(String(fixture.requests[0]?.messages[0]?.content)).not.toContain(
      "separately shows the task plan",
    );
  });

  it("comes back after 10 rounds without update_plan while items are open, and not for the next 9", async () => {
    const fixture = withPlan({
      script: (request) =>
        request <= 21
          ? listing(`call-${request}`, `folder-${request}`)
          : finish,
      workLimits: { maximumToolRounds: 30 },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const counts = fixture.requests.map(
      (request) => notices(request, "plan").length,
    );
    expect(counts.slice(0, 10)).toEqual(Array(10).fill(1));
    expect(counts.slice(10, 20)).toEqual(Array(10).fill(2));
    expect(counts[20]).toBe(3);
    expect(notices(fixture.requests[10], "plan")[1]?.content).toContain(
      "Do not present the task as finished while items are still open",
    );
  });

  it("does not come back while the model keeps it current", async () => {
    const fixture = withPlan({
      script: (request) =>
        request > 14
          ? finish
          : request % 5 === 0
            ? update(`update-${request}`, {
                items: [{ id: "plan-1", progress: "in_progress" }],
              })
            : listing(`call-${request}`, `folder-${request}`),
      workLimits: { maximumToolRounds: 30 },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(
      fixture.requests.map((request) => notices(request, "plan").length),
    ).toEqual(Array(15).fill(1));
  });
});

describe("the verdicts in the plan the model sees", () => {
  it("names each of the judge's verdicts with its reason", () => {
    const text = planText([
      {
        id: "plan-1",
        title: "List the reports",
        criterion: "The reports were listed.",
        status: "verified",
        verification: "The listing names q1.pdf.",
      },
      {
        id: "plan-2",
        title: "Check the totals",
        criterion: "The totals match the CSV.",
        status: "needs-attention",
        verification: "No call compared the totals.",
      },
      {
        id: "plan-3",
        title: "Write the summary",
        criterion: "summary.md names every report.",
        status: "couldnt-judge",
        verification: "The review request failed.",
      },
    ]);
    expect(text).toContain("Verdict: verified: The listing names q1.pdf.");
    expect(text).toContain(
      "Verdict: not verified: No call compared the totals.",
    );
    expect(text).toContain(
      "Verdict: could not be judged: The review request failed.",
    );
  });
});

describe("update_plan", () => {
  it("offers no way to set a verdict", async () => {
    const fixture = withPlan({ script: () => finish });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const tool = fixture.requests[0]?.tools.find(
      (item) => item.name === "update_plan",
    );
    const schema = JSON.stringify(tool?.inputSchema);
    expect(tool).toBeDefined();
    expect(schema).not.toMatch(/verdict|verified|"status"/);
  });

  it("records done with this turn's calls as the assistant's claim, and leaves the verdict alone", async () => {
    const fixture = withPlan({
      script: (request) =>
        [
          listing("call-list"),
          update("update-1", {
            items: [
              {
                id: "plan-1",
                progress: "done",
                evidence: [
                  {
                    call_id: "call-list",
                    shows: "It names q1.pdf and q2.pdf.",
                  },
                ],
                steps: [{ text: "List the folder", done: true }],
              },
            ],
          }),
        ][request - 1] ?? finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(resultOf(fixture.requests[2], "update-1")).toMatchObject({
      ok: true,
    });
    expect(plan(fixture)[0]).toMatchObject({
      progress: "done",
      evidence: [{ callId: "call-list", shows: "It names q1.pdf and q2.pdf." }],
      steps: [{ text: "List the folder", done: true }],
    });
    expect(plan(fixture)[0]?.status).not.toBe("verified");
  });

  it("rejects done without the calls that show it, saying why", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("update-1", { items: [{ id: "plan-1", progress: "done" }] })
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const result = resultOf(fixture.requests[1], "update-1");
    expect(result).toMatchObject({ ok: false, refusedBy: "input-check" });
    expect(String(result.reason)).toMatch(/call/i);
    expect(plan(fixture)[0]?.progress).toBeUndefined();
  });

  it("rejects done that cites a call from an earlier turn", async () => {
    const earlier: WorkspaceTask = {
      id: "task-1",
      title: "Reports",
      titleSource: "manual",
      updatedLabel: "Earlier",
      messages: [],
      actions: [],
      phase: { kind: "draft" },
    };
    let turn = 1;
    const fixture = withPlan({
      restore: [earlier],
      script: (request) => {
        if (turn === 1) return request === 1 ? listing("old-call") : finish;
        return request === 3
          ? update("update-1", {
              items: [
                {
                  id: "plan-1",
                  progress: "done",
                  evidence: [{ call_id: "old-call", shows: "The listing." }],
                },
              ],
            })
          : finish;
      },
    });

    await fixture.loop.start("task-1", "List the reports");
    turn = 2;
    await fixture.loop.start("task-1", "Now mark it done");

    const result = resultOf(fixture.requests[3], "update-1");
    expect(result).toMatchObject({ ok: false });
    expect(String(result.reason)).toContain("old-call");
    expect(String(result.reason)).toMatch(/this turn/);
  });

  it("rejects cancelled without a reason, and shows the reason when given", async () => {
    const fixture = withPlan({
      script: (request) =>
        [
          update("update-1", {
            items: [{ id: "plan-2", progress: "cancelled" }],
          }),
          update("update-2", {
            items: [
              {
                id: "plan-2",
                progress: "cancelled",
                reason: "The person asked for no summary.",
              },
            ],
          }),
        ][request - 1] ?? finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(resultOf(fixture.requests[1], "update-1")).toMatchObject({
      ok: false,
    });
    expect(plan(fixture)[1]).toMatchObject({
      progress: "cancelled",
      progressNote: "The person asked for no summary.",
    });
  });

  it("rejects an item id the plan does not have, naming the ones it does", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("update-1", {
              items: [{ id: "plan-9", progress: "in_progress" }],
            })
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const reason = String(resultOf(fixture.requests[1], "update-1").reason);
    expect(reason).toContain("plan-9");
    expect(reason).toContain("plan-1, plan-2");
  });

  it("adds a criterion as the assistant's, and it is judged at the end of the turn", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("update-1", {
              add: [
                {
                  title: "Check the totals",
                  criterion: "The totals in q2.pdf match the CSV.",
                },
              ],
            })
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(plan(fixture)[2]).toMatchObject({
      id: "plan-3",
      title: "Check the totals",
      addedBy: "assistant",
    });
    // One review, for the planner's items and the one the model added.
    expect(fixture.reviews.map(reviewedIds)).toEqual([
      ["plan-1", "plan-2", "plan-3"],
    ]);
  });

  it("holds the plan to eight items", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("update-1", {
              add: Array.from({ length: 7 }, (_, index) => ({
                title: `Extra ${index}`,
                criterion: `Extra criterion ${index}.`,
              })),
            })
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(resultOf(fixture.requests[1], "update-1")).toMatchObject({
      ok: false,
    });
    expect(plan(fixture)).toHaveLength(2);
  });

  it("does not judge a cancelled item", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("update-1", {
              items: [
                { id: "plan-2", progress: "cancelled", reason: "Not wanted." },
              ],
            })
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(fixture.reviews.map(reviewedIds)).toEqual([["plan-1"]]);
  });
});
