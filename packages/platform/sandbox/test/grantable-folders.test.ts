/**
 * Which folders can be given to a container: those whose permissions this
 * account may change, as granting writes them.
 */

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

  it("cannot be given when Windows keeps who opens it to itself, as for Program Files, even to an administrator", () => {
    // Common Files belongs to TrustedInstaller: administrators may change
    // what is in it, not who opens it.
    const common = join(
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      "Common Files",
    );

    expect(mayGrantFolder(common)).toBe(false);
  });

  it("cannot be given when it is not there", () => {
    expect(mayGrantFolder(join(process.cwd(), "no-such-folder-here"))).toBe(
      false,
    );
  });
});
