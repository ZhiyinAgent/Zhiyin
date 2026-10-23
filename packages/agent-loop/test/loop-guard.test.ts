/**
 * A model repeating itself is told so, once it has done the same thing three
 * times, instead of spending the budget until the person is asked to renew it.
 */

import { describe, expect, it } from "vitest";
import { notices, until, withPlan, type Step } from "./plan-fixture.js";
import { defaultWorkLimits } from "../src/turn/work-limits.js";

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

  it("puts one loop notice in the fourth request after one tool failed the same way three times on different inputs", async () => {
    const fixture = withPlan({
      // Names that differ only in their digits fail for the same reason.
      script: (request) =>
        request <= 3
          ? {
              calls: [
                { name: "read_file", args: { path: `report-${request}.md` } },
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests[2], "loop")).toHaveLength(0);
    const found = notices(fixture.requests[3], "loop");
    expect(found).toHaveLength(1);
    expect(found[0]?.content).toContain(
      "read_file has failed the same way 3 times in a row",
    );
    expect(found[0]?.content).toContain("does not exist");
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

  it("does not count the same call as a loop when it answers differently each time", async () => {
    // Three screenshots of three states of a page: same input, new picture.
    let listed = 0;
    const fixture = withPlan({
      script: (request) => (request <= 3 ? same : finish),
      listing: () => `State ${(listed += 1)}`,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(0);
  });

  it("does not count identical calls as a loop when other calls come between them", async () => {
    const other: Step = {
      calls: [{ name: "read_file", args: { path: "q1.pdf" } }],
    };
    const script = [same, other, same, other, same, finish];
    const fixture = withPlan({
      script: (request) => script[request - 1] ?? finish,
      files: { "q1.pdf": "Quarter one." },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(0);
  });

  it("counts failures whose reasons differ only past their first 160 characters as the same", async () => {
    const long = "a".repeat(165);
    const fixture = withPlan({
      script: (request) =>
        request <= 3
          ? {
              calls: [
                {
                  name: "read_file",
                  args: { path: `${long}-${"xyz"[request - 1]}.md` },
                },
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests[3], "loop")).toHaveLength(1);
  });

  it("does not count failures whose reasons differ within their first 160 characters as the same", async () => {
    const fixture = withPlan({
      script: (request) =>
        request <= 3
          ? {
              calls: [
                {
                  name: "read_file",
                  args: { path: `report-${"xyz"[request - 1]}.md` },
                },
              ],
            }
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests[3], "loop")).toHaveLength(0);
  });

  it("does not count the same change that succeeded as a loop", async () => {
    const write: Step = {
      calls: [{ name: "write_note", args: { path: "notes.md" } }],
    };
    const fixture = withPlan({
      script: (request) => (request <= 3 ? write : finish),
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Keep the notes");
    const answered = new Set<string>();
    const asked = () => {
      const phase = fixture.loop.snapshot().tasks[0]?.phase;
      return phase?.kind === "approval" && !answered.has(phase.prompt.id)
        ? phase.prompt.id
        : undefined;
    };
    for (let approved = 0; approved < 3; approved += 1) {
      await until(() => asked() !== undefined);
      const id = asked() as string;
      answered.add(id);
      await fixture.loop.resolveApproval(taskId, id, "allow");
    }
    await running;

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(0);
  });

  it("does not count failures as a loop when a call that worked comes between them", async () => {
    const failing = (n: number): Step => ({
      calls: [{ name: "read_file", args: { path: `report-${n}.md` } }],
    });
    const worked: Step = {
      calls: [{ name: "read_file", args: { path: "q1.pdf" } }],
    };
    const script = [failing(1), failing(2), worked, failing(3), failing(4)];
    const fixture = withPlan({
      script: (request) => script[request - 1] ?? finish,
      files: { "q1.pdf": "Quarter one." },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(0);
  });

  it("starts counting failures again after a change to the workspace", async () => {
    const failing = (n: number): Step => ({
      calls: [{ name: "read_file", args: { path: `report-${n}.md` } }],
    });
    const write: Step = {
      calls: [{ name: "write_note", args: { path: "notes.md" } }],
    };
    const script = [failing(1), failing(2), write, failing(3), failing(4)];
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
      workLimits: { ...defaultWorkLimits, maximumToolRounds: 30 },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(notices(fixture.requests.at(-1), "loop")).toHaveLength(2);
  });

  /**
   * Read by the person deciding whether to let the work go on, so it names the
   * step the way the action list does, not by the tool it called.
   */
  it("gives the work-budget question the reason when a loop notice fired", async () => {
    const fixture = withPlan({
      script: (request) => (request <= 6 ? same : finish),
      workLimits: { ...defaultWorkLimits, maximumToolRounds: 4 },
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Summarise the reports");
    await until(() => fixture.loop.snapshot().tasks[0]?.phase.kind === "input");
    const phase = fixture.loop.snapshot().tasks[0]?.phase;
    const prompt = phase?.kind === "input" ? phase.prompt : undefined;
    expect(prompt?.kind === "workBudget" && prompt.reason).toBe(
      // The fixture names every step "Generated title", as the action list would.
      "Zhiyin did the same step 4 times in a row: Generated title.",
    );
    await fixture.loop.cancel(taskId);
    await running;
  });
});
