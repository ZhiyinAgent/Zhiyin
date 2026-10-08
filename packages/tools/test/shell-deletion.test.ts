/**
 * Deleting goes through delete_file, which shows the person whether each item
 * can be restored from the Recycle Bin. A shell command that deletes is
 * refused before anyone is asked, and the refusal says where to go instead.
 *
 * Recognised, not proven: a program or script can still delete files on its
 * own, and the shell approval remains what governs that.
 */

import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

const tools = new WorkspaceTools(process.cwd(), { shell: "bash" });

function inspect(command: string) {
  return tools.inspect("bash", {
    command,
    explanation: "A command for this test.",
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
    ["cmd /c del notes.md", "del"],
    ['cmd.exe /c "rd /s /q build"', "rd"],
    ['powershell -Command "Remove-Item build -Recurse"', "Remove-Item"],
    ["git clean -fdx", "git clean"],
    ["git rm notes.md", "git rm"],
    [`python -c "import shutil; shutil.rmtree('build')"`, "shutil.rmtree"],
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
    "npm run build",
  ])("lets %s through to the person's approval", async (command) => {
    expect(await inspect(command)).toMatchObject({
      ok: true,
      action: "Run a command",
    });
  });

  it("refuses at execution too, so nothing deletes without having been inspected", async () => {
    expect(
      await tools.execute("bash", {
        command: "rm notes.md",
        explanation: "A command for this test.",
      }),
    ).toMatchObject({ ok: false, correctable: true });
  });
});
