import { afterEach, describe, expect, it } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { WorkspaceTools } from "@zhiyin/tools";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { loopFrom, stubDependencies, until } from "./support.js";
import {
  matchingPermission,
  offeredPermission,
} from "../src/tools/conversation-permissions.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("conversation permissions", () => {
  it("checks every edit target, connector version, and excluded deletion", async () => {
    const root = await folders.make("zhiyin-scope-");
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
    expect(connectorScope?.label).toBe("Mail · Send");
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
  it("names a connector rule after its connection, never the page the call acts on", async () => {
    const scope = await offeredPermission(
      "mcp",
      "mcp__browser__browser_resize",
      {
        ok: true as const,
        action: "Resize browser",
        target:
          "http://127.0.0.1:58390/59d140463bb6688c6454924d9e99a5eaa8404fb6636f9259/page-maternelle.html",
        connection: "Zhiyin’s browser",
        command: "browser_resize(...)",
        invocation: { name: "Resize browser", arguments: [] },
        identity: "server-and-schema-v1",
      },
    );

    expect(scope?.label).toBe("Zhiyin’s browser · Resize browser");
  });

  it("says a connector rule covers only the same call when its identity holds the call's inputs", async () => {
    const scope = await offeredPermission(
      "mcp",
      "mcp__blender__blender_describe_scene",
      {
        ok: true as const,
        action: "Describe a 3D scene",
        target: "scene.blend",
        connection: "3D studio",
        command: "blender_describe_scene({})",
        invocation: { name: "Describe a 3D scene", arguments: [] },
        identity: "call-v1",
        boundToCall: true,
      },
    );

    expect(scope?.label).toBe(
      "3D studio · Describe a 3D scene · only this exact call",
    );
  });

  it("allows every call of a connection that shares the allowance its first call offered, and no other", async () => {
    const call = (key: string | undefined, action: string) => ({
      ok: true as const,
      action,
      target: "mug.blend",
      connection: "3D studio",
      command: `${action}(...)`,
      identity: `${action}-call`,
      boundToCall: true as const,
      ...(key ? { allowance: { key, label: "Changes to mug.blend" } } : {}),
    });
    const offered = await offeredPermission(
      "mcp",
      "mcp__blender__blender_add_objects",
      call("mug.blend", "Add objects"),
    );
    const rule = {
      ...offered!,
      id: "scene",
      at: "2026-10-10T00:00:00.000Z",
    };
    const matches = (name: string, key: string | undefined) =>
      matchingPermission([rule], "mcp", name, call(key, "Another"));

    expect(offered?.label).toBe("3D studio · Changes to mug.blend");
    // Another tool of the same connection, on the same scene.
    expect(
      await matches("mcp__blender__blender_set_material", "mug.blend"),
    ).toMatchObject({ id: "scene" });
    // Another scene, a call that offers no allowance, another connection, and
    // a script, which is asked for every time.
    expect(
      await matches("mcp__blender__blender_set_material", "tea.blend"),
    ).toBeUndefined();
    expect(
      await matches("mcp__blender__blender_render", undefined),
    ).toBeUndefined();
    expect(
      await matches("mcp__python__python_read", "mug.blend"),
    ).toBeUndefined();
    expect(
      await matches("mcp__blender__blender_run_script", "mug.blend"),
    ).toBeUndefined();
  });

  it("tells apart two connections whose ids begin alike", async () => {
    const call = {
      ok: true as const,
      action: "Add objects",
      target: "mug.blend",
      connection: "Studio",
      command: "add(...)",
      identity: "add-call",
      allowance: { key: "mug.blend", label: "Changes to mug.blend" },
    };
    const offered = await offeredPermission(
      "mcp",
      "mcp__studio__blender__add",
      call,
    );
    const rule = { ...offered!, id: "scene", at: "2026-10-10T00:00:00.000Z" };

    expect(
      await matchingPermission(
        [rule],
        "mcp",
        "mcp__studio__blender__move",
        call,
      ),
    ).toMatchObject({ id: "scene" });
    expect(
      await matchingPermission(
        [rule],
        "mcp",
        "mcp__studio__python__move",
        call,
      ),
    ).toBeUndefined();
  });

  it("asks for every Python run, under the name the model calls it by", async () => {
    const run = {
      ok: true as const,
      action: "Run Python",
      target: "a script",
      connection: "Python environment",
      command: "python -c ...",
      identity: "server-and-schema-v1",
    };

    expect(
      await offeredPermission("mcp", "mcp__python__run_python", run),
    ).toBeUndefined();
    expect(
      await matchingPermission(
        [
          {
            kind: "connector-tool",
            label: "Python environment · Run Python",
            toolName: "mcp__python__run_python",
            identity: "server-and-schema-v1",
            id: "rule-1",
            at: "2026-10-07T00:00:00.000Z",
          },
        ],
        "mcp",
        "mcp__python__run_python",
        run,
      ),
    ).toBeUndefined();
  });

  it("asks for every Blender script, which can reach past the scene", async () => {
    const script = {
      ok: true as const,
      action: "Run a Blender script in a 3D scene",
      target: "scene.blend",
      connection: "3D studio",
      command: "blender_run_script(...)",
      identity: "script-v1",
    };

    expect(
      await offeredPermission(
        "mcp",
        "mcp__blender__blender_run_script",
        script,
      ),
    ).toBeUndefined();
  });

  it("covers later edits in one folder, then asks after revocation and in another conversation", async () => {
    const root = await folders.make("zhiyin-conversation-permission-");
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
              argumentsDelta: JSON.stringify({
                path,
                content: `Report ${index}`,
              }),
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
