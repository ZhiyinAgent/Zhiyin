/**
 * The person's standing instructions, as the app keeps them: their own, kept
 * until memory takes them, and their answer about each folder's AGENTS.md.
 * ADR 0016.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { FolderInstructions } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/test-support";
import { loopFrom, stubDependencies, storedIn } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
    ...storedIn(new FileSessions(root)),
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
  it("remembers the answer about a folder's instructions across a restart", async () => {
    const root = await folders.make("zhiyin-instructions-");
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
});
