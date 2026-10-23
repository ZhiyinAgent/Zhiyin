/**
 * Asking for the answer now, from the window's side and through the client
 * that talks to the provider: the reasoning request is stopped, and the one
 * that follows goes without reasoning where the chosen model lists it as
 * optional, and as before where the model cannot answer without it.
 */

import { describe, expect, it } from "vitest";
import { CHANNEL } from "@zhiyin/contract";
import { OpenRouterModelClient } from "@zhiyin/model-client";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies, until } from "./support.js";

const encode = (value: unknown) =>
  new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);

/** A provider that reasons until it is stopped, then answers the next request. */
function setUp({ mandatory }: { readonly mandatory: boolean }) {
  const wires: { readonly reasoning?: unknown }[] = [];
  const model = new OpenRouterModelClient({
    model: "z-ai/glm-5.3-flash",
    apiKey: async () => "test-key",
    modelInfo: async () => ({
      reasoning: {
        mandatory,
        default_enabled: true,
        supported_efforts: ["high"],
      },
    }),
    fetcher: async (_url, init) => {
      wires.push(JSON.parse(init.body) as { readonly reasoning?: unknown });
      const first = wires.length === 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          if (!first) {
            yield encode({
              choices: [{ delta: { content: "703." }, finish_reason: "stop" }],
            });
            yield new TextEncoder().encode("data: [DONE]\n\n");
            return;
          }
          yield encode({
            choices: [{ delta: { reasoning: "Multiply 37 by 20, then" } }],
          });
          await new Promise<never>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason as Error),
              { once: true },
            );
          });
        })(),
      };
    },
  });
  const workspace = loopFrom({
    ...stubDependencies(() => {}),
    revealDelayMs: 0,
    model,
  });
  const core = new Core({
    workspace,
    dataFolder: "C:/data",
    ownership: { claim: async () => {}, release: async () => {} },
    viewChecks: { answer: () => {}, abandon: () => {} },
    commands: {
      runningCommands: () => [],
      commandOutput: async () => undefined,
      stopCommandForPerson: async () => {},
      onCommandsChanged: () => {},
    },
    chooseFolder: async () => undefined,
    chooseSaveLocation: async () => undefined,
    openExternal: async () => {},
    openPath: async () => {},
    showInFolder: async () => {},
    version: "1.0.0",
  });
  return { core, workspace, wires };
}

async function askedForTheAnswer(mandatory: boolean) {
  const { core, workspace, wires } = setUp({ mandatory });
  await workspace.initialize();
  await until(() => workspace.settings.current()?.reasoning !== undefined);
  const taskId = await workspace.createTask();
  const conversation = () => workspace.snapshot().tasks[0];

  await core.receive(CHANNEL.sendMessage, [
    taskId,
    "Compute 37 times 19",
    { enabled: true, effort: "high" },
  ]);
  await until(
    () => conversation()?.messages.at(-1)?.reasoning?.status === "streaming",
  );
  const stopped = await core.receive(CHANNEL.answerNow, [taskId]);
  await until(() => conversation()?.phase.kind === "completed");

  return { stopped, wires, conversation: conversation() };
}

describe("asking for the answer now, from the window", () => {
  it("asks again without reasoning, where the chosen model can answer without it", async () => {
    const { stopped, wires, conversation } = await askedForTheAnswer(false);

    expect(stopped).toBe(true);
    expect(wires.map((wire) => wire.reasoning)).toEqual([
      { enabled: true, effort: "high" },
      { enabled: false },
    ]);
    expect(
      conversation?.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "Compute 37 times 19"],
      ["assistant", "703."],
    ]);
  });

  it("asks again with the same reasoning, where the chosen model requires it", async () => {
    const { stopped, wires, conversation } = await askedForTheAnswer(true);

    expect(stopped).toBe(true);
    expect(wires.map((wire) => wire.reasoning)).toEqual([
      { enabled: true, effort: "high" },
      { enabled: true, effort: "high" },
    ]);
    expect(conversation?.messages.at(-1)?.text).toBe("703.");
  });

  it("answers that nothing was reasoning in a conversation at rest", async () => {
    const { core, workspace } = setUp({ mandatory: false });
    const taskId = await workspace.createTask();

    expect(await core.receive(CHANNEL.answerNow, [taskId])).toBe(false);
    await expect(core.receive(CHANNEL.answerNow, [])).rejects.toThrow();
  });
});
