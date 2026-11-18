import type { ModelRequest } from "@zhiyin/model-client";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import { WorkspaceTools } from "@zhiyin/tools";
import {
  GuardedPermissionEngine,
  offeredFiles,
} from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/test-support";
import { loopFrom, stubDependencies, until } from "./support.js";
import { fileChoices } from "../src/turn/file-choices.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("allowing a change outside the workspace for the conversation", () => {
  it("names a script's folder as the person picks it: its whole path, ending in a separator", () => {
    const exports = join(homedir(), "Documents", "Projects", "Exports");
    const offer = offeredFiles("mcp", "mcp__python__run_python", {
      ok: true,
      action: "Run a Python script",
      target: "a script",
      command: "print(1)",
      builtInConnection: true,
      effects: {
        reads: "elsewhere",
        changes: "elsewhere",
        sends: "none",
        actsAsPerson: "none",
        runs: "sealed",
        lasting: false,
        brings: "none",
      },
      changesAnyFile: {
        writable: [],
        unheldBy: "change_locked",
        outside: [exports],
      },
    });

    expect(fileChoices(offer!)).toEqual([
      { choice: "folder", label: `${exports}${sep}` },
    ]);
  });

  it("does not carry a grant into another conversation while it holds in the first", async () => {
    const root = await folders.make("zhiyin-conversation-permission-");
    // A folder outside the conversation's, where a change asks (ADR 0012).
    const reports = join(
      await folders.make("zhiyin-conversation-elsewhere-"),
      "reports",
    );
    await mkdir(reports);
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    let sent = 0;
    const loop = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: workspace,
      workspace,
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          // Told the note was never read back, it ends as it was.
          if (
            String(request.messages.at(-1)?.content).includes('kind="verify"')
          ) {
            yield { kind: "textDelta" as const, text: "Done." };
            yield { kind: "done" as const };
            return;
          }
          const index = sent++;
          if (index % 2 === 0)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `write-${index}`,
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: join(reports, `note-${index}.md`),
                content: "Note",
              }),
            };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const first = await loop.createTask();
    const firstTurn = loop.start(first, "Write a note");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    const asked = loop.snapshot().tasks[0]?.phase;
    if (asked?.kind !== "approval") throw new Error("Missing first approval");
    await loop.resolveApproval(first, asked.prompt.id, "allow-folder");
    await firstTurn;

    const second = await loop.createTask();
    const secondTurn = loop.start(second, "Write another note");
    const phaseOf = (id: string) =>
      loop.snapshot().tasks.find((task) => task.id === id)?.phase;
    await until(() => phaseOf(second)?.kind === "approval");

    // Asked in the second, though the first still holds its grant.
    expect(second).not.toBe(first);
    expect(
      loop.snapshot().tasks.find((task) => task.id === first)
        ?.conversationPermissions,
    ).toHaveLength(1);
    const secondAsk = phaseOf(second);
    if (secondAsk?.kind !== "approval") throw new Error("Not asked");
    await loop.resolveApproval(second, secondAsk.prompt.id, "allow");
    await secondTurn;
  });
});
