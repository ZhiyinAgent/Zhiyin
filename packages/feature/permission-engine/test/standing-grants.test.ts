import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  matchingByEffects,
  matchingFiles,
  matchingPermission,
  offeredByEffects,
  offeredFiles,
  offeredPermission,
} from "../src/standing-grants.js";

/** What a file holds now, as the agent loop reads it for the rules. */
function contentDigest(path: string): Promise<string | undefined> {
  return readFile(path).then(
    (bytes) => createHash("sha256").update(bytes).digest("hex"),
    () => undefined,
  );
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const granted = <T extends object>(scope: T, id = "rule") => ({
  ...scope,
  id,
  at: "2026-10-29T00:00:00.000Z",
});

/** What a write outside the workspace does, as Zhiyin's file tools declare it. */
const writesElsewhere = {
  reads: "elsewhere",
  changes: "elsewhere",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
} as const;

describe("allowing a write outside the workspace", () => {
  const writing = (path: string) => ({
    ok: true as const,
    action: "Create a file outside the workspace",
    target: path,
    command: "write_file(...)",
    effects: writesElsewhere,
    changes: [{ path, change: "created" as const }],
    grantableByFile: true as const,
  });

  it("offers the file and its folder, and no folder that would cover nearly everything", async () => {
    const project = join(homedir(), "Documents", "Prints", "bracket.step");
    const inHome = join(homedir(), "notes.txt");
    const onDrive = join("C:/", "bracket.step");

    expect(
      await offeredFiles("built-in", "write_file", writing(project)),
    ).toEqual({
      file: expect.objectContaining({ kind: "outside-file", file: project }),
      folder: expect.objectContaining({
        kind: "outside-folder",
        folder: join(homedir(), "Documents", "Prints"),
      }),
    });
    expect(
      await offeredFiles("built-in", "write_file", writing(inHome)),
    ).not.toHaveProperty("folder");
    expect(
      await offeredFiles("built-in", "write_file", writing(onDrive)),
    ).not.toHaveProperty("folder");
  });

  it("never offers or covers a file that runs later without anyone starting it: in a .git folder, or in Windows' Startup folder", async () => {
    const project = join(homedir(), "Documents", "Project");
    const startup = join(
      homedir(),
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
    );
    const held = [
      granted({
        kind: "outside-folder" as const,
        label: "Changes to files in Project",
        toolName: "write_file",
        folder: project,
      }),
      granted({
        kind: "outside-folder" as const,
        label: "Changes to files in Start Menu",
        toolName: "write_file",
        folder: dirname(dirname(startup)),
      }),
    ];

    for (const path of [
      join(project, ".git", "hooks", "pre-commit"),
      join(project, "lib", ".GIT", "config"),
      join(startup, "run.cmd"),
    ]) {
      expect(
        await offeredFiles("built-in", "write_file", writing(path)),
      ).toBeUndefined();
      expect(
        await matchingFiles(held, "built-in", writing(path), contentDigest),
      ).toBeUndefined();
    }
    expect(
      await matchingFiles(
        held,
        "built-in",
        writing(join(project, "notes.md")),
        contentDigest,
      ),
    ).toMatchObject({ folder: project });
  });

  it("offers nothing for a call marked to ask every time, or one not of Zhiyin's own file tools", async () => {
    const path = join(homedir(), "Documents", "a.md");

    expect(
      await offeredFiles("built-in", "write_file", {
        ...writing(path),
        asksEachTime: true,
      }),
    ).toBeUndefined();
    expect(
      await offeredFiles("mcp", "write_file", writing(path)),
    ).toBeUndefined();
  });

  it("offers and covers nothing for a built-in tool's change that does not say a file grant covers it, whatever the tool is called", async () => {
    const path = join(homedir(), "Documents", "a.md");
    const undeclared = { ...writing(path) };
    delete (undeclared as { grantableByFile?: true }).grantableByFile;
    const held = [
      granted({
        kind: "outside-folder" as const,
        label: "Documents",
        toolName: "write_file",
        folder: dirname(path),
      }),
    ];

    expect(offeredFiles("built-in", "write_file", undeclared)).toBeUndefined();
    expect(offeredFiles("built-in", "delete_file", undeclared)).toBeUndefined();
    expect(
      await matchingFiles(held, "built-in", undeclared, contentDigest),
    ).toBeUndefined();
  });

  it("offers the file and its folder for a connection Zhiyin ships, by the path it declared", async () => {
    const path = join(homedir(), "Documents", "Prints", "bracket.glb");

    expect(
      await offeredFiles("mcp", "blender__blender_export", {
        ...writing(path),
        builtInConnection: true as const,
      }),
    ).toEqual({
      file: expect.objectContaining({ file: path }),
      folder: expect.objectContaining({ folder: dirname(path) }),
    });
  });

  it("offers a shipped connection's outside file when the same call also changes a workspace file, and only then", async () => {
    const path = join(homedir(), "Documents", "Renders", "bracket.png");
    const rendering = {
      ...writing(path),
      builtInConnection: true as const,
      changes: [
        { path, change: "created" as const },
        { path: "scene.blend", change: "updated" as const },
      ],
    };

    expect(
      await offeredFiles("mcp", "blender__blender_render", rendering),
    ).toMatchObject({ file: { file: path } });
    expect(
      await offeredFiles("mcp", "blender__blender_render", {
        ...rendering,
        changes: [
          { path, change: "created" as const },
          { path: "../elsewhere.blend", change: "updated" as const },
        ],
      }),
    ).toBeUndefined();
    expect(
      await offeredFiles("built-in", "write_file", {
        ...writing(path),
        changes: rendering.changes,
      }),
    ).toBeUndefined();
  });

  it("never lets a connection's allowance or exact-call grant cover a write outside the workspace", async () => {
    const path = join(homedir(), "Documents", "Prints", "bracket.glb");
    const outside = {
      ...writing(path),
      builtInConnection: true as const,
      allowance: { key: "studio", label: "3D studio changes" },
      identity: "the-call",
    };
    const granted = [
      {
        id: "1",
        at: "2026-10-28T00:00:00.000Z",
        kind: "connector-tool" as const,
        label: "3D studio changes",
        toolName: "blender__*",
        identity: "studio",
      },
      {
        id: "2",
        at: "2026-10-28T00:00:00.000Z",
        kind: "connector-tool" as const,
        label: "This exact call",
        toolName: "blender__blender_export",
        identity: "the-call",
      },
    ];

    expect(
      await offeredPermission("mcp", "blender__blender_export", outside),
    ).toBeUndefined();
    expect(
      await matchingPermission(
        granted,
        "mcp",
        "blender__blender_export",
        outside,
      ),
    ).toBeUndefined();
  });
});

describe("conversation permissions", () => {
  it("covers a connector's call only while its tool stays the same", async () => {
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
      connectionId: "blender",
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
      said: {
        readonly asksEachTime?: true;
        readonly connectionId?: string;
      } = {},
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
      await matches("mcp__python__python_read", "mug.blend", {
        connectionId: "python",
      }),
    ).toBeUndefined();
    expect(
      await matches("mcp__blender__blender_run_script", "mug.blend", {
        asksEachTime: true,
      }),
    ).toBeUndefined();
  });

  it("binds a grant for a destination to the connection it was made through, whatever name its tools are offered under", () => {
    const sending = (connectionId: string, connection: string) => ({
      ok: true as const,
      action: "Post",
      target: connection,
      connection,
      connectionId,
      command: "post(...)",
      effects: {
        reads: "none",
        changes: "none",
        sends: "chosen",
        actsAsPerson: "once",
        runs: "none",
        lasting: false,
        brings: "none",
        destination: "https://example.invalid",
      } as const,
    });
    // Two connections whose ids are too long for a routed name: their tools
    // are offered under short digests that say nothing of the connection.
    const first = sending(`plugin-one/${"x".repeat(70)}`, "One");
    const second = sending(`plugin-two/${"x".repeat(70)}`, "Two");
    const offered = offeredByEffects(first);
    const held = [granted(offered!, "first")];

    // Another tool of the first connection, and the second connection's.
    expect(matchingByEffects(held, first)).toMatchObject({ id: "first" });
    expect(matchingByEffects(held, second)).toBeUndefined();
  });

  it("tells apart two connections whose ids begin alike", async () => {
    const call = (connectionId: string) => ({
      ok: true as const,
      action: "Add objects",
      target: "mug.blend",
      connection: "Studio",
      connectionId,
      command: "add(...)",
      identity: "add-call",
      allowance: { key: "mug.blend", label: "Changes to mug.blend" },
    });
    const offered = await offeredPermission(
      "mcp",
      "mcp__studio__blender__add",
      call("studio/blender"),
    );
    const rule = { ...offered!, id: "scene", at: "2026-10-10T00:00:00.000Z" };

    expect(
      await matchingPermission(
        [rule],
        "mcp",
        "mcp__studio__blender__move",
        call("studio/blender"),
      ),
    ).toMatchObject({ id: "scene" });
    for (const other of ["studio/python", "studio/blender/extra", "studio"])
      expect(
        await matchingPermission(
          [rule],
          "mcp",
          "mcp__studio__python__move",
          call(other),
        ),
        other,
      ).toBeUndefined();
  });

  it("allows the Python scripts its environment vouches for, those that reach no network, for the conversation, and no others", async () => {
    const offline = (code: string) => ({
      ok: true as const,
      action: "Run a Python script",
      target: "a script",
      connection: "Python environment",
      connectionId: "python",
      command: code,
      identity: `server-and-schema-v1-${code}`,
      allowance: {
        key: "offline-in-this-workspace",
        label: "Python scripts that reach only the workspace, and no network",
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
        "Python environment · Python scripts that reach only the workspace, and no network",
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
      action: "Create a file outside the workspace",
      target: join(root, "reports", "one.md"),
      command: "write_file(...)",
      effects: writesElsewhere,
      changes: [
        { path: join(root, "reports", "one.md"), change: "created" as const },
      ],
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
        kind: "outside-folder" as const,
        label: "Changes to files in reports",
        toolName: "write_file",
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
    expect(offeredFiles("built-in", "write_file", write)).toBeUndefined();
    expect(
      await matchingFiles(saved, "built-in", write, contentDigest),
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
});
