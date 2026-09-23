/**
 * A turn may end while a specialist it delegated to keeps running in the
 * background. The task shows what is still outstanding while that lasts, and
 * a fresh automatic turn picks up the handoff once the specialist settles —
 * without anyone sending a new message.
 */

import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/model-client";
import {
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
} from "./support.js";

describe("waking a task after a background specialist settles", () => {
  it("marks the turn completed with the specialist still running, then wakes with its handoff", async () => {
    const base = stubDependencies(() => {});
    let releaseSpecialist!: () => void;
    const specialistGate = new Promise<void>((resolve) => {
      releaseSpecialist = resolve;
    });
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews work.",
              instructions: "Review the evidence.",
            },
          ],
        }),
      ]),
      model: {
        ...base.model,
        send: async function* (request) {
          requests.push(request);
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            await specialistGate;
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "finish-1",
              name: "finish_specialist",
              argumentsDelta: JSON.stringify({
                summary: "All clear.",
                findings: [],
                recommendations: [],
                limitations: [],
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          if (!text.includes("Review this.")) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Review this.",
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          yield {
            kind: "textDelta" as const,
            text: text.includes("finished in the background")
              ? "Review complete."
              : "I'll let you know once it's reviewed.",
          };
          yield { kind: "done" as const };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");

    // The parent's own turn ended without waiting for the specialist.
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "completed",
      outcome: { summary: "I'll let you know once it's reviewed." },
      backgroundSpecialistIds: ["specialist-1"],
    });
    expect(loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status).toBe(
      "running",
    );
    // Still reported as running, so a "Stop" affordance stays reachable —
    // but the parent's own turn already let go, so a new message on this
    // same task would not be refused as "already running".
    expect(loop.running(taskId)).toBe(true);

    releaseSpecialist();
    await until(
      () =>
        loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status === "completed",
    );
    await until(
      () =>
        (loop.snapshot().tasks[0]?.phase as { outcome?: { summary?: string } })
          .outcome?.summary === "Review complete.",
    );

    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "completed",
      outcome: { summary: "Review complete." },
    });
    expect(
      (
        loop.snapshot().tasks[0]?.phase as {
          backgroundSpecialistIds?: string[];
        }
      ).backgroundSpecialistIds,
    ).toBeUndefined();
    expect(loop.running(taskId)).toBe(false);
    // The handoff reached the woken turn as Zhiyin's notice, at the end.
    const woken = requests.at(-1)?.messages ?? [];
    expect(woken.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringMatching(/^<zhiyin-notice kind="handoff">/),
    });
  });
});
