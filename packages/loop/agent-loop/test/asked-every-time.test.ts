import { afterEach, describe, expect, it } from "vitest";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkspaceTools } from "@zhiyin/tools";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { ToolCallInspection } from "@zhiyin/contract";
import {
  loopFrom,
  stubDependencies,
  until,
  type LoopTestDependencies,
} from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/**
 * A call the code that owns its tool marks to be asked about every time is
 * asked about, whatever it declares it does, and no grant for the
 * conversation is offered for it (ADR 0012). These run the real engine and
 * the real grant rules on what the loop carries across from the inspection.
 */
async function oneCall(
  root: string,
  name: string,
  args: Record<string, unknown>,
  parts: Partial<LoopTestDependencies> = {},
) {
  const deps = stubDependencies(() => {});
  let requests = 0;
  const workspace = new WorkspaceTools(root, { shell: undefined });
  const loop = loopFrom({
    ...deps,
    permissions: new GuardedPermissionEngine(),
    tools: workspace,
    workspace,
    ...parts,
    model: {
      ...deps.model,
      send: async function* () {
        requests += 1;
        if (requests === 1)
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: "the-call",
            name,
            argumentsDelta: JSON.stringify(args),
          };
        else yield { kind: "textDelta", text: "Done." };
        yield { kind: "done" };
      },
    },
  });
  const taskId = await loop.createTask();
  return { loop, taskId };
}

async function askedAbout(
  loop: Awaited<ReturnType<typeof oneCall>>["loop"],
  taskId: string,
) {
  const phaseOf = () =>
    loop.snapshot().tasks.find((task) => task.id === taskId)?.phase;
  await until(() => phaseOf()?.kind === "approval");
  const phase = phaseOf();
  if (phase?.kind !== "approval") throw new Error("Not asked");
  return phase.prompt;
}

describe("a call its tool's code marks to be asked every time", () => {
  it("is asked about from a connection Zhiyin ships though what it declares would run unasked, with no grant offered", async () => {
    const root = await folders.make("zhiyin-asked-");
    const executed: string[] = [];
    const deps = stubDependencies(() => {});
    const removing: ToolCallInspection = {
      ok: true,
      action: "Remove a Python environment",
      target: "charts",
      command: "delete charts",
      connection: "Python environment",
      connectionId: "python",
      identity: "server-and-schema-v1",
      builtInConnection: true,
      effects: {
        reads: "app",
        changes: "app",
        sends: "none",
        actsAsPerson: "none",
        runs: "none",
        lasting: false,
        brings: "none",
      },
      asksEachTime: true,
    };
    const { loop, taskId } = await oneCall(
      root,
      "mcp__python__remove_python_environment",
      { name: "charts" },
      {
        mcp: {
          ...deps.mcp,
          availableTools: async () => [
            {
              name: "mcp__python__remove_python_environment",
              description: "Remove a Python environment.",
              inputSchema: { type: "object" },
            },
          ],
          inspect: async () => removing,
          execute: async () => {
            executed.push("removed");
            return { ok: true, value: "Removed." };
          },
        },
      },
    );

    const running = loop.start(taskId, "Remove the charts environment");
    const prompt = await askedAbout(loop, taskId);

    expect(executed).toEqual([]);
    expect(prompt.conversationRule).toBeUndefined();
    expect(prompt.fileRules).toBeUndefined();
    await loop.resolveApproval(taskId, prompt.id, "allow");
    await running;
    expect(executed).toEqual(["removed"]);
  });

  it("asks about a real move out of the workspace, offering no grant for its file or folder", async () => {
    const root = await folders.make("zhiyin-asked-root-");
    const outside = await realpath(await folders.make("zhiyin-asked-out-"));
    await writeFile(join(root, "notes.md"), "Notes.\n", "utf8");
    const { loop, taskId } = await oneCall(root, "move_file", {
      from: "notes.md",
      to: join(outside, "notes.md"),
    });

    const running = loop.start(taskId, "Move the notes out");
    const prompt = await askedAbout(loop, taskId);

    expect(prompt.conversationRule).toBeUndefined();
    expect(prompt.fileRules).toBeUndefined();
    await loop.resolveApproval(taskId, prompt.id, "deny");
    await running;
  });
});
