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
    [`python3.12 -c "import os; os.remove('notes.md')"`, "os.remove"],
    [`pythonw.exe -c "import shutil; shutil.rmtree('build')"`, "shutil.rmtree"],
    ["node_modules/.bin/rimraf.ps1 build", "rimraf"],
    ["powershell -File node_modules/.bin/rimraf.ps1 build", "rimraf"],
    ['pwsh -NoProfile -c "rimraf build"', "rimraf"],
    ['powershell -c "& rimraf.cmd build"', "rimraf"],
    ['powershell -c "& ./node_modules/.bin/rimraf.ps1 build"', "rimraf"],
    ["powershell -c \"& 'node_modules/.bin/rimraf.ps1' build\"", "rimraf"],
    ['powershell -c ". ./node_modules/.bin/rimraf.ps1 build"', "rimraf"],
    ['powershell -c "Write-Output start; npx rimraf build"', "rimraf"],
    ["pwsh ./node_modules/.bin/rimraf.ps1 build", "rimraf"],
    [
      "powershell -NoProfile -ExecutionPolicy Bypass node_modules/.bin/rimraf.ps1 build",
      "rimraf",
    ],
    ["pwsh -Command Get-ChildItem -File '|' Remove-Item", "Remove-Item"],
    // PowerShell takes any unambiguous start of an option's name.
    ['powershell -exec bypass -c "Remove-Item build -Recurse"', "Remove-Item"],
    [
      'powershell -nop -exec bypass -Command "Remove-Item build"',
      "Remove-Item",
    ],
    ['powershell -win hidden -c "Remove-Item build"', "Remove-Item"],
    ['powershell -comm "Remove-Item build"', "Remove-Item"],
    ['powershell -ep bypass -c "Remove-Item build"', "Remove-Item"],
    ['powershell -co "Remove-Item build"', "Remove-Item"],
    ["pwsh -in ./node_modules/.bin/rimraf.ps1 build", "rimraf"],
    ['powershell -ve "x; Remove-Item build"', "Remove-Item"],
    ['pwsh -ConfigurationFile a.pssc -c "Remove-Item build"', "Remove-Item"],
    ['powershell //c "Remove-Item build"', "Remove-Item"],
    [`powershell -c "& 'C:/Program Files/Git/usr/bin/rm.exe' -rf build"`, "rm"],
    [`powershell -c "bash -c 'npm run build; rm -rf dist'"`, "rm"],
    [`powershell -c "python -c 'import os; os.remove(1)'"`, "os.remove"],
    ['powershell -c \'Write-Output "a`"b"; Remove-Item build\'', "Remove-Item"],
    ["powershell -c 'Write-Output \"$(Remove-Item build)\"'", "Remove-Item"],
    [
      "powershell -c 'Microsoft.PowerShell.Management\\Remove-Item build'",
      "Microsoft.PowerShell.Management\\Remove-Item",
    ],
    [
      `powershell -enc ${Buffer.from("Remove-Item build", "utf16le").toString("base64")}`,
      "Remove-Item",
    ],
    [
      `powershell -ec ${Buffer.from("Remove-Item build", "utf16le").toString("base64")}`,
      "Remove-Item",
    ],
    ['pwsh -c "Write-Output a && Remove-Item build"', "Remove-Item"],
    ['pwsh -c "Start-Sleep 1 & Remove-Item build"', "Remove-Item"],
    [
      "powershell -exec bypass -File node_modules/.bin/rimraf.ps1 build",
      "rimraf",
    ],
    ["powershell -c \"Write-Output 'a; b'; del notes.md\"", "del"],
    [`powershell -c "[IO.File]::Delete('notes.md')"`, "[IO.File]::Delete"],
    [
      `powershell -c "[System.IO.Directory]::Delete('build', $true)"`,
      "[System.IO.Directory]::Delete",
    ],
    [`node -e "require('fs').rmSync('build', { recursive: true })"`, "rmSync"],
    // A backslash before a line break joins the lines, as bash does.
    ["git -C sub \\\n  clean -fdx", "git clean"],
    ["git \\\n clean -fdx", "git clean"],
    ["ls *.log | xargs \\\n  rm -f", "rm"],
    ["sudo \\\n rm notes.md", "rm"],
    ["bash \\\n  -c 'rm notes.md'", "rm"],
    [`py -3 -c "import os; os.remove('x')"`, "os.remove"],
    [`py -3.12 -c "import shutil; shutil.rmtree('build')"`, "shutil.rmtree"],
    ["cmd //c rm -rf build", "rm"],
    ["cmd /c git clean -fdx", "git clean"],
    [`cmd /c python -c "import os; os.remove('x')"`, "os.remove"],
    ["npx rimraf dist", "rimraf"],
    ["npx -y rimraf node_modules", "rimraf"],
    ["pnpm dlx rimraf dist", "rimraf"],
    ["npm exec -- rimraf dist", "rimraf"],
    // A pinned version and a Windows shim are ordinary ways to run one.
    ["npx rimraf@latest dist", "rimraf"],
    ["npx --yes rimraf@5 dist", "rimraf"],
    ["pnpm dlx rimraf@6 dist", "rimraf"],
    ["npm exec rimraf@5 -- dist", "rimraf"],
    ["npx.cmd rimraf dist", "rimraf"],
    ["rimraf.cmd dist", "rimraf"],
    ["RIMRAF.CMD dist", "rimraf"],
    ["node_modules/.bin/rimraf.cmd dist", "rimraf"],
    // A heredoc is code when what reads it runs code from its input.
    [
      "python - <<'EOF'\nimport shutil; shutil.rmtree('b')\nEOF",
      "shutil.rmtree",
    ],
    ["bash <<EOF\nrm -rf build\nEOF", "rm"],
    ["cat <<'EOF' > notes.md\nkeep\nEOF\nrm old.md", "rm"],
    ["cat <<-EOF > notes.md\n\tkeep\n\tEOF\nrm old.md", "rm"],
    // An unquoted heredoc runs what it substitutes as it is read.
    ["cat <<EOF > out.txt\n$(rm -rf build)\nEOF", "rm"],
    ["cat <<EOF > out.txt\n`rm -rf build`\nEOF", "rm"],
    // A heredoc goes on down a pipe, and $(cat <<EOF …) stands for its text.
    ["cat <<'EOF' | bash\nrm -rf build\nEOF", "rm"],
    ["cat <<EOF | python3\nimport os; os.remove('x')\nEOF", "os.remove"],
    ["bash -c \"$(cat <<'EOF'\nrm -rf build\nEOF\n)\"", "rm"],
    // Arithmetic's << is a shift: the lines after it still run.
    ["(( n = 1 << 2 ))\nrm -rf build", "rm"],
    ["bash <<< 'rm -rf build'", "rm"],
    ["bash -s first <<EOF\nrm -rf build\nEOF", "rm"],
    [
      "python -W ignore - <<EOF\nimport shutil; shutil.rmtree('b')\nEOF",
      "shutil.rmtree",
    ],
    // A cmd /c line in quotes is split as cmd splits it.
    ['cmd /c "cd build && del notes.md"', "del"],
    ['cmd /c "echo hi & rd /s /q build"', "rd"],
    ["cmd //c 'cd build && del notes.md'", "del"],
    ['cmd /c "cd \\"Bob\'s files\\" && del notes.txt"', "del"],
    ['cmd /c "if exist dist rmdir /s /q dist"', "rmdir"],
    ['cmd /c "for %f in (*.tmp) do del %f"', "del"],
    ['cmd /c "(del a) & echo done"', "del"],
    [
      `cmd /c python -c "print(\\"a b\\"); import os; os.remove('x')"`,
      "os.remove",
    ],
    ["sudo -u deploy rm -rf build", "rm"],
    ["timeout -s KILL 5 rm -rf build", "rm"],
    ["echo $(( 1 << 2 ))\nrm -rf build", "rm"],
    // A shell's options may take a value of their own, or several at once.
    ["bash -euo pipefail <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["bash -o pipefail <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["bash +e <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["bash -euo pipefail -c 'rm -rf build'", "rm"],
    // Arithmetic after a keyword, and two subshells that only look like it.
    ["if (( head << 2 )); then echo big; fi\nrm -rf build", "rm"],
    [
      "for (( tail = 1; tail < 9; tail <<= 1 )); do echo $tail; done\nrm -rf build",
      "rm",
    ],
    ["((cd build && rm -rf dist) || true)", "rm"],
    ["(( $(rm -rf build) ))", "rm"],
    // What a substitution prints, however it prints it, runs under bash -c.
    ['bash -c "$(cat <<EOF\ncd $(pwd)/build && rm -rf dist\nEOF\n)"', "rm"],
    ["bash -c \"$(cat <<'EOF' | sed 's/a/b/'\nrm -rf build\nEOF\n)\"", "rm"],
    ["bash -c \"`cat <<'EOF'\nrm -rf build\nEOF\n`\"", "rm"],
    ['bash -c "$(echo rm -rf build)"', "rm"],
    ["bash -c \"$(cd build; cat <<'EOF'\nrm -rf dist\nEOF\n)\"", "rm"],
    ["cat <<'EOF' |& bash\nrm -rf build\nEOF", "rm"],
    ["bash <(cat <<'EOF'\nrm -rf build\nEOF\n)", "rm"],
    ["source <(cat <<'EOF'\nrm -rf build\nEOF\n)", "rm"],
    // Input is code unless what reads it only reads text.
    ["sudo -u deploy bash <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["source /dev/stdin <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["bash /dev/stdin <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["xargs -I{} bash -c '{}' <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["wsl <<'EOF'\nrm -rf build\nEOF", "rm"],
    ["wsl -d Ubuntu rm -rf build", "rm"],
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
    "python3.12 -m pytest",
    "powershell -File build.ps1",
    'powershell -c "Get-Item notes.md"',
    "powershell -File build.ps1 -Clean",
    'pwsh -c "Get-ChildItem -File"',
    'powershell -c "Write-Output rimraf"',
    "pwsh -ExecutionPolicy Bypass ./build.ps1",
    // Within PowerShell's quotes, separators and command names are text.
    `powershell -c "Select-String -Path *.ts -Pattern 'TODO|rm'"`,
    `powershell -c "Get-Alias | Where-Object Name -match '^(rm|del)$'"`,
    `powershell -c "git log --oneline | Select-String 'fix|rimraf'"`,
    `powershell -c "Write-Output 'a | find . -delete'"`,
    `powershell -c "Write-Output 'step one; del is next'"`,
    `pwsh -c "Write-Host 'cleanup (rm skipped)'"`,
    `pwsh -c "Write-Host '[IO.File]::Delete(x)'"`,
    // A quoted word standing alone is a value, not a command.
    `powershell -c "Write-Output ('rm')"`,
    `powershell -c "1..3 | ForEach-Object { 'del' }"`,
    `powershell -c "if ($true) { 'erase' }"`,
    `powershell -c "switch ($x) { 'rm' { 1 } }"`,
    `powershell -c "$h = @{ rm = 1 }"`,
    // A heredoc read as text is text, whatever its lines say.
    "git commit -m \"$(cat <<'EOF'\nFix the cache\n\nErase stale entries on startup.\nEOF\n)\"",
    "git commit -m \"$(cat <<'EOF'\nUnlink the old handler. Don't retry.\nEOF\n)\"",
    "cat > README.md <<'EOF'\n## Clean\n\nrm -rf node_modules\nEOF",
    "cat <<-EOF > steps.txt\n\trm build\n\tEOF\necho done",
    "python - <<'EOF'\nprint('tidy')\nEOF",
    "echo one \\\n  two",
    // Quoted, a heredoc's $(…) is text.
    "cat <<'EOF' > notes.md\n$(rm -rf build)\nEOF",
    "cat <<EOF > notes.md\n\\$(rm -rf build)\nEOF",
    "echo $(( 1 << 2 ))",
    "grep -c rm <<< 'rm -rf build'",
    "git commit -F - <<'EOF'\nTidy; rm old notes\nEOF",
    "cat <<'EOF' | git commit -F -\nTidy; rm old notes\nEOF",
    "bash -o pipefail build.sh <<'EOF'\nrm -rf build\nEOF",
    "diff <(cat <<'EOF'\nrm -rf build\nEOF\n) notes.txt",
    "while read f; do echo \"$f\"; done <<'EOF'\nrm -rf build\nEOF",
    // cmd splits only at its own separators, outside its quotes.
    `cmd /c 'git commit -m "tidy; rm old notes"'`,
    'cmd /c "echo done; rm is not run"',
    'cmd /c "echo a ^& del b"',
    'cmd /c "echo \\"x & del y\\""',
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
