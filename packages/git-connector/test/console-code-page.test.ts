/**
 * Git's output that is not UTF-8 is read in the console's code page. On a
 * multibyte one, as Chinese, Japanese and Korean Windows use, a byte that
 * starts a character takes the byte after it, a dot included, so a filter's
 * name can come back joined to what follows it or as another name. Here that
 * code page is stood in for, and the filter git would run is real.
 */

import { appendFile, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { gitAutomation, resolveGit } from "../src/index.js";

/** A multibyte code page: a byte from 0x81 on takes the next as one character. */
vi.mock("../../process-ownership/src/windows.js", async (original) => ({
  ...(await original<object>()),
  oemText: (bytes: Buffer) => {
    let text = "";
    for (let at = 0; at < bytes.length; at += 1) {
      const byte = bytes[at]!;
      if (byte >= 0x81 && at + 1 < bytes.length) {
        text += "・";
        at += 1;
      } else text += String.fromCharCode(byte);
    }
    return text;
  },
}));

const folders = new TemporaryFolders();
const git = resolveGit();

afterEach(() => folders.removeAll());

describe.runIf(git)("a read where the console's code page is multibyte", () => {
  let root = "";
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    root = await folders.make("zhiyin-git-code-page-");
    for (const name of ["GIT_AUTHOR", "GIT_COMMITTER"]) {
      process.env[`${name}_NAME`] = "Test";
      process.env[`${name}_EMAIL`] = "test@example.com";
    }
    await git_(["init", "--quiet"]);
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await git_(["add", "note.txt"]);
    await git_(["commit", "--quiet", "-m", "Add note"]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function git_(args: string[]): Promise<string> {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve, reject) =>
      execFile(git as string, args, { cwd: root }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      ),
    );
  }

  it.each([
    ["byte 0xE9 before the dot", [0x70, 0xe9]],
    ["bytes 0x81 0x7F, read as one character", [0x70, 0x81, 0x7f]],
  ])(
    "runs none of the repository's filters named with %s",
    async (_name, bytes) => {
      const ran = await folders.make("zhiyin-git-ran-");
      const marking = `touch '${join(ran, "clean").replaceAll("\\", "/")}'; cat`;
      const name = Buffer.from(bytes);
      await appendFile(
        join(root, ".git", "config"),
        Buffer.concat([
          Buffer.from('[filter "'),
          name,
          Buffer.from(`"]\n\tclean = ${marking}\n`),
        ]),
      );
      await writeFile(
        join(root, ".git", "info", "attributes"),
        Buffer.concat([Buffer.from("*.txt filter="), name, Buffer.from("\n")]),
      );
      await writeFile(join(root, "note.txt"), "jello\n", "utf8");
      const hourAgo = new Date(Date.now() - 3_600_000);
      await utimes(join(root, "note.txt"), hourAgo, hourAgo);

      const status = (await gitAutomation({
        workspaceRoot: () => root,
      }).callTool("git_status", {})) as { isError?: boolean };

      expect(status.isError).toBe(true);
      expect(await readdir(ran)).toEqual([]);
    },
  );
});
