/**
 * A model repeating itself is told so, once it has done the same thing three
 * times, instead of spending the budget until the person is asked to renew it.
 */

import { describe, expect, it } from "vitest";
import { notices, until, withPlan, type Step } from "./plan-fixture.js";

const same: Step = {
  calls: [{ name: "list_directory", args: { path: "reports" } }],
};
const finish: Step = { text: "Done." };

describe("the loop guard", () => {
  it("puts one loop notice in the fourth request after three identical list_directory calls", async () => {
    const fixture = withPlan({
      script: (request) => (request <= 3 ? same : finish),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests[2], "loop")).toHaveLength(0);
    const found = notices(fixture.requests[3], "loop");
    expect(found).toHaveLength(1);
    expect(found[0]?.content).toContain("list_directory");
  });

  it("ignores the purpose a call gives when comparing it", async () => {
    const fixture = withPlan({
      script: (request) =>
        request <= 3
          ? {
              calls: [
                {
                  name: "list_directory",
                  args: {
                    path: "reports",
                    purpose: `Look again, try ${request}.`,
                  },
                },
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests[3], "loop")).toHaveLength(1);
  });

  it("does not count different calls as a loop", async () => {
    const fixture = withPlan({
      script: (request) =>
        request <= 5
          ? {
              calls: [
                { name: "list_directory", args: { path: `f-${request}` } },
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(0);
  });

  it("starts counting again after a change to the workspace", async () => {
    const write: Step = {
      calls: [{ name: "write_note", args: { path: "notes.md" } }],
    };
    const script = [same, same, write, same, finish];
    const fixture = withPlan({
      script: (request) => script[request - 1] ?? finish,
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Summarise the reports");
    await until(
      () => fixture.loop.snapshot().tasks[0]?.phase.kind === "approval",
    );
    const phase = fixture.loop.snapshot().tasks[0]?.phase;
    if (phase?.kind === "approval")
      await fixture.loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await running;

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(0);
  });

  it("sends at most two notices in a turn", async () => {
    const fixture = withPlan({
      script: (request) => (request <= 12 ? same : finish),
      workLimits: { maximumToolRounds: 30 },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(2);
  });

  it("gives the work-budget question the reason when a loop notice fired", async () => {
    const fixture = withPlan({
      script: (request) => (request <= 6 ? same : finish),
      workLimits: { maximumToolRounds: 4 },
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Summarise the reports");
    await until(() => fixture.loop.snapshot().tasks[0]?.phase.kind === "input");
    const phase = fixture.loop.snapshot().tasks[0]?.phase;
    const prompt = phase?.kind === "input" ? phase.prompt : undefined;
    expect(prompt?.kind === "workBudget" && prompt.reason).toBe(
      "The assistant repeated the same list_directory call 4 times.",
    );
    await fixture.loop.cancel(taskId);
    await running;
  });
});
