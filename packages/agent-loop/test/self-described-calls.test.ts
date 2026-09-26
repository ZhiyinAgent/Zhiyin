/**
 * Every tool call says what it is for and which plan item it serves, so no
 * model call is made to name it; one that says nothing is named in the
 * background, never holding up its approval.
 */

import { describe, expect, it } from "vitest";
import {
  LABEL,
  resultOf,
  until,
  withPlan,
  type Call,
  type Step,
} from "./plan-fixture.js";

const call = (
  name: string,
  id: string,
  extra: Record<string, unknown> = {},
): Call => ({ name, id, args: { path: `${id}.md`, ...extra } });
const finish: Step = { text: "Done." };

const task = (fixture: ReturnType<typeof withPlan>) =>
  fixture.loop.snapshot().tasks[0];

async function approveEach(
  fixture: ReturnType<typeof withPlan>,
  taskId: string,
  running: Promise<void>,
) {
  let settled = false;
  void running.finally(() => (settled = true));
  while (!settled) {
    const phase = task(fixture)?.phase;
    if (phase?.kind === "approval")
      await fixture.loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await running;
}

describe("a tool call that describes itself", () => {
  it("makes no auxiliary request between five calls, and its approval shows its purpose", async () => {
    const steps: Step[] = [
      ...["one", "two", "three", "four"].map((id) => ({
        calls: [
          call("list_directory", id, {
            purpose: `Look in ${id}.`,
            plan_item: "plan-1",
          }),
        ],
      })),
      {
        calls: [
          call("write_note", "five", {
            purpose: "Save the summary the person asked for.",
            plan_item: "plan-2",
          }),
        ],
      },
    ];
    const fixture = withPlan({
      script: (request) => steps[request - 1] ?? finish,
    });
    const taskId = await fixture.loop.createTask();
    const prompts: string[] = [];

    const running = fixture.loop.start(taskId, "Summarise the reports");
    await until(() => task(fixture)?.phase.kind === "approval");
    const phase = task(fixture)?.phase;
    if (phase?.kind === "approval") prompts.push(phase.prompt.reason);
    await approveEach(fixture, taskId, running);

    const work = fixture.log
      .map((entry, index) => (entry === "work" ? index : -1))
      .filter((index) => index >= 0);
    expect(
      fixture.log
        .slice(work[0], work.at(-1))
        .filter((entry) => entry !== "work"),
    ).toEqual([]);
    expect(prompts).toEqual(["Save the summary the person asked for."]);
  });

  it("hands the tool neither purpose nor plan_item", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? {
              calls: [
                call("list_directory", "one", {
                  purpose: "Look.",
                  plan_item: "plan-1",
                }),
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(fixture.inspected).toEqual([{ path: "one.md" }, { path: "one.md" }]);
  });

  it("links the action to the plan item it names", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? {
              calls: [
                call("list_directory", "one", {
                  purpose: "Look.",
                  plan_item: "plan-1",
                }),
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(task(fixture)?.actions?.[0]).toMatchObject({
      description: "Look.",
      planItemId: "plan-1",
    });
  });

  it("leaves an action naming an unknown plan item unlinked, and the result names the valid ids", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? {
              calls: [
                call("list_directory", "one", {
                  purpose: "Look.",
                  plan_item: "plan-9",
                }),
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(task(fixture)?.actions?.[0]?.planItemId).toBeUndefined();
    const result = resultOf(fixture.requests[1], "one");
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result.planItem)).toContain("plan-9");
    expect(JSON.stringify(result.planItem)).toContain("plan-1, plan-2");
  });
});

describe("a tool call that does not describe itself", () => {
  it("shows its approval before the labelling call answers, then the generated title", async () => {
    const fixture = withPlan({
      holdLabels: true,
      label: { title: "Save the summary", description: "Keeps the result." },
      script: (request) =>
        request === 1 ? { calls: [call("write_note", "one")] } : finish,
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Summarise the reports");
    await until(
      () =>
        task(fixture)?.phase.kind === "approval" && fixture.release.length > 0,
    );
    const before = task(fixture)?.phase;
    expect(before?.kind === "approval" && before.prompt.action).toBe(
      "Write a workspace file",
    );

    fixture.release.forEach((release) => release());
    await until(() => {
      const phase = task(fixture)?.phase;
      return (
        phase?.kind === "approval" && phase.prompt.action === "Save the summary"
      );
    });
    await approveEach(fixture, taskId, running);

    expect(task(fixture)?.actions?.[0]).toMatchObject({
      action: "Save the summary",
      description: "Keeps the result.",
    });
  });

  it("no longer asks the labelling call which plan item the action serves", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1 ? { calls: [call("list_directory", "one")] } : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");
    await until(() => fixture.log.includes("label"));

    expect(fixture.labels[0]).toContain(LABEL);
    expect(fixture.labels[0]).not.toContain("planItemId");
  });
});
