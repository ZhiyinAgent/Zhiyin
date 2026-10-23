/**
 * What a person approves is what runs, so the request shows each input whole,
 * however long, and the record kept afterwards keeps it whole too: once the
 * model’s own copy is condensed away, the record is the only account left
 * of what the call was given.
 */

import { describe, expect, it } from "vitest";
import { until, withPlan, type Step } from "./plan-fixture.js";

describe("an approval for a call with a long input", () => {
  it("shows the input whole, not its ends with the middle left out", async () => {
    const text = `START${"middle ".repeat(1000)}END`;
    const steps: Step[] = [
      {
        calls: [
          { name: "write_note", id: "long", args: { path: "a.md", text } },
        ],
      },
    ];
    const fixture = withPlan({
      script: (request) => steps[request - 1] ?? { text: "Done." },
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Write it down");
    await until(
      () => fixture.loop.snapshot().tasks[0]?.phase.kind === "approval",
    );
    const phase = fixture.loop.snapshot().tasks[0]?.phase;
    if (phase?.kind !== "approval") throw new Error("No approval was asked.");

    expect(phase.prompt.invocation?.arguments).toContainEqual({
      name: "text",
      value: text,
    });

    await fixture.loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await running;
    const [action] = fixture.loop.snapshot().tasks[0]?.actions ?? [];
    expect(action?.invocation?.arguments).toContainEqual({
      name: "text",
      value: text,
    });
  });

  it("keeps the input whole in the record of a call the person declined", async () => {
    const text = `START${"middle ".repeat(5000)}END`;
    const steps: Step[] = [
      {
        calls: [
          { name: "write_note", id: "long", args: { path: "a.md", text } },
        ],
      },
    ];
    const fixture = withPlan({
      script: (request) => steps[request - 1] ?? { text: "Done." },
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Write it down");
    await until(
      () => fixture.loop.snapshot().tasks[0]?.phase.kind === "approval",
    );
    const phase = fixture.loop.snapshot().tasks[0]?.phase;
    if (phase?.kind !== "approval") throw new Error("No approval was asked.");
    await fixture.loop.resolveApproval(taskId, phase.prompt.id, "deny");
    await running;

    const [action] = fixture.loop.snapshot().tasks[0]?.actions ?? [];
    expect(action?.status).toBe("denied");
    expect(action?.invocation?.arguments).toContainEqual({
      name: "text",
      value: text,
    });
  });
});
