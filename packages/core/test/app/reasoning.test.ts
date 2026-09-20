import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import { OpenRouterModelClient } from "@zhiyin/model-client";
import type { TestApp as AgentLoop } from "./support.js";
import { stubDependencies, until, loopFrom } from "./support.js";

describe("reasoning in a conversation", () => {
  it("carries provider-shaped reasoning through the production parser into live and saved task state", async () => {
    const seen: AppEvent[] = [];
    const deps = stubDependencies((event) => seen.push(event));
    let wire = "";
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = new OpenRouterModelClient({
      apiKey: async () => "test-key",
      modelInfo: async () => ({
        reasoning: {
          mandatory: true,
          default_enabled: true,
          supported_efforts: ["high"],
        },
      }),
      fetcher: async (_url, init) => {
        wire = init.body;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: (async function* () {
            const encode = (value: unknown) =>
              new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
            yield encode({
              choices: [
                {
                  delta: { reasoning: "Multiply 37 by 20, then subtract 37." },
                },
              ],
            });
            await pending;
            yield encode({
              choices: [{ delta: { content: "703." }, finish_reason: "stop" }],
            });
            yield new TextEncoder().encode("data: [DONE]\n\n");
          })(),
        };
      },
    });
    let saved: ReturnType<AgentLoop["snapshot"]> | undefined;
    const loop = loopFrom({
      ...deps,
      model,
      sessions: {
        ...deps.sessions,
        saveWorkspace: async (snapshot) => {
          saved = structuredClone(snapshot);
        },
      },
    });
    const id = await loop.createTask();
    const work = loop.start(id, "Compute 37 times 19", {
      enabled: true,
      effort: "high",
    });
    await until(() =>
      seen.some(
        (event) =>
          event.kind === "taskChanged" &&
          event.data.messages.some(
            (message) => message.reasoning?.status === "streaming",
          ),
      ),
    );
    expect(JSON.parse(wire).reasoning).toEqual({
      enabled: true,
      effort: "high",
    });
    release();
    await work;
    expect(saved?.tasks[0]?.messages.at(-1)).toMatchObject({
      text: "703.",
      reasoning: {
        text: "Multiply 37 by 20, then subtract 37.",
        status: "complete",
      },
    });
    expect(saved?.tasks[0]?.phase.kind).toBe("completed");
  });
  it("restores an unfinished reasoning trace as interrupted", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => ({
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          skills: [],
          subagents: [],
          usage: { status: "unavailable", reason: "none" },
          tasks: [
            {
              id: "task-1",
              title: "Research",
              updatedLabel: "Now",
              phase: { kind: "working", steps: [] },
              messages: [
                {
                  id: "a",
                  role: "assistant",
                  text: "",
                  reasoning: { text: "Partial thought.", status: "streaming" },
                },
              ],
            },
          ],
        }),
      },
    });
    await loop.initialize();
    expect(loop.snapshot().tasks[0]?.messages[0]?.reasoning?.status).toBe(
      "interrupted",
    );
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });
});
