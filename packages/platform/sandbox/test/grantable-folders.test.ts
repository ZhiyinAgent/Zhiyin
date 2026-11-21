/**
 * Which folders can be given to a container: those whose permissions this
 * account may change, as granting writes them.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { mayGrantFolder } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

describe.runIf(process.platform === "win32")("a folder to grant", () => {
  it("can be given when it is the person's own", async () => {
    expect(mayGrantFolder(await folders.make("zhiyin-grantable-"))).toBe(true);
  });

  it("cannot be given when only an administrator may change who opens it, unless this runs as one", () => {
    const common = join(
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      "Common Files",
    );
    // `net session` answers only an elevated administrator.
    const elevated =
      spawnSync("net", ["session"], { stdio: "ignore" }).status === 0;

    expect(mayGrantFolder(common)).toBe(elevated);
  });

  it("cannot be given when it is not there", () => {
    expect(mayGrantFolder(join(process.cwd(), "no-such-folder-here"))).toBe(
      false,
    );
  });
});
