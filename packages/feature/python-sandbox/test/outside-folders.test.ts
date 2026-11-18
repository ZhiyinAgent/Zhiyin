/**
 * A script that also changes folders outside the workspace: it names each
 * folder by its whole real path for Zhiyin to copy before it runs, the person
 * may allow it by those folders, and the script is given those folders and
 * nothing more. Zhiyin's own folders, and folders so wide they hold nearly
 * everything, are never given.
 */

import { mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pythonSandbox } from "../src/index.js";
import {
  folders,
  sandboxWith,
  scriptRuns,
  uvProgram,
} from "./fake-programs.js";

afterEach(() => folders.removeAll());

async function withOutside() {
  const made = await sandboxWith();
  const elsewhere = await folders.make("zhiyin-sandbox-elsewhere-");
  const own = await folders.make("zhiyin-sandbox-own-");
  const sandbox = pythonSandbox({
    workspaceRoot: () => made.workspace,
    directory: made.directory,
    uv: async () => uvProgram,
    run: made.run,
    protect: [own],
  });
  // The default environment is made first, so the asks below are the
  // script's own, not its environment's.
  await sandbox.callTool("run_python", { code: "print(0)" });
  made.calls.length = 0;
  return { ...made, sandbox, elsewhere, own };
}

describe("a script that changes folders outside the workspace", () => {
  it("names each folder's whole path, for Zhiyin to copy and the person to allow it by, and says it is outside the selected folder", async () => {
    const { sandbox, elsewhere } = await withOutside();

    const asked = await sandbox.inspect("run_python", {
      code: "open('out.csv', 'w')",
      outside_folders: [elsewhere],
    });

    expect(asked).toMatchObject({
      ok: true,
      changesAnyFile: { outside: [elsewhere] },
      detail: expect.stringContaining(
        `It can also change files in ${elsewhere}, outside the folder you selected.`,
      ),
    });
    // Allowed by its folders, never by the set of scripts that reach only
    // the workspace.
    expect(asked).not.toHaveProperty("asksEachTime");
    expect(asked).not.toHaveProperty("allowance");
  });

  it("may name a file there it could not copy by its whole path, which is then changed for good", async () => {
    const { sandbox, elsewhere } = await withOutside();
    const big = join(elsewhere, "big.parquet");

    const asked = await sandbox.inspect("run_python", {
      code: "print(1)",
      outside_folders: [elsewhere],
      change_locked: [big],
    });

    expect(asked).toMatchObject({
      ok: true,
      effects: { changes: "workspace-for-good" },
      changesAnyFile: { writable: [big], outside: [elsewhere] },
      detail: expect.stringContaining(big),
    });
  });

  it("may not name a file by its whole path outside the folders it is given", async () => {
    const { sandbox, elsewhere } = await withOutside();

    expect(
      await sandbox.inspect("run_python", {
        code: "print(1)",
        change_locked: [join(elsewhere, "big.parquet")],
      }),
    ).toMatchObject({ ok: false });
  });

  it("is given the workspace and those folders to change, and nothing else", async () => {
    const { sandbox, calls, interpreter, workspace, elsewhere } =
      await withOutside();

    await sandbox.callTool("run_python", {
      code: "print(1)",
      outside_folders: [elsewhere],
    });

    const [run] = scriptRuns(calls, interpreter());
    expect(run?.confinement?.write).toEqual([workspace, elsewhere]);
  });

  it("is refused, running nothing, for a folder Zhiyin keeps for itself or one holding it", async () => {
    const { sandbox, calls, own } = await withOutside();
    const inside = join(own, "approvals");
    await mkdir(inside);

    for (const folder of [own, inside, parse(own).dir]) {
      const asked = await sandbox.inspect("run_python", {
        code: "print(1)",
        outside_folders: [folder],
      });
      expect(asked).toMatchObject({ ok: false });
      const ran = await sandbox.callTool("run_python", {
        code: "print(1)",
        outside_folders: [folder],
      });
      expect(ran).toMatchObject({ isError: true });
    }
    expect(calls).toEqual([]);
  });

  it("is refused for a drive, the person's user folder, or a folder holding it", async () => {
    const { sandbox } = await withOutside();
    const home = homedir();

    for (const folder of [parse(home).root, home, parse(home).dir])
      expect(
        await sandbox.inspect("run_python", {
          code: "print(1)",
          outside_folders: [folder],
        }),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining("holds nearly everything"),
      });
  });

  it("is refused for a folder named by a relative path, one that is not there, or one reached through a link", async () => {
    const { sandbox, elsewhere } = await withOutside();
    const link = join(await folders.make("zhiyin-sandbox-link-"), "to");
    await symlink(elsewhere, link, "junction");

    for (const folder of ["out", join(elsewhere, "missing"), link])
      expect(
        await sandbox.inspect("run_python", {
          code: "print(1)",
          outside_folders: [folder],
        }),
      ).toMatchObject({ ok: false });
  });

  it("takes a folder inside the workspace as the workspace's, asking nothing more for it", async () => {
    const { sandbox, workspace, calls, interpreter } = await withOutside();
    await mkdir(join(workspace, "out"));

    const asked = await sandbox.inspect("run_python", {
      code: "print(1)",
      outside_folders: [join(workspace, "out")],
    });
    await sandbox.callTool("run_python", {
      code: "print(1)",
      outside_folders: [join(workspace, "out")],
    });

    expect(asked).toMatchObject({ ok: true, allowance: expect.anything() });
    expect(scriptRuns(calls, interpreter())[0]?.confinement?.write).toEqual([
      workspace,
    ]);
  });
});
