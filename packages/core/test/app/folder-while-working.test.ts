/** Going to a conversation whose work is running. */

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, realpath, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "@zhiyin/tools";
import { loopFrom, stubDependencies, until } from "./support.js";

const made = new TemporaryFolders();
afterEach(() => made.removeAll());

describe("AgentLoop going to a conversation whose turn runs, after its folder's path came to lead elsewhere", () => {
  it("leaves the running turn in the folder it entered", async () => {
    const base = await made.make("zr11s-");
    const first = join(base, "first");
    const second = join(base, "second");
    await mkdir(first);
    await mkdir(second);
    const link = join(base, "project");
    await symlink(first, link, "junction");

    let releaseModel = () => {};
    const modelHeld = new Promise<void>((resolve) => (releaseModel = resolve));
    let asked = false;
    const deps = stubDependencies(() => {});
    const tools = new WorkspaceTools();
    let number = 0;
    const loop = loopFrom({
      ...deps,
      workspace: tools,
      newTaskId: () => `task-${++number}`,
      model: {
        ...deps.model,
        send: async function* () {
          asked = true;
          await modelHeld;
          yield { kind: "textDelta" as const, text: "Done" };
          yield { kind: "done" as const };
        },
      },
    });
    await loop.initialize();
    const working = await loop.createTask();
    await loop.selectWorkspace(link);
    const sending = loop.start(working, "Tidy it.");
    await until(() => asked);
    const entered = tools.workspaceRoot(working);
    expect(entered).toBe(await realpath(first));

    // The person looks at another conversation; meanwhile the path the
    // working conversation names comes to lead to another folder.
    await loop.createTask();
    await unlink(link);
    await symlink(second, link, "junction");
    await loop.selectTask(working);

    // ADR 0008: the folder a conversation enters is the one its turn reads
    // for its whole length.
    expect(tools.workspaceRoot(working)).toBe(entered);
    releaseModel();
    await sending;
  });
});
