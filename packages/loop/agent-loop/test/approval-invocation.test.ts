/**
 * What a person approves is what runs, so the request shows each input whole,
 * however long, and the record kept afterwards keeps it whole too: once the
 * model’s own copy is condensed away, the record is the only account left
 * of what the call was given.
 */

import { describe, expect, it } from "vitest";
import { until, withPlan, type Step } from "./plan-fixture.js";
import { loopFrom, stubDependencies } from "./support.js";

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

describe("the inspection made again after approval", () => {
  it("runs the call when it says the same, whatever the order of its fields", async () => {
    let inspections = 0;
    let executed = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "ask" as const, reason: "Asks." }),
      },
      tools: {
        list: () => [
          {
            name: "write_note",
            description: "Write a note.",
            inputSchema: { type: "object" },
          },
        ],
        // The same account each time, its fields written in another order.
        inspect: async () =>
          (inspections += 1) === 1
            ? {
                ok: true as const,
                action: "Write a note",
                target: "a.md",
                command: "write_note",
              }
            : {
                command: "write_note",
                target: "a.md",
                action: "Write a note",
                ok: true as const,
              },
        execute: async () => {
          executed += 1;
          return { ok: true as const, value: "Written." };
        },
      },
      model: {
        ...deps.model,
        send: (() => {
          let request = 0;
          return async function* () {
            request += 1;
            if (request === 1)
              yield {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "call-1",
                name: "write_note",
                argumentsDelta: '{"path":"a.md"}',
              };
            else yield { kind: "textDelta" as const, text: "Done." };
            yield { kind: "done" as const };
          };
        })(),
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Write it down");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    const phase = loop.snapshot().tasks[0]?.phase;
    if (phase?.kind !== "approval") throw new Error("No approval was asked.");
    await loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await running;

    expect(executed).toBe(1);
    expect(loop.snapshot().tasks[0]?.actions[0]?.status).toBe("completed");
  });
});
