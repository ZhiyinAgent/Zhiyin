/**
 * Deleting goes through delete_file, which shows the person whether each item
 * can be restored from the Recycle Bin. A shell command that deletes is
 * refused before anyone is asked, and the refusal says where to go instead.
 *
 * Recognised, not proven: a program or script can still delete files on its
 * own, and the shell approval remains what governs that.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "../src/index.js";

const tools = new WorkspaceTools(process.cwd(), { shell: "bash" });
const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

function inspect(command: string) {
  return tools.inspect("bash", {
    command,
    description: "A command for this test.",
  });
}

describe("a shell command that deletes", () => {
  it.each([
    ["rm notes.md", "rm"],
    ["rm -rf build", "rm"],
    ["cd out && rm -f *.log", "rm"],
    ["/usr/bin/rm notes.md", "rm"],
    ["sudo rm notes.md", "rm"],
    ["FORCE=1 rm notes.md", "rm"],
    ["rmdir old", "rmdir"],
    ["unlink notes.md", "unlink"],
    ["find . -name '*.tmp' -delete", "find -delete"],
    ["find . -name '*.tmp' -exec rm {} \\;", "rm"],
    ["ls *.log | xargs rm", "rm"],
    ["echo $(rm notes.md)", "rm"],
    ["echo `rm notes.md`", "rm"],
    ["bash -c 'rm notes.md'", "rm"],
    ["bash -lc 'rm notes.md'", "rm"],
    ['sh -ec "rm -rf build"', "rm"],
    ["bash -o pipefail -c 'rm notes.md'", "rm"],
    ["cmd /c del notes.md", "del"],
    ['cmd.exe /c "rd /s /q build"', "rd"],
    ['powershell -Command "Remove-Item build -Recurse"', "Remove-Item"],
    ["git clean -fdx", "git clean"],
    ["git rm notes.md", "git rm"],
    ["git -C sub clean -fdx", "git clean"],
    ["git -C sub rm notes.md", "git rm"],
    ["git -C 'my dir' clean -fd", "git clean"],
    ["git -Csub rm notes.md", "git rm"],
    ["git -C sub -c core.quotepath=off rm notes.md", "git rm"],
    ["git -C sub --no-pager rm notes.md", "git rm"],
    ["cd sub && git -C . rm -r build", "git rm"],
    ["git -c core.quotepath=off clean -fd", "git clean"],
    ["git --git-dir .git --work-tree . rm notes.md", "git rm"],
    ["cmd //c del notes.md", "del"],
    ["cmd /d /c del notes.md", "del"],
    [`python -c "import shutil; shutil.rmtree('build')"`, "shutil.rmtree"],
    [`python3 -Bc "import os; os.remove('notes.md')"`, "os.remove"],
    [`py -c"import os; os.remove('notes.md')"`, "os.remove"],
    [`node -e "require('fs').rmSync('build', { recursive: true })"`, "rmSync"],
  ])("refuses %s and points to delete_file", async (command, named) => {
    expect(await inspect(command)).toEqual({
      ok: false,
      correctable: true,
      reason: `Shell commands may not delete files, and this one does (${named}). Use delete_file instead: it moves them to the Recycle Bin, or with mode "permanent" deletes them for good, and shows the person which before they approve.`,
    });
  });

  it.each([
    'echo "rm notes.md"',
    "grep -rn 'rm -rf' .",
    "cat rm.txt",
    "ls -la firmware",
    "mv draft.md final.md",
    "git rm --cached notes.md",
    "git -C sub status",
    "git -C sub rm --cached notes.md",
    "git -c core.quotepath=off log",
    "npm run build",
    "bash -l build.sh",
    "python -B tidy.py",
  ])("lets %s through to the person's approval", async (command) => {
    expect(await inspect(command)).toMatchObject({
      ok: true,
      action: "Run a command",
    });
  });

  it.each(["rm notes.md", "git -C sub rm notes.md"])(
    "refuses %s at execution too, so nothing deletes without having been inspected",
    async (command) => {
      const root = await folders.make("zhiyin-shell-deletion-");
      await mkdir(join(root, "sub"));
      await writeFile(join(root, "notes.md"), "Notes.");
      await writeFile(join(root, "sub", "notes.md"), "Notes.");
      const here = new WorkspaceTools(root, { shell: "bash" });

      expect(
        await here.execute("bash", {
          command,
          description: "A command for this test.",
        }),
      ).toMatchObject({ ok: false, correctable: true });
      expect(await readFile(join(root, "notes.md"), "utf8")).toBe("Notes.");
      expect(await readFile(join(root, "sub", "notes.md"), "utf8")).toBe(
        "Notes.",
      );
    },
  );
});
