/**
 * A message added while another is being answered, from the window's side. The
 * window sends one message at a time and waits for each to be taken, so a send
 * is answered once its message is in the conversation, not when the turn it
 * started is over. Until the model reads it the message waits, and the window
 * can have it sent now or take it back.
 */

import { describe, expect, it } from "vitest";
import { CHANNEL } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { Core } from "../../src/index.js";
import {
  loopFrom,
  stubDependencies,
  until,
  type LoopTestDependencies,
} from "./support.js";

function coreAnswering(model: LoopTestDependencies["model"]["send"]) {
  const dependencies = stubDependencies(() => {});
  const workspace = loopFrom({
    ...dependencies,
    // About what is taken and when, not how far the display trails the model.
    revealDelayMs: 0,
    model: { ...dependencies.model, send: model },
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
  return { core, workspace };
}

describe("a message sent while another is being answered", () => {
  it("is taken once the one before it is in the conversation, and reaches the turn that is running", async () => {
    const requests: ModelRequest[] = [];
    let finishFirstAnswer!: () => void;
    const firstAnswerHeld = new Promise<void>((resolve) => {
      finishFirstAnswer = resolve;
    });
    const { core, workspace } = coreAnswering(async function* (request) {
      requests.push(request);
      yield { kind: "textDelta", text: "Looking." };
      if (requests.length === 1) await firstAnswerHeld;
      yield { kind: "done" };
    });
    const taskId = await workspace.createTask();
    const conversation = () => workspace.snapshot().tasks[0];

    await core.receive(CHANNEL.sendMessage, [taskId, "Inspect the project"]);
    expect(conversation()?.messages[0]?.text).toBe("Inspect the project");
    await until(() => requests.length === 1);

    await core.receive(CHANNEL.sendMessage, [
      taskId,
      "Use the 2024 file instead",
      undefined,
      undefined,
      "guidance",
    ]);
    expect(conversation()?.guidance).toMatchObject([
      { text: "Use the 2024 file instead", status: "pending" },
    ]);

    finishFirstAnswer();
    await until(() => conversation()?.phase.kind === "completed");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Use the 2024 file instead",
    );
  });

  it("is sent now when the window asks, by stopping the reasoning it was waiting behind", async () => {
    const requests: ModelRequest[] = [];
    const { core, workspace } = coreAnswering(async function* (request) {
      requests.push(request);
      if (requests.length > 1) {
        yield { kind: "textDelta", text: "The 2024 file it is." };
        yield { kind: "done" };
        return;
      }
      while (!request.signal?.aborted) {
        yield { kind: "reasoningDelta", text: "Weighing it. " };
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    const taskId = await workspace.createTask();
    const conversation = () => workspace.snapshot().tasks[0];
    await core.receive(CHANNEL.sendMessage, [taskId, "Inspect the project"]);
    await until(
      () => conversation()?.messages.at(-1)?.reasoning?.status === "streaming",
    );
    expect(await core.receive(CHANNEL.sendNow, [taskId])).toBe(false);
    await core.receive(CHANNEL.sendMessage, [
      taskId,
      "Use the 2024 file instead",
      undefined,
      undefined,
      "guidance",
    ]);

    expect(await core.receive(CHANNEL.sendNow, [taskId])).toBe(true);
    await until(() => conversation()?.phase.kind === "completed");

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Use the 2024 file instead",
    );
    expect(conversation()?.messages.map((message) => message.text)).toEqual([
      "Inspect the project",
      "Use the 2024 file instead",
      "The 2024 file it is.",
    ]);
    await expect(core.receive(CHANNEL.sendNow, [])).rejects.toThrow();
  });

  it("is given back to the window as a draft when it is taken back before the model read it", async () => {
    const requests: ModelRequest[] = [];
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { core, workspace } = coreAnswering(async function* (request) {
      requests.push(request);
      yield { kind: "textDelta", text: "Looking." };
      await held;
      yield { kind: "done" };
    });
    const taskId = await workspace.createTask();
    const conversation = () => workspace.snapshot().tasks[0];
    await core.receive(CHANNEL.sendMessage, [taskId, "Inspect the project"]);
    await until(() => requests.length === 1);
    await core.receive(CHANNEL.sendMessage, [
      taskId,
      "Use the 2024 file instead",
      undefined,
      undefined,
      "guidance",
    ]);
    const waiting = conversation()?.guidance[0];

    await core.receive(CHANNEL.takeBackMessage, [taskId, waiting?.id]);

    expect(conversation()?.guidance).toMatchObject([
      { text: "Use the 2024 file instead", status: "draft" },
    ]);
    finish();
    await until(() => conversation()?.phase.kind === "completed");
    expect(requests).toHaveLength(1);
    await expect(
      core.receive(CHANNEL.takeBackMessage, [taskId]),
    ).rejects.toThrow();
  });

  it("is refused to the window when it cannot be put in the conversation", async () => {
    const { core } = coreAnswering(async function* () {
      yield { kind: "done" };
    });

    await expect(
      core.receive(CHANNEL.sendMessage, ["no-such-conversation", "Hello"]),
    ).rejects.toThrow();
  });
});
