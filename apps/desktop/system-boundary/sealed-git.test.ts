/**
 * git from a sealed-off command, as the app composes it (ADR 0029): the
 * container's `git` hands each command to Zhiyin, which runs the person's
 * Git outside the container. It works in the workspace, and runs none of the
 * programs a repository names: not its hooks, nor an alias that runs one.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { forgetConfinement, openProcessContainer } from "@zhiyin/sandbox";
import { resolveGit, shellGit } from "@zhiyin/git-connector";
import { WorkspaceTools } from "@zhiyin/tools";

/** Zhiyin's shell as the gate builds it. */
const built = process.env["ZHIYIN_BUSYBOX"] ?? "";
const folders = new TemporaryFolders();
const homes = new TemporaryFolders();
let homesFolder = "";

afterEach(() => folders.removeAll());
afterAll(async () => {
  for (const name of ["start-check", "chat"])
    forgetConfinement("shell", join(homesFolder, name));
  await homes.removeAll();
});

describe.runIf(
  process.platform === "win32" && built !== "" && resolveGit() !== undefined,
)("git from a sealed-off command", { timeout: 180_000 }, () => {
  it("commits, diffs and logs in the workspace, running no hook and no alias that starts a program", async () => {
    homesFolder = await homes.make("zhiyin-sealed-git-homes-");
    const root = await folders.make("zhiyin-sealed-git-");
    const containment = { open: openProcessContainer };
    const tools = new WorkspaceTools(undefined, {
      containment,
      // Each call answers with what it printed, however slow a loaded
      // machine makes it, rather than becoming a job.
      promoteCommandsAfterMs: 150_000,
      sealedShell: {
        busybox: join(built, "busybox.exe"),
        handoff: join(built, "git"),
        homes: homesFolder,
        git: shellGit({ containment }),
      },
      reach: () => ({ hosts: [], read: [], change: [], registries: false }),
    });
    await tools.enterFolder("chat", root);
    const run = async (command: string) => {
      const result = await tools.execute(
        "bash",
        { command, purpose: "Use git." },
        undefined,
        "chat",
      );
      return (result as { value: { stdout: string; stderr: string } }).value;
    };

    const made = await run(
      [
        "git init -q",
        "git config user.name Tester && git config user.email tester@example.com",
        "{ test -d .git/hooks; echo templates=$?; }",
        "mkdir -p .git/hooks",
        "printf '#!/bin/sh\\necho ran > hook-ran\\n' > .git/hooks/pre-commit",
        "git config alias.look '!echo ran > alias-ran'",
        "echo one > a.txt && git add a.txt && git commit -q -m first",
        "echo two >> a.txt",
        "git status --short",
        "git diff",
        "git log --format=%s",
        "git look; echo alias=$?",
        "ls",
      ].join(" && ") + "; true",
    );

    expect(made.stdout, made.stderr).toContain(" M a.txt");
    // A repository made from no templates, and nothing said of them.
    expect(made.stdout).toContain("templates=1");
    expect(made.stderr).not.toContain("templates");
    expect(made.stdout).toContain("+two");
    expect(made.stdout).toContain("first");
    expect(made.stdout).not.toContain("hook-ran");
    expect(made.stdout).not.toContain("alias-ran");
    expect(existsSync(join(root, "hook-ran"))).toBe(false);
    expect(existsSync(join(root, "alias-ran"))).toBe(false);
  });
});
