/**
 * Every tool call says what it is for, so no model call is made to name it;
 * one that says nothing is named in the background, never holding up its
 * approval.
 */

import { describe, expect, it } from "vitest";
import {
  LABEL,
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
        calls: [call("list_directory", id, { purpose: `Look in ${id}.` })],
      })),
      {
        calls: [
          call("write_note", "five", {
            purpose: "Save the summary the person asked for.",
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

  it("does not hand the tool its purpose, and shows it with the action", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? { calls: [call("list_directory", "one", { purpose: "Look." })] }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(fixture.inspected).toEqual([{ path: "one.md" }, { path: "one.md" }]);
    expect(task(fixture)?.actions?.[0]).toMatchObject({
      description: "Look.",
    });
  });

  it("links no call to a plan item", async () => {
    const fixture = withPlan({ script: () => finish });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    for (const tool of fixture.requests[0]?.tools ?? [])
      expect(JSON.stringify(tool.inputSchema)).not.toContain("plan_item");
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

  it("asks the labelling call nothing about the plan", async () => {
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

  it("keeps every write when its label lands while a later action is being saved", async () => {
    const fixture: ReturnType<typeof withPlan> = withPlan({
      savesSlowly: true,
      holdLabels: true,
      label: { title: "Look in one", description: "Finds the reports." },
      script: (request) => {
        // The label answers while the turn is saving the actions after it.
        if (request === 3) fixture.release.forEach((release) => release());
        return request === 1
          ? { calls: [call("list_directory", "one")] }
          : request <= 6
            ? {
                calls: [
                  call("list_directory", `n${request}`, { purpose: "Look." }),
                ],
              }
            : finish;
      },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");
    await until(() => task(fixture)?.actions?.[0]?.action === "Look in one");

    expect(task(fixture)?.actions?.map((action) => action.status)).toEqual(
      Array(6).fill("completed"),
    );
    expect(task(fixture)?.phase.kind).toBe("completed");
  });
});
