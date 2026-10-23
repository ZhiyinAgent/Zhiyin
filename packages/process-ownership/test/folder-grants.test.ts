/**
 * The order grants are written in, against a stand-in for Windows'
 * permission calls: which grant a run waits for, and which it does not.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { folderGrants, type Advapi32 } from "../src/folder-grants.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/**
 * Windows as far as grants go: each folder's entries, kept across sessions of
 * the app, and grants that finish when the test says, for the folders it
 * holds back.
 */
function standInWindows() {
  const entries = new Map<string, string[]>();
  const started: string[] = [];
  const held = new Map<string, () => void>();
  const holding = new Set<string>();
  const api: Advapi32 = {
    permissions: (path) =>
      `D:${(entries.get(path) ?? []).map((sid) => `(A;OICI;FA;;;${sid})`).join("")}`,
    grant: async (path, sid) => {
      started.push(path);
      if (holding.has(path))
        await new Promise<void>((resolve) => held.set(path, resolve));
      entries.set(path, [...(entries.get(path) ?? []), sid]);
      return 0;
    },
    reach: () => "passed",
    keepsPermissions: () => true,
    message: (error) => `Windows error ${error}`,
  };
  return {
    api: () => api,
    started,
    hold: (path: string) => holding.add(path),
    release: (path: string) => held.get(path)?.(),
    forget: (path: string) => entries.delete(path),
  };
}

const settled = async (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 200)),
  ]);

describe("folder grants", () => {
  it("grants a new folder a run waits for before a granted folder's grant behind the run", async () => {
    const windows = standInWindows();
    const workspace = await folders.make("zhiyin-grants-workspace-");
    const fresh = await folders.make("zhiyin-grants-fresh-");
    await folderGrants(windows.api).grantAll([
      { folder: workspace, access: "write" },
    ]);

    // A later session of the app: the workspace carries its grant already.
    windows.started.length = 0;
    windows.hold(workspace);
    const run = folderGrants(windows.api).grantAll([
      { folder: workspace, access: "write" },
      { folder: fresh, access: "write" },
    ]);

    expect(await settled(run)).toBe(true);
    expect(windows.started).toEqual([fresh, workspace]);
    windows.release(workspace);
  });

  it("grants again a folder that lost its grant, as one removed and made again does", async () => {
    const windows = standInWindows();
    const environment = await folders.make("zhiyin-grants-environment-");
    const grants = folderGrants(windows.api);
    await grants.grantAll([{ folder: environment, access: "read" }]);
    await grants.grantAll([{ folder: environment, access: "read" }]);
    expect(windows.started).toEqual([environment]);

    windows.forget(environment);
    await grants.grantAll([{ folder: environment, access: "read" }]);

    expect(windows.started).toEqual([environment, environment]);
  });
});
