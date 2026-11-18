/**
 * A shell command that starts with a plain deleting program is refused before
 * anyone is asked, and the refusal points the model to delete_file, which
 * shows the person whether each item can be restored.
 *
 * The list steers; it does not guard. Any program can delete, so a command
 * that deletes another way reaches the person's approval like any command.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "../src/index.js";

const tools = new WorkspaceTools(process.cwd(), { shell: "bash" });
const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

function inspect(command: string) {
  return tools.inspect("bash", {
    command,
    purpose: "A command for this test.",
  });
}

describe("a shell command that deletes", () => {
  it.each([
    ["rm notes.md", "rm"],
    ["rm -rf build", "rm"],
    ["/usr/bin/rm notes.md", "rm"],
    ["rm.exe notes.md", "rm"],
    ["FORCE=1 rm notes.md", "rm"],
    ["rmdir old", "rmdir"],
    ["del notes.md", "del"],
    ["DEL notes.md", "del"],
    ["Remove-Item build -Recurse", "Remove-Item"],
    ["find . -name '*.tmp' -delete", "find -delete"],
    ["git clean -fdx", "git clean"],
    // Each simple command is looked at, wherever it stands in the line.
    ["cd out && rm -f *.log", "rm"],
    ["make || rm build.log", "rm"],
    ["ls; rm notes.md", "rm"],
    ["ls | rm notes.md", "rm"],
    ["echo start\nrm notes.md", "rm"],
    ["(cd build && rm -rf dist)", "rm"],
    ["echo $(rm notes.md)", "rm"],
    ["echo `rm notes.md`", "rm"],
    ["cat <<'EOF' > notes.md\nkeep\nEOF\nrm old.md", "rm"],
  ])("refuses %s and points to delete_file", async (command, named) => {
    expect(await inspect(command)).toEqual({
      ok: false,
      correctable: true,
      reason: `Shell commands may not delete files, and this one does (${named}). Use delete_file instead: it moves them to the Recycle Bin, or with mode "permanent" deletes them for good, and shows the person which before they approve.`,
    });
  });

  it.each([
    // Text that names a deleting program is not a command.
    'echo "rm notes.md"',
    "grep -rn 'rm -rf' .",
    "cat rm.txt",
    "ls -la firmware",
    "git rm --cached notes.md",
    "echo done # then rm notes.md",
    "git commit -m \"$(cat <<'EOF'\nTidy the cache\n\nrm is no longer called; del neither.\nEOF\n)\"",
    "cat > README.md <<'EOF'\n## Clean\n\nrm -rf node_modules\nEOF",
    "cat <<-EOF > steps.txt\n\trm build\n\tEOF\necho done",
    "echo one \\\n  rm two",
    // Commands that delete some other way go to the person's approval.
    "$(echo rm) notes.txt",
    "r=rm; $r notes.txt",
    "bash -c 'rm notes.md'",
    "perl -e 'unlink \"notes.txt\"'",
    "ruby -e 'File.delete(\"notes.txt\")'",
    `python -c "import os; os.remove('notes.txt')"`,
    "python cleanup.py",
    "mv notes.txt /dev/null",
    "git checkout -- .",
    "git reset --hard",
    "truncate -s 0 notes.txt",
    ": > notes.txt",
    "make clean",
    "npm run clean",
    "robocopy empty target /MIR",
  ])("lets %s through to the person's approval", async (command) => {
    expect(await inspect(command)).toMatchObject({
      ok: true,
      action: "Run a command",
    });
  });

  it.each(["rm notes.md", "cd sub && rm notes.md"])(
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
          purpose: "A command for this test.",
        }),
      ).toMatchObject({ ok: false, correctable: true });
      expect(await readFile(join(root, "notes.md"), "utf8")).toBe("Notes.");
      expect(await readFile(join(root, "sub", "notes.md"), "utf8")).toBe(
        "Notes.",
      );
    },
  );
});
