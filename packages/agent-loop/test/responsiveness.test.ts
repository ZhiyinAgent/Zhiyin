/**
 * What the window hears while a round is being composed.
 *
 * The report was "a bit frozen and suddenly all the charts and mermaid diagrams
 * popped out". Mermaid was measured and cleared: a cold load drawing three
 * diagrams blocked the renderer's main thread for 163 ms in total, which nobody
 * sees. That left the stretch before the drawings exist rather than the drawing
 * of them, and this is where that stretch is.
 *
 * A round's tool call arrives as a run of argument fragments. The loop adds each
 * one to a buffer and tells nobody, so from the first fragment to the end of the
 * round the window is told nothing at all - and a model writing several chart
 * specifications with long data arrays spends a long time in exactly that state.
 * Every view then lands at once when the round ends, which is the second half of
 * what was reported.
 *
 * This measures it as the window experiences it: every event the app is given,
 * stamped with how much of the call had arrived when it was given. Nothing here
 * is about how the loop is written; a loop that announced composition some other
 * way would pass unchanged.
 */

import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceTools } from "@zhiyin/tools";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { stubDependencies, loopFrom } from "./support.js";

/** Split one fragment per character, which is the slowest a call can arrive. */
const call = JSON.stringify({ path: "inside.txt" });

describe("a turn whose round takes a while to compose", () => {
  it("tells the window something while the model is still writing the call", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-responsiveness-"));
    await writeFile(join(root, "inside.txt"), "in", "utf8");
    const workspace = new WorkspaceTools(root, { shell: undefined });

    /** How much of the call had arrived. Stamped onto everything the app hears. */
    let arrived = 0;
    const heard: { readonly kind: string; readonly arrived: number }[] = [];

    const deps = stubDependencies((event) =>
      heard.push({ kind: event.kind, arrived }),
    );
    const loop = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: workspace,
      workspace,
      model: {
        ...deps.model,
        send: (function () {
          let requests = 0;
          return async function* () {
            requests += 1;
            if (requests === 1) {
              for (const fragment of [...call]) {
                arrived += 1;
                yield {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "read-1",
                  name: arrived === 1 ? "read_file" : "",
                  argumentsDelta: fragment,
                };
                // Anything the loop wants to announce gets its chance here, so
                // silence in the record is the loop's silence and not this
                // generator never yielding the thread.
                await new Promise((resolve) => setTimeout(resolve, 0));
              }
            } else {
              yield { kind: "textDelta" as const, text: "Read." };
            }
            yield { kind: "done" as const };
          };
        })(),
      },
    });

    const taskId = await loop.createTask();
    await loop.start(taskId, "Read the note");

    const whileComposing = heard.filter(
      (event) => event.arrived > 0 && event.arrived < call.length,
    );

    expect({
      silentThroughout: whileComposing.length === 0,
      fragments: call.length,
      timeline: heard.map((event) => `${event.kind}@${event.arrived}`),
    }).toMatchObject({ silentThroughout: false });
  });
});
