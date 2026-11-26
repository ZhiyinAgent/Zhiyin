/**
 * Creating and switching branches in a real repository: what each answers,
 * and the switches refused before and after approval, so a switch never
 * replaces or follows anything of the person's.
 */

import {
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

  it("answers a branch created or switched to with where it stands", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });

    const created = await run("git_create_branch", { name: "feature/notes" });
    const switched = await run("git_switch_branch", { name: "feature/notes" });

    expect(created.text).toMatch(
      /^Created branch feature\/notes at [0-9a-f]{7,} Add note\. Still on (main|master): git_switch_branch moves to it\.$/,
    );
    expect(switched).toMatchObject({ isError: undefined });
    expect(switched.text).toMatch(
      /^Now on feature\/notes at [0-9a-f]{7,} Add note\. Nothing is left uncommitted\.$/,
    );
  });

  it("answers a switch with what git printed, then where it stands", async () => {
    const upstream = await folders.make("zhiyin-git-connector-");
    await gitOutput(upstream, ["init", "--quiet", "--bare"]);
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    const main = (
      await gitOutput(root, ["symbolic-ref", "--short", "HEAD"])
    ).trim();
    await gitOutput(root, ["remote", "add", "origin", upstream]);
    await gitOutput(root, ["push", "--quiet", "-u", "origin", main]);
    await writeFile(join(root, "more.txt"), "more\n", "utf8");
    await run("git_stage", { paths: ["more.txt"] });
    await run("git_commit", { message: "Add more" });
    await run("git_create_branch", { name: "other" });
    await gitOutput(root, ["switch", "--quiet", "other"]);

    const switched = await run("git_switch_branch", { name: main });

    expect(switched.isError).toBeFalsy();
    expect(switched.text).toMatch(
      new RegExp(
        `^Your branch is ahead of 'origin/${main}' by 1 commit\\.\\n[^]*\\nNow on ${main} at [0-9a-f]{7,} Add more\\. Nothing is left uncommitted\\.$`,
      ),
    );
  });

  it("answers a branch created with what git printed, then where it stands", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    const main = (
      await gitOutput(root, ["symbolic-ref", "--short", "HEAD"])
    ).trim();
    await gitOutput(root, ["config", "branch.autoSetupMerge", "always"]);

    const created = await run("git_create_branch", { name: "tracking" });

    expect(created.isError).toBeFalsy();
    expect(created.text).toMatch(
      new RegExp(
        `^branch 'tracking' set up to track '${main}'\\.\\nCreated branch tracking at [0-9a-f]{7,} Add note\\. Still on ${main}: git_switch_branch moves to it\\.$`,
      ),
    );
  });

  it("answers a switch that ends on another branch than the one asked for as an error", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await run("git_create_branch", { name: "asked" });
    await run("git_create_branch", { name: "elsewhere" });
    // The repository's own hook moves HEAD once git has switched.
    await writeFile(
      join(root, ".git", "hooks", "post-checkout"),
      "#!/bin/sh\ngit symbolic-ref HEAD refs/heads/elsewhere\n",
      "utf8",
    );

    const switched = await run("git_switch_branch", { name: "asked" });

    expect(switched).toEqual({
      isError: true,
      text: "git answered, but the repository is on elsewhere, not asked.",
    });
  });

  it("reports the current branch after a commit", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });

    const branch = await run("git_branch", {});
    expect(branch.isError).toBeFalsy();
    expect(branch.text).toMatch(/^\*\s+\S+/m);
  });

  it("creates a branch and switches to it, asking each time", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });

    const asksEachTime = {
      ok: true,
      effects: expect.objectContaining({ runs: "full-access" }),
      asksEachTime: true,
    };
    expect(
      await automation.inspect("git_create_branch", { name: "feature/notes" }),
    ).toMatchObject(asksEachTime);
    const created = await run("git_create_branch", { name: "feature/notes" });
    expect(created.isError).toBeFalsy();
    expect((await run("git_branch", {})).text).toMatch(/^\*\s+(main|master)$/m);

    expect(
      await automation.inspect("git_switch_branch", { name: "feature/notes" }),
    ).toMatchObject(asksEachTime);
    const switched = await run("git_switch_branch", { name: "feature/notes" });
    expect(switched.isError).toBeFalsy();
    expect((await run("git_branch", {})).text).toMatch(
      /^\*\s+feature\/notes$/m,
    );
  });

  it("refuses to switch branches while there are uncommitted changes, before and after approval", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await run("git_create_branch", { name: "other" });
    await writeFile(join(root, "note.txt"), "changed\n", "utf8");

    expect(
      await automation.inspect("git_switch_branch", { name: "other" }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("uncommitted"),
    });

    // Changes made after the switch was approved are refused too.
    await run("git_stash", { action: "save" });
    expect(
      await automation.inspect("git_switch_branch", { name: "other" }),
    ).toMatchObject({ ok: true });
    await writeFile(join(root, "note.txt"), "changed again\n", "utf8");
    const refused = await run("git_switch_branch", { name: "other" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("uncommitted");
    expect((await run("git_branch", {})).text).toMatch(/^\*\s+(main|master)$/m);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe(
      "changed again\n",
    );
  });

  it("refuses a branch name git would take for an option or does not allow, and a branch that is not there", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });

    for (const name of ["-D", "two words", "ends.lock", "a..b", ""])
      for (const tool of ["git_create_branch", "git_switch_branch"])
        expect(
          await automation.inspect(tool, { name }),
          `${tool} ${name}`,
        ).toMatchObject({ ok: false, correctable: true });
    const missing = await run("git_switch_branch", { name: "nowhere" });
    expect(missing.isError).toBe(true);
    expect((await run("git_branch", {})).text).not.toContain("nowhere");
  });

  it("refuses a name git reads as another branch, so the approval names the branch it switches to", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await gitOutput(root, ["switch", "-c", "elsewhere"]);
    await gitOutput(root, ["switch", "-"]);

    for (const name of ["@{-1}", "@{-1}x", "@"])
      for (const tool of ["git_create_branch", "git_switch_branch"])
        expect(
          await automation.inspect(tool, { name }),
          `${tool} ${name}`,
        ).toMatchObject({ ok: false, correctable: true });
    const switched = await run("git_switch_branch", { name: "@{-1}" });

    expect(switched.isError).toBe(true);
    expect((await run("git_branch", {})).text).toMatch(/^\*\s+(main|master)$/m);
  });

  it("refuses to switch to a branch that would replace a file of the person's that git ignores here, before and after approval", async () => {
    await writeFile(join(root, ".gitignore"), ".env\n", "utf8");
    await run("git_stage", { paths: [".gitignore"] });
    await run("git_commit", { message: "Ignore settings" });
    await gitOutput(root, ["switch", "-c", "other"]);
    await writeFile(join(root, ".env"), "FROM_BRANCH=1\n", "utf8");
    await gitOutput(root, ["add", "-f", ".env"]);
    await gitOutput(root, ["commit", "-m", "Track settings"]);
    await gitOutput(root, ["switch", "-"]);
    await writeFile(join(root, ".env"), "MY_SECRET=keep-me\n", "utf8");

    expect(
      await automation.inspect("git_switch_branch", { name: "other" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining(".env") });
    const refused = await run("git_switch_branch", { name: "other" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(".env");
    expect(await readFile(join(root, ".env"), "utf8")).toBe(
      "MY_SECRET=keep-me\n",
    );
    expect((await run("git_branch", {})).text).toMatch(/^\*\s+(main|master)$/m);

    // Moved away, the switch goes ahead.
    await rm(join(root, ".env"));
    expect(
      (await run("git_switch_branch", { name: "other" })).isError,
    ).toBeFalsy();
  });

  it("refuses a switch that would put a folder where a file or a link of the person's is", async () => {
    await writeFile(join(root, ".gitignore"), "build\nlink\n", "utf8");
    await run("git_stage", { paths: [".gitignore"] });
    await run("git_commit", { message: "Ignore output" });
    await gitOutput(root, ["switch", "-c", "other"]);
    await mkdir(join(root, "build"));
    await writeFile(join(root, "build", "out.txt"), "built\n", "utf8");
    await mkdir(join(root, "link"));
    await writeFile(join(root, "link", "x.txt"), "x\n", "utf8");
    await gitOutput(root, ["add", "-f", "build/out.txt", "link/x.txt"]);
    await gitOutput(root, ["commit", "-m", "Track output"]);
    await gitOutput(root, ["switch", "-"]);

    // A file where the branch has a folder.
    await writeFile(join(root, "build"), "MY_SECRET\n", "utf8");
    const file = await automation.inspect("git_switch_branch", {
      name: "other",
    });
    expect(file).toMatchObject({
      ok: false,
      reason: expect.stringContaining("build"),
    });
    await rm(join(root, "build"));

    // A folder of the person's files where the branch has a file.
    await mkdir(join(root, "build", "out.txt"), { recursive: true });
    await writeFile(join(root, "build", "out.txt", "mine.txt"), "mine\n");
    expect(
      await automation.inspect("git_switch_branch", { name: "other" }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("build/out.txt"),
    });
    await rm(join(root, "build"), { recursive: true });

    // A link to a folder outside, where the branch has a folder.
    const outside = await folders.make("zhiyin-git-connector-");
    await symlink(outside, join(root, "link"), "junction");
    const linked = await run("git_switch_branch", { name: "other" });
    expect(linked.isError).toBe(true);
    expect(linked.text).toContain("link");
    expect(await readdir(outside)).toEqual([]);
  });

  it("looks at the whole repository for what a switch would replace, whatever the repository's diff settings", async () => {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, ".gitignore"), ".env\n", "utf8");
    await writeFile(join(root, "sub", "note.txt"), "hello\n", "utf8");
    await gitOutput(root, ["add", ".gitignore", "sub/note.txt"]);
    await gitOutput(root, ["commit", "-m", "Start"]);
    await gitOutput(root, ["switch", "-c", "other"]);
    await writeFile(join(root, ".env"), "BRANCH\n", "utf8");
    await gitOutput(root, ["add", "-f", ".env"]);
    await gitOutput(root, ["commit", "-m", "Track settings"]);
    await gitOutput(root, ["switch", "-"]);
    await writeFile(join(root, ".env"), "MY_SECRET\n", "utf8");
    await gitOutput(root, ["config", "diff.relative", "true"]);
    const inSub = gitAutomation({ workspaceRoot: () => join(root, "sub") });

    expect(
      await inSub.inspect("git_switch_branch", { name: "other" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining(".env") });
  });

  it("switches where the branch makes a folder of tracked files into a file, and from a branch with no commits yet", async () => {
    await mkdir(join(root, "d"));
    await writeFile(join(root, "d", "x.txt"), "x\n", "utf8");
    await gitOutput(root, ["add", "d/x.txt"]);
    await gitOutput(root, ["commit", "-m", "Folder"]);
    await gitOutput(root, ["switch", "-c", "flat"]);
    await gitOutput(root, ["rm", "-r", "-q", "d"]);
    await writeFile(join(root, "d"), "now a file\n", "utf8");
    await gitOutput(root, ["add", "d"]);
    await gitOutput(root, ["commit", "-m", "File"]);
    await gitOutput(root, ["switch", "-"]);

    expect(
      (await run("git_switch_branch", { name: "flat" })).isError,
    ).toBeFalsy();
    expect(await readFile(join(root, "d"), "utf8")).toMatch(
      /^now a file\r?\n$/,
    );

    await gitOutput(root, ["switch", "--orphan", "fresh"]);
    expect(
      (await run("git_switch_branch", { name: "flat" })).isError,
    ).toBeFalsy();
    expect((await run("git_branch", {})).text).toMatch(/^\*\s+flat$/m);
  });

  it("switches only to a local branch, never making one from a remote's", async () => {
    const upstream = await folders.make("zhiyin-git-connector-");
    await execGitInit(git as string, upstream);
    await writeFile(join(upstream, "note.txt"), "hello\n", "utf8");
    await gitOutput(upstream, ["add", "note.txt"]);
    await gitOutput(upstream, ["commit", "-m", "Add note"]);
    await gitOutput(upstream, ["branch", "topic"]);
    await gitOutput(root, ["remote", "add", "origin", upstream]);
    await gitOutput(root, ["fetch", "origin"]);
    await gitOutput(root, ["switch", "-c", "work", "origin/topic"]);

    const switched = await run("git_switch_branch", { name: "topic" });

    expect(switched.isError).toBe(true);
    expect((await run("git_branch", {})).text).toMatch(/^\*\s+work$/m);
    expect((await run("git_branch", {})).text).not.toMatch(/^\s+topic$/m);
  });
});
