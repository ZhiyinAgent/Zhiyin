/**
 * A file Zhiyin could not copy is changed for good, so a call that changes
 * it asks; the person can allow changes to that file alone for the
 * conversation, as the conversation leaves it (ADR 0013). A script that
 * always saves such a file, as Blender saves its scene, asks before it runs
 * and may then change it. The copies are stand-ins here; the copying itself
 * is tested in recovery.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/test-support";
import { loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const tooLarge =
  "It is larger than the 256 MiB recovery limit, so no copy was taken before the run.";

/** A model that runs the script once for each message of the person's. */
async function* scriptPerMessage(request: ModelRequest) {
  if (request.messages.at(-1)?.role === "user")
    yield {
      kind: "toolCallDelta" as const,
      index: 0,
      callId: `call-${request.messages.length}`,
      name: "run_script",
      argumentsDelta: "{}",
    };
  else yield { kind: "textDelta" as const, text: "Done." };
  yield { kind: "done" as const };
}

/**
 * A conversation in a folder whose copy left out `stand.blend`, with one
 * sealed-off script that names `writable` and always saves the scene.
 */
async function conversation(writable: readonly string[] = []) {
  const root = await folders.make("zhiyin-uncopied-");
  const scene = join(root, "stand.blend");
  await writeFile(scene, "scene");
  const deps = stubDependencies(() => {});
  const ran: number[] = [];
  const loop = loopFrom({
    ...deps,
    permissions: new GuardedPermissionEngine(),
    workspace: { ...deps.workspace, workspaceRoot: () => root },
    recovery: {
      ...deps.recovery,
      copyFolder: async () => ({
        ok: true,
        uncopied: [{ path: "stand.blend", reason: tooLarge }],
      }),
    },
    tools: {
      list: () => [
        {
          name: "run_script",
          description: "Run a script on the open scene.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Run a Blender script",
        target: "stand.blend",
        command: "import bpy",
        effects: {
          reads: "workspace",
          changes: writable.length ? "workspace-for-good" : "workspace",
          sends: "none",
          actsAsPerson: "none",
          runs: "sealed",
          lasting: false,
          brings: "none",
        },
        changesAnyFile: { writable, saves: ["stand.blend"] },
      }),
      // Saving the scene, as Blender does after every script.
      execute: async () => {
        ran.push(ran.length);
        await writeFile(scene, `${await readFile(scene, "utf8")}+`);
        return { ok: true, value: { saved: true } };
      },
    },
    model: { ...deps.model, send: scriptPerMessage },
  });
  const taskId = await loop.createTask();
  const phase = () => loop.snapshot().tasks[0]?.phase;
  /** Sends a message, answering a question with `answer` when one is asked. */
  const turn = async (message: string, answer?: "allow" | "allow-file") => {
    const running = loop.start(taskId, message);
    if (answer) {
      await until(() => phase()?.kind === "approval");
      const asked = phase();
      if (asked?.kind !== "approval") throw new Error("Not asked");
      await loop.resolveApproval(taskId, asked.prompt.id, answer);
    }
    await running;
  };
  const asked = () => {
    const now = phase();
    return now?.kind === "approval" ? now.prompt : undefined;
  };
  return { loop, taskId, scene, ran, turn, asked, phase };
}

describe("a script that saves a scene Zhiyin could not copy", () => {
  it("asks before it runs, saying it cannot be undone, and offers that file for the conversation", async () => {
    const { loop, taskId, asked, phase } = await conversation();

    const running = loop.start(taskId, "Make the stand");
    await until(() => phase()?.kind === "approval");

    expect(asked()).toMatchObject({
      why: { code: "cannot-undo" },
      fileRules: [
        { choice: "file", label: "stand.blend", withoutBackup: true },
      ],
    });
    await loop.resolveApproval(taskId, asked()!.id, "allow");
    await running;
  });

  it("once allowed for the conversation, runs the next script without asking, changing the scene", async () => {
    const { loop, ran, turn, scene } = await conversation();

    await turn("Make the stand", "allow-file");
    await turn("Round its edges");

    expect(ran).toEqual([0, 1]);
    expect(await readFile(scene, "utf8")).toBe("scene++");
    expect(loop.snapshot().tasks[0]?.conversationPermissions).toMatchObject([
      {
        kind: "uncopied-file",
        label: "Changes to stand.blend without a backup",
        file: scene,
      },
    ]);
  });

  it("asks again once the scene was changed elsewhere since", async () => {
    const { turn, scene, ran } = await conversation();
    await turn("Make the stand", "allow-file");
    await writeFile(scene, "opened and saved in the person's own Blender");

    await turn("Round its edges", "allow");

    expect(ran).toEqual([0, 1]);
  });
});

describe("a script naming a file the copy of its folder left out", () => {
  it("asks, offering that file for the conversation", async () => {
    const { loop, taskId, asked, phase } = await conversation(["stand.blend"]);

    const running = loop.start(taskId, "Clean the data");
    await until(() => phase()?.kind === "approval");

    expect(asked()).toMatchObject({
      why: { code: "cannot-undo" },
      fileRules: [
        { choice: "file", label: "stand.blend", withoutBackup: true },
      ],
    });
    await loop.resolveApproval(taskId, asked()!.id, "allow");
    await running;
  });
});

describe("a script naming a file the copy of its folder did not leave out", () => {
  it("asks every time, offering nothing for the conversation", async () => {
    const { loop, taskId, asked, phase } = await conversation([
      "renders/huge.exr",
    ]);

    const running = loop.start(taskId, "Render it");
    await until(() => phase()?.kind === "approval");

    expect(asked()).toMatchObject({ why: { code: "cannot-undo" } });
    expect(asked()).not.toHaveProperty("fileRules");
    expect(asked()).not.toHaveProperty("conversationRule");
    await loop.resolveApproval(taskId, asked()!.id, "allow");
    await running;
  });
});

describe("a change to a file it names that is too large to copy", () => {
  it("asks, saying it cannot be undone, and offers that file for the conversation", async () => {
    const root = await folders.make("zhiyin-uncopied-");
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      workspace: { ...deps.workspace, workspaceRoot: () => root },
      recovery: {
        ...deps.recovery,
        prepare: async (actionId) => ({
          actionId,
          files: [
            {
              path: "part.step",
              status: "unprotected",
              reason: "The existing file exceeds the 256 MiB recovery limit.",
              tooLarge: true,
            },
          ],
        }),
      },
      tools: {
        list: () => [
          {
            name: "run_script",
            description: "Build a part.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: true,
          action: "Build a CAD part",
          target: "part.step",
          command: "build()",
          changes: [{ path: "part.step", change: "updated" }],
          effects: {
            reads: "workspace",
            changes: "workspace",
            sends: "none",
            actsAsPerson: "none",
            runs: "sealed",
            lasting: false,
            brings: "none",
          },
        }),
        execute: async () => ({ ok: true, value: { built: true } }),
      },
      model: { ...deps.model, send: scriptPerMessage },
    });
    const taskId = await loop.createTask();
    const phase = () => loop.snapshot().tasks[0]?.phase;

    const running = loop.start(taskId, "Export the part");
    await until(() => phase()?.kind === "approval");
    const asked = phase();
    if (asked?.kind !== "approval") throw new Error("Not asked");

    expect(asked.prompt).toMatchObject({
      why: { code: "cannot-undo" },
      fileRules: [{ choice: "file", label: "part.step", withoutBackup: true }],
    });
    await loop.resolveApproval(taskId, asked.prompt.id, "allow");
    await running;
  });
});
