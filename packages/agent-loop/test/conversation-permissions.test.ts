import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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
  it("does not carry a connector call allowed in one folder to the same call in another", async () => {
    // As a built-in's identity reads: the connection and schema, and the
    // folder the built-in says the call acts on.
    const identityIn = (folder: string) =>
      JSON.stringify({
        server: { id: "git", url: "zhiyin://git" },
        schema: { type: "object" },
        action: JSON.stringify({ workspace: folder }),
      });
    const call = {
      ok: true as const,
      action: "Show the changes",
      target: "Git",
      connection: "Git",
      command: "git status",
      identity: identityIn("C:\\work\\first"),
    };
    const allowed = await offeredPermission(
      "mcp",
      "mcp__git__git_status",
      call,
    );
    const rules = [{ ...allowed!, id: "git", at: "2026-10-20T00:00:00.000Z" }];

    expect(
      await matchingPermission(rules, "mcp", "mcp__git__git_status", call),
    ).toBeDefined();
    expect(
      await matchingPermission(rules, "mcp", "mcp__git__git_status", {
        ...call,
        identity: identityIn("C:\\work\\second"),
      }),
    ).toBeUndefined();
  });

  it("covers only a change named by where it is, never one that steps up a folder, is a full path or holds a colon", async () => {
    const root = await folders.make("zhiyin-scope-");
    await mkdir(join(root, "reports"));
    const edit = (path: string) => ({
      ok: true as const,
      action: "Write a file",
      target: path,
      command: "write_file(...)",
      access: "change" as const,
      scope: "workspace" as const,
      changes: [{ path, change: "created" as const }],
    });
    const scope = await offeredPermission(
      "built-in",
      "write_file",
      edit("reports/one.md"),
      root,
    );
    const permission = { ...scope!, id: "rule-1", at: "2026-10-18T00:00:00Z" };

    for (const path of [
      "reports/../reports/two.md",
      "reports/sub/../../reports/two.md",
      join(root, "reports", "two.md"),
      // A drive's own folder and a hidden stream are not files of the folder.
      "C:reports/two.md",
      "reports/two.md:hidden",
    ]) {
      expect(
        await offeredPermission("built-in", "write_file", edit(path), root),
      ).toBeUndefined();
      expect(
        await matchingPermission(
          [permission],
          "built-in",
          "write_file",
          edit(path),
          root,
        ),
      ).toBeUndefined();
    }
  });

  /**
   * The tool resolves a path once and names the file it really writes; the
   * grant is checked against that name. `notes/lnk/new.md` is written in
   * `docs/deep`, outside a grant for `notes/`, while `notes/lnk/../b.md` is
   * `notes/b.md`, inside it, as Windows reads it.
   */
  it("checks a grant against the file a write really reaches", async () => {
    const root = await folders.make("zhiyin-conversation-permission-");
    await mkdir(join(root, "notes"));
    await mkdir(join(root, "docs", "deep"), { recursive: true });
    await writeFile(join(root, "docs", "b.md"), "The person's own text.");
    await symlink(
      join(root, "docs", "deep"),
      join(root, "notes", "lnk"),
      "junction",
    );
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    const paths = ["notes/a.md", "notes/lnk/new.md", "notes/lnk/../b.md"];
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
          const path = index % 2 === 0 ? paths[index / 2] : undefined;
          if (path)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `write-${index}`,
              name: "write_file",
              argumentsDelta: JSON.stringify({ path, content: "Written." }),
            };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    const phase = () => loop.snapshot().tasks[0]?.phase;
    const asked = async () => {
      await until(() => phase()?.kind === "approval");
      const current = phase();
      if (current?.kind !== "approval") throw new Error("Not asked");
      return current.prompt;
    };

    const first = loop.start(taskId, "Write a note");
    await loop.resolveApproval(
      taskId,
      (await asked()).id,
      "allow-conversation",
    );
    await first;

    const second = loop.start(taskId, "Write through the link");
    const outside = await asked();
    expect(outside.target).toBe("docs/deep/new.md");
    await loop.resolveApproval(taskId, outside.id, "allow");
    await second;

    await loop.start(taskId, "Write next to the link");
    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions.at(-1)?.approval?.by).toBe("conversation-permission");
    expect(await readFile(join(root, "notes", "b.md"), "utf8")).toBe(
      "Written.",
    );
    expect(await readFile(join(root, "docs", "b.md"), "utf8")).toBe(
      "The person's own text.",
    );
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
    const matches = (
      name: string,
      key: string | undefined,
      said: { readonly asksEachTime?: true } = {},
    ) =>
      matchingPermission([rule], "mcp", name, {
        ...call(key, "Another"),
        ...said,
      });

    expect(offered?.label).toBe("3D studio · Changes to mug.blend");
    // Another tool of the same connection, on the same scene.
    expect(
      await matches("mcp__blender__blender_set_material", "mug.blend"),
    ).toMatchObject({ id: "scene" });
    // Another scene, a call that offers no allowance, another connection, and
    // a script, which its connection says is asked for every time.
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
      await matches("mcp__blender__blender_run_script", "mug.blend", {
        asksEachTime: true,
      }),
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

  it("allows the Python scripts its environment vouches for, those without the internet, for the conversation, and no others", async () => {
    const offline = (code: string) => ({
      ok: true as const,
      action: "Run a Python script",
      target: "a script",
      connection: "Python environment",
      command: code,
      identity: `server-and-schema-v1-${code}`,
      allowance: {
        key: "offline-in-this-workspace",
        label:
          "Python scripts that reach only the workspace, without the internet",
      },
    });
    const online = {
      ok: true as const,
      action: "Run a Python script",
      target: "a script",
      connection: "Python environment",
      command: "print(2)",
      identity: "server-and-schema-v1-online",
      asksEachTime: true as const,
    };

    const offered = await offeredPermission(
      "mcp",
      "mcp__python__run_python",
      offline("print(1)"),
    );
    const rule = { ...offered!, id: "offline", at: "2026-10-17T00:00:00.000Z" };

    expect(offered).toMatchObject({
      label:
        "Python environment · Python scripts that reach only the workspace, without the internet",
      toolName: "mcp__python__*",
      identity: "offline-in-this-workspace",
    });
    expect(
      await matchingPermission(
        [rule],
        "mcp",
        "mcp__python__run_python",
        offline("print(3)"),
      ),
    ).toMatchObject({ id: "offline" });
    expect(
      await offeredPermission("mcp", "mcp__python__run_python", online),
    ).toBeUndefined();
    expect(
      await matchingPermission(
        [rule],
        "mcp",
        "mcp__python__run_python",
        online,
      ),
    ).toBeUndefined();
  });

  it.each([
    "mcp__python__install_python_package",
    "mcp__python__create_python_environment",
    "mcp__python__remove_python_environment",
    "mcp__python__reset_python_environment",
  ])(
    "asks every time for %s, which its connection says changes a Python environment",
    async (name) => {
      const change = {
        ok: true as const,
        action: "Change a Python environment",
        target: "charts",
        connection: "Python environment",
        command: "python -m pip install plotly",
        identity: "server-and-schema-v1",
        asksEachTime: true as const,
      };

      expect(await offeredPermission("mcp", name, change)).toBeUndefined();
      expect(
        await matchingPermission(
          [
            {
              kind: "connector-tool",
              label: "Python environment · Change",
              toolName: name,
              identity: "server-and-schema-v1",
              id: "rule-1",
              at: "2026-10-17T00:00:00.000Z",
            },
          ],
          "mcp",
          name,
          change,
        ),
      ).toBeUndefined();
    },
  );

  it("offers listing the Python environments for the conversation", async () => {
    expect(
      await offeredPermission("mcp", "mcp__python__list_python_environments", {
        ok: true,
        action: "List the Python environments",
        target: "Zhiyin's Python environments",
        connection: "Python environment",
        command: "list_python_environments",
        identity: "server-and-schema-v1",
      }),
    ).toMatchObject({ toolName: "mcp__python__list_python_environments" });
  });

  it("asks for a Python run its environment does not vouch for", async () => {
    const run = {
      ok: true as const,
      action: "Run Python",
      target: "a script",
      connection: "Python environment",
      command: "python -c ...",
      identity: "server-and-schema-v1",
      asksEachTime: true as const,
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

  it("offers and applies no grant for a call its owner says is asked every time, whatever it is called", async () => {
    const root = await folders.make("zhiyin-scope-");
    await mkdir(join(root, "reports"));
    const grantable = {
      ok: true as const,
      action: "Commit staged changes",
      target: "repository",
      connection: "Git",
      command: "git commit -m ...",
      identity: "server-and-schema-v1",
    };
    const commit = { ...grantable, asksEachTime: true as const };
    const write = {
      ok: true as const,
      action: "Create a workspace file",
      target: "reports/one.md",
      command: "write_file(...)",
      access: "change" as const,
      scope: "workspace" as const,
      changes: [{ path: "reports/one.md", change: "created" as const }],
      asksEachTime: true as const,
    };
    const saved = [
      {
        kind: "connector-tool" as const,
        label: "Git · Commit",
        toolName: "mcp__anything__commit",
        identity: "server-and-schema-v1",
        id: "connector",
        at: "2026-10-18T00:00:00.000Z",
      },
      {
        kind: "file-folder" as const,
        label: "Changes to files in reports/",
        toolName: "write_file",
        workspaceRoot: root,
        folder: join(root, "reports"),
        id: "folder",
        at: "2026-10-18T00:00:00.000Z",
      },
    ];

    expect(
      await offeredPermission("mcp", "mcp__anything__commit", commit),
    ).toBeUndefined();
    expect(
      await matchingPermission(saved, "mcp", "mcp__anything__commit", commit),
    ).toBeUndefined();
    expect(
      await offeredPermission("built-in", "write_file", write, root),
    ).toBeUndefined();
    expect(
      await matchingPermission(saved, "built-in", "write_file", write, root),
    ).toBeUndefined();
    // The same call without the mark is covered.
    expect(
      await matchingPermission(
        saved,
        "mcp",
        "mcp__anything__commit",
        grantable,
      ),
    ).toMatchObject({ id: "connector" });
  });

  it("asks for every Blender script, which its connection says can reach past the scene", async () => {
    const script = {
      ok: true as const,
      action: "Run a Blender script in a 3D scene",
      target: "scene.blend",
      connection: "3D studio",
      command: "blender_run_script(...)",
      identity: "script-v1",
      asksEachTime: true as const,
    };

    expect(
      await offeredPermission(
        "mcp",
        "mcp__blender__blender_run_script",
        script,
      ),
    ).toBeUndefined();
  });

  it("does not carry a grant into another conversation while it holds in the first", async () => {
    const root = await folders.make("zhiyin-conversation-permission-");
    await mkdir(join(root, "reports"));
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
        send: async function* () {
          const index = sent++;
          if (index % 2 === 0)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `write-${index}`,
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: `reports/note-${index}.md`,
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
    await loop.resolveApproval(first, asked.prompt.id, "allow-conversation");
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

  it("covers later edits in one folder, then asks after revocation", async () => {
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
  });

  it("keeps a grant for edits to the conversation's own folder, and does not carry it to the folder it moves to", async () => {
    const first = await folders.make("zhiyin-conversation-permission-");
    const next = await folders.make("zhiyin-conversation-permission-");
    await mkdir(join(first, "reports"));
    await mkdir(join(next, "reports"));
    // No folder of its own: each conversation works in the one it entered.
    const workspace = new WorkspaceTools(undefined, { shell: undefined });
    const deps = stubDependencies(() => {});
    const paths = [
      "reports/first.md",
      "reports/second.md",
      undefined,
      "reports/third.md",
      undefined,
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
          if (path)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `write-${index}`,
              name: "write_file",
              argumentsDelta: JSON.stringify({ path, content: "Report" }),
            };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    await workspace.enterFolder(taskId, first);
    const phase = () => loop.snapshot().tasks[0]?.phase;

    const turn = loop.start(taskId, "Write the reports");
    await until(() => phase()?.kind === "approval");
    const asked = phase();
    if (asked?.kind !== "approval") throw new Error("Not asked");
    expect(asked.prompt.conversationRule?.label).toBe(
      "Changes to files in reports/",
    );
    await loop.resolveApproval(taskId, asked.prompt.id, "allow-conversation");
    await turn;
    expect(
      loop.snapshot().tasks[0]?.actions?.map((action) => action.approval?.by),
    ).toEqual(["you", "conversation-permission"]);
    expect(await readFile(join(first, "reports", "second.md"), "utf8")).toBe(
      "Report",
    );

    await workspace.enterFolder(taskId, next);
    const moved = loop.start(taskId, "Write one more");
    await until(() => phase()?.kind === "approval");
    const askedAgain = phase();
    if (askedAgain?.kind !== "approval") throw new Error("Not asked again");
    expect(askedAgain.prompt.target).toBe("reports/third.md");
    await loop.resolveApproval(taskId, askedAgain.prompt.id, "deny");
    await moved;
  });
});
