import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceTools } from "@zhiyin/tools";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { loopFrom, stubDependencies, until } from "./support.js";
import {
  matchingPermission,
  offeredPermission,
} from "../src/conversation-permissions.js";

describe("conversation permissions", () => {
  it("checks every edit target, connector version, and excluded deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-scope-"));
    await mkdir(join(root, "reports"));
    await mkdir(join(root, "finance"));
    const edit = (paths: string[]) => ({
      ok: true as const,
      action: "Edit files",
      target: paths.join(", "),
      command: "multi_edit(...) ",
      access: "change" as const,
      scope: "workspace" as const,
      changes: paths.map((path) => ({ path, change: "updated" as const })),
    });
    const scope = await offeredPermission(
      "built-in",
      "multi_edit",
      edit(["reports/one.md"]),
      root,
    );
    expect(scope?.label).toBe("Changes to files in reports/");
    const permission = {
      ...scope!,
      id: "rule-1",
      at: "2026-09-28T00:00:00.000Z",
    };
    expect(
      await matchingPermission(
        [permission],
        "built-in",
        "multi_edit",
        edit(["reports/one.md", "finance/two.md"]),
        root,
      ),
    ).toBeUndefined();
    expect(
      await matchingPermission(
        [permission],
        "built-in",
        "write_file",
        edit(["reports/two.md"]),
        root,
      ),
    ).toEqual(permission);
    expect(
      await matchingPermission(
        [permission],
        "built-in",
        "delete_file",
        edit(["reports/two.md"]),
        root,
      ),
    ).toBeUndefined();

    const connector = {
      ok: true as const,
      action: "Send",
      target: "Mail",
      command: "send(...)",
      identity: "server-and-schema-v1",
    };
    const connectorScope = await offeredPermission(
      "mcp",
      "mcp__mail__send",
      connector,
      root,
    );
    expect(
      await matchingPermission(
        [
          {
            ...connectorScope!,
            id: "connector",
            at: "2026-09-28T00:00:00.000Z",
          },
        ],
        "mcp",
        "mcp__mail__send",
        { ...connector, identity: "server-and-schema-v2" },
        root,
      ),
    ).toBeUndefined();
  });
  it("covers later edits in one folder, then asks after revocation and in another conversation", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "zhiyin-conversation-permission-"),
    );
    await mkdir(join(root, "reports"));
    await mkdir(join(root, "finance"));
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    const paths = [
      "reports/first.md",
      "reports/second.md",
      "finance/third.md",
      undefined,
      "reports/fourth.md",
      undefined,
      "reports/fifth.md",
    ];
    let sent = 0;
    const loop = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: workspace,
      workspace,
      model: {
        ...deps.model,
        send: async function* () {
          const index = sent++;
          const path = paths[index];
          if (path) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `write-${index}`,
              name: "write_file",
              argumentsDelta: JSON.stringify({ path, text: `Report ${index}` }),
            };
          } else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    const firstTurn = loop.start(taskId, "Write the reports and finance note");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    const first = loop.snapshot().tasks[0]?.phase;
    if (first?.kind !== "approval") throw new Error("Missing first approval");
    expect(first.prompt.conversationRule?.label).toBe(
      "Changes to files in reports/",
    );
    await loop.resolveApproval(taskId, first.prompt.id, "allow-conversation");
    await until(() => {
      const phase = loop.snapshot().tasks[0]?.phase;
      return (
        phase?.kind === "approval" && phase.prompt.target === "finance/third.md"
      );
    });
    const second = loop.snapshot().tasks[0]?.phase;
    if (second?.kind !== "approval")
      throw new Error("Missing finance approval");
    expect(
      loop.snapshot().tasks[0]?.actions?.map((action) => action.status),
    ).toEqual(["completed", "completed"]);
    expect(loop.snapshot().tasks[0]?.actions?.[1]?.approval?.by).toBe(
      "conversation-permission",
    );
    await loop.resolveApproval(taskId, second.prompt.id, "allow");
    await firstTurn;

    const permissionId =
      loop.snapshot().tasks[0]?.conversationPermissions?.[0]?.id;
    expect(permissionId).toBeTruthy();
    await loop.revokeConversationPermission(taskId, permissionId!);
    const nextTurn = loop.start(taskId, "Write one more report");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    const third = loop.snapshot().tasks[0]?.phase;
    if (third?.kind !== "approval")
      throw new Error("Missing approval after revocation");
    await loop.resolveApproval(taskId, third.prompt.id, "allow");
    await nextTurn;

    const newTaskId = await loop.createTask();
    const newTurn = loop.start(
      newTaskId,
      "Write a report in a new conversation",
    );
    await until(
      () =>
        loop.snapshot().tasks.find((task) => task.id === newTaskId)?.phase
          .kind === "approval",
    );
    const newPhase = loop
      .snapshot()
      .tasks.find((task) => task.id === newTaskId)?.phase;
    if (newPhase?.kind !== "approval")
      throw new Error("Missing new conversation approval");
    await loop.resolveApproval(newTaskId, newPhase.prompt.id, "allow");
    await newTurn;
  });
});
