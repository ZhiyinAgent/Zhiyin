/**
 * Stashing in a real repository: what a stash and its restore say they
 * change across the whole repository, and what they answer.
 */

import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { gitAutomation } from "../src/index.js";
import { execGitInit, git, gitOutput, withGit } from "./real-git.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

withGit("gitAutomation against a real repository", () => {
  let root = "";
  let automation: ReturnType<typeof gitAutomation>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    root = await folders.make("zhiyin-git-connector-");
    process.env.GIT_AUTHOR_NAME = "Test";
    process.env.GIT_AUTHOR_EMAIL = "test@example.com";
    process.env.GIT_COMMITTER_NAME = "Test";
    process.env.GIT_COMMITTER_EMAIL = "test@example.com";
    automation = gitAutomation({ workspaceRoot: () => root });
    await execGitInit(git as string, root);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function run(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean | undefined; text: string }> {
    const result = (await automation.callTool(name, args)) as {
      isError?: boolean;
      content: readonly { text: string }[];
    };
    return { isError: result.isError, text: result.content[0]?.text ?? "" };
  }

  it("says a stash sets aside tracked changes across the whole repository, and leaves new files", async () => {
    await mkdir(join(root, "app"));
    await writeFile(join(root, "outside.txt"), "committed\n", "utf8");
    await writeFile(join(root, "app", "inside.txt"), "committed\n", "utf8");
    await run("git_stage", { paths: ["outside.txt", "app/inside.txt"] });
    await run("git_commit", { message: "Add both" });
    await writeFile(join(root, "outside.txt"), "edited\n", "utf8");
    await writeFile(join(root, "app", "new.txt"), "new\n", "utf8");
    const inApp = gitAutomation({ workspaceRoot: () => join(root, "app") });
    const top = await realpath(root);

    const inspected = await inApp.inspect("git_stash", { action: "save" });
    await inApp.callTool("git_stash", { action: "save" });

    expect(inspected).toMatchObject({
      ok: true,
      detail: `Sets aside the uncommitted changes to tracked files across the whole repository at ${top}, and leaves new files where they are.`,
    });
    expect((await readFile(join(root, "outside.txt"), "utf8")).trim()).toBe(
      "committed",
    );
    expect(await readFile(join(root, "app", "new.txt"), "utf8")).toBe("new\n");
  });

  it("says switching a branch and restoring a stash change files across the whole repository, from a folder inside it too", async () => {
    await mkdir(join(root, "app"));
    await writeFile(join(root, "outside.txt"), "committed\n", "utf8");
    await writeFile(join(root, "app", "inside.txt"), "committed\n", "utf8");
    await run("git_stage", { paths: ["outside.txt", "app/inside.txt"] });
    await run("git_commit", { message: "Add both" });
    await gitOutput(root, ["branch", "other"]);
    const inApp = gitAutomation({ workspaceRoot: () => join(root, "app") });
    const top = await realpath(root);

    const switching = await inApp.inspect("git_switch_branch", {
      name: "other",
    });
    const restoring = await inApp.inspect("git_stash", { action: "pop" });

    expect(switching).toMatchObject({
      ok: true,
      detail: `Replaces the tracked files across the whole repository at ${top} with the branch's.`,
    });
    expect(restoring).toMatchObject({
      ok: true,
      detail: `Restores the most recently stashed changes across the whole repository at ${top}, and removes them from the stash.`,
    });
  });

  it("answers a stash with how many are kept and what is left, and a stash of nothing as an error", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });

    const nothing = await run("git_stash", { action: "save" });
    await writeFile(join(root, "note.txt"), "changed\n", "utf8");
    const saved = await run("git_stash", { action: "save", message: "wip" });
    const popped = await run("git_stash", { action: "pop" });

    expect(nothing).toEqual({
      isError: true,
      text: "Nothing was stashed: no tracked file has changes.",
    });
    expect(saved.text).toMatch(
      /^Saved working directory and index state On \S+: wip\nStashes kept: 1\. Nothing is left uncommitted\.$/,
    );
    expect(popped.text).toMatch(
      /\nStashes kept: 0\. Not committed: 1 changed file\.$/,
    );
    // Restored as git's settings check it out, its line endings included.
    expect(await readFile(join(root, "note.txt"), "utf8")).toMatch(
      /^changed\r?\n$/,
    );
  });

  it("stashes and restores uncommitted changes", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await writeFile(join(root, "note.txt"), "changed\n", "utf8");

    // Stashing runs the repository's own filters, so it is asked every time.
    expect(
      await automation.inspect("git_stash", { action: "save", message: "wip" }),
    ).toMatchObject({ ok: true, asksEachTime: true });
    const save = await run("git_stash", { action: "save", message: "wip" });
    expect(save.isError).toBeFalsy();
    expect((await readFile(join(root, "note.txt"), "utf8")).trim()).toBe(
      "hello",
    );

    const list = await run("git_stash", { action: "list" });
    expect(list.text).toContain("wip");

    const pop = await run("git_stash", { action: "pop" });
    expect(pop.isError).toBeFalsy();
    expect((await readFile(join(root, "note.txt"), "utf8")).trim()).toBe(
      "changed",
    );
  });
});
