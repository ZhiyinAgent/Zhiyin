/**
 * The person's standing instructions, as the app keeps them: their own, set
 * in Settings, and their answer about each folder's AGENTS.md. ADR 0054.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, type FolderInstructions } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const agents: FolderInstructions = {
  path: "AGENTS.md",
  text: "Invoices live in /finance.",
  bytes: 26,
  truncated: false,
  hash: "c".repeat(64),
};

async function appAt(root: string, requests: ModelRequest[] = []) {
  let created = 0;
  const deps = stubDependencies(() => {});
  const app = loopFrom({
    ...deps,
    newTaskId: () => `task-${++created}`,
    newUserInputId: () => "folder-question",
    sessions: new FileSessions(root),
    revealDelayMs: 0,
    workspace: {
      ...deps.workspace,
      workspaceRoot: () => "/work/reports",
      folderInstructions: async () => agents,
    },
    model: {
      ...deps.model,
      send: async function* (request: ModelRequest) {
        requests.push(request);
        yield { kind: "textDelta" as const, text: "Done." };
        yield { kind: "done" as const };
      },
    },
  });
  await app.initialize();
  return app;
}

const sentInstructions = (requests: readonly ModelRequest[]) =>
  requests
    .flatMap((request) => request.messages)
    .filter(
      (message) =>
        message.role === "user" &&
        String(message.content).startsWith(
          '<zhiyin-notice kind="instructions">',
        ),
    )
    .map((message) => String(message.content));

async function answerFolderQuestion(
  app: Awaited<ReturnType<typeof appAt>>,
  taskId: string,
  answer: "use" | "ignore",
) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (app.snapshot().tasks[0]?.phase.kind === "input") break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await app.resolveUserInput(taskId, "folder-question", {
    answers: [{ questionId: "folder-instructions", answerIds: [answer] }],
  });
}

describe("standing instructions kept by the app", () => {
  it("keeps the person's own instructions across a restart, and sends them", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-instructions-"));
    roots.push(root);
    const app = await appAt(root);
    await app.choices.setPersonalInstructions("Always answer in French.");
    await app.shutdown();

    const requests: ModelRequest[] = [];
    const reopened = await appAt(root, requests);
    expect(reopened.snapshot().personalInstructions).toBe(
      "Always answer in French.",
    );
    const taskId = await reopened.createTask();
    const running = reopened.start(taskId, "Summarise the reports");
    await answerFolderQuestion(reopened, taskId, "ignore");
    await running;

    expect(sentInstructions(requests)[0]).toContain("Always answer in French.");
  });

  it("remembers the answer about a folder's instructions across a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-instructions-"));
    roots.push(root);
    const app = await appAt(root);
    const first = await app.createTask();
    const running = app.start(first, "Summarise the reports");
    await answerFolderQuestion(app, first, "use");
    await running;
    await app.shutdown();

    const requests: ModelRequest[] = [];
    const reopened = await appAt(root, requests);
    const second = await reopened.createTask();
    await reopened.start(second, "And the next one");

    expect(
      reopened.snapshot().tasks.find((task) => task.id === second)?.phase.kind,
    ).toBe("completed");
    expect(sentInstructions(requests)[0]).toContain(
      "Invoices live in /finance.",
    );
  });

  it("refuses personal instructions from the window that are not text", async () => {
    const app = loopFrom(stubDependencies(() => {}));
    await app.initialize();
    const core = new Core({
      workspace: app,
      ownership: { claim: async () => {}, release: async () => {} },
      viewChecks: { answer: () => {}, abandon: () => {} },
      chooseFolder: async () => undefined,
      chooseSaveLocation: async () => undefined,
      openExternal: async () => {},
      openPath: async () => {},
      version: "1.0.0",
    });

    await expect(
      core.receive(CHANNEL.setPersonalInstructions, [42]),
    ).rejects.toThrow();
    await expect(
      core.receive(CHANNEL.setPersonalInstructions, ["x".repeat(70_000)]),
    ).rejects.toThrow();
  });
});
