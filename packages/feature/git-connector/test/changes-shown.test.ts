/**
 * Changes and history read from a real repository: diffs, commits and logs,
 * narrowed to the paths, base or counts asked for, and the flags refused in
 * what a call names.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { gitAutomation } from "../src/index.js";
import { execGitInit, git, withGit } from "./real-git.js";

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

  it("shows a commit's diff and refuses a flag in every ref path", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });

    const show = await run("git_show", { ref: "HEAD" });
    expect(show.text).toContain("note.txt");

    const refusedInspection = await automation.inspect("git_show", {
      ref: "--upload-pack=evil",
    });
    expect(refusedInspection).toMatchObject({
      ok: false,
      reason: "Name a real commit, branch, or tag to show.",
    });

    const refusedExecution = await run("git_show", {
      ref: "--upload-pack=evil",
    });
    expect(refusedExecution.isError).toBe(true);
  });

  it("shows unstaged changes with git_diff", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await writeFile(join(root, "note.txt"), "hello again\n", "utf8");

    const diff = await run("git_diff", {});
    expect(diff.text).toContain("note.txt");

    const staged = await run("git_diff", { staged: true });
    expect(staged.text).not.toContain("note.txt");
  });

  it("shows a long diff whole, for the conversation to size as any answer", async () => {
    const before = Array.from({ length: 400 }, (_, n) => `row ${n}`);
    await writeFile(join(root, "a.txt"), `${before.join("\n")}\n`, "utf8");
    await writeFile(join(root, "b.txt"), "first\n", "utf8");
    await run("git_stage", { paths: ["a.txt", "b.txt"] });
    await run("git_commit", { message: "Add files" });
    const after = before.map((line) => `${line} changed`);
    await writeFile(join(root, "a.txt"), `${after.join("\n")}\n`, "utf8");
    await writeFile(join(root, "b.txt"), "second\n", "utf8");

    const diff = await run("git_diff", {});

    expect(diff.text.length).toBeGreaterThan(8_000);
    expect(diff.text).toContain("+row 399 changed");
    expect(diff.text).toContain("+second");
  });

  async function twoCommittedFiles(): Promise<void> {
    await writeFile(join(root, "a.txt"), "one\n", "utf8");
    await writeFile(join(root, "b.txt"), "one\n", "utf8");
    await run("git_stage", { paths: ["a.txt", "b.txt"] });
    await run("git_commit", { message: "Add files" });
  }

  it("shows the changes of the paths named, and no others", async () => {
    await twoCommittedFiles();
    await writeFile(join(root, "a.txt"), "two\n", "utf8");
    await writeFile(join(root, "b.txt"), "two\n", "utf8");

    const diff = await run("git_diff", { paths: ["a.txt"] });

    expect(diff.text).toContain("a.txt");
    expect(diff.text).not.toContain("b.txt");
    await expect(
      automation.inspect("git_diff", { paths: ["a.txt"] }),
    ).resolves.toMatchObject({ ok: true, command: "git diff -- a.txt" });
  });

  it("shows how many lines each file changed, without the changes, when stat is asked", async () => {
    await twoCommittedFiles();
    await writeFile(join(root, "a.txt"), "two\nthree\n", "utf8");

    const diff = await run("git_diff", { stat: true });

    // One line taken away, two added.
    expect(diff.text).toMatch(/a\.txt \| 3 \+\+-/);
    expect(diff.text).toContain("1 file changed");
    expect(diff.text).not.toContain("+three");
  });

  it("shows every change since the commit given as base, committed or not", async () => {
    await twoCommittedFiles();
    const base = (await run("git_log", { limit: 1 })).text.split(" ")[0]!;
    await writeFile(join(root, "a.txt"), "committed\n", "utf8");
    await run("git_stage", { paths: ["a.txt"] });
    await run("git_commit", { message: "Change a" });
    await writeFile(join(root, "b.txt"), "not committed\n", "utf8");

    const diff = await run("git_diff", { base });

    expect(diff.text).toContain("+committed");
    expect(diff.text).toContain("+not committed");
    await expect(
      automation.inspect("git_diff", { base, stat: true }),
    ).resolves.toMatchObject({
      ok: true,
      action: `Show the changes since ${base}`,
      command: `git diff --stat ${base}`,
    });
  });

  it("names the new files git does not track yet, which no diff shows", async () => {
    await twoCommittedFiles();
    await writeFile(join(root, "a.txt"), "two\n", "utf8");
    await writeFile(join(root, "fresh.txt"), "new\n", "utf8");
    await writeFile(join(root, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(root, "ignored.txt"), "ignored\n", "utf8");

    const diff = await run("git_diff", {});

    expect(diff.text).toContain("+two");
    expect(diff.text).toContain(
      "2 new files git does not track yet, so not in the diff: .gitignore, fresh.txt",
    );
    expect(diff.text).not.toContain("ignored.txt\n");
    const staged = await run("git_diff", { staged: true });
    expect(staged.text).not.toContain("fresh.txt");
  });

  it("names new files even when tracked files have not changed", async () => {
    await twoCommittedFiles();
    await writeFile(join(root, "fresh.txt"), "new\n", "utf8");

    const diff = await run("git_diff", {});

    expect(diff.text).toBe(
      "No changes to tracked files.\n1 new file git does not track yet, so not in the diff: fresh.txt",
    );
  });

  it("refuses a flag in a diff's base or paths, saying which", async () => {
    for (const [args, reason] of [
      [{ base: "--output=x" }, /as base\.$/],
      [{ paths: ["--output=x"] }, /^Name the paths/],
    ] as const) {
      await expect(automation.inspect("git_diff", args)).resolves.toMatchObject(
        { ok: false, reason: expect.stringMatching(reason) },
      );
      expect((await run("git_diff", args)).isError).toBe(true);
    }
  });

  it("shows only the commits that changed the paths named", async () => {
    await twoCommittedFiles();
    await writeFile(join(root, "b.txt"), "two\n", "utf8");
    await run("git_stage", { paths: ["b.txt"] });
    await run("git_commit", { message: "Change b only" });

    const log = await run("git_log", { paths: ["a.txt"] });

    expect(log.text).toContain("Add files");
    expect(log.text).not.toContain("Change b only");
    await expect(
      automation.inspect("git_log", { limit: 5, paths: ["a.txt"] }),
    ).resolves.toMatchObject({ ok: true, command: "git log -n 5 -- a.txt" });
    await expect(
      automation.inspect("git_log", { paths: ["-p"] }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^Name the paths/),
    });
  });

  it("shows a commit's line counts, or its changes to the paths named", async () => {
    await twoCommittedFiles();

    const stat = await run("git_show", { ref: "HEAD", stat: true });
    expect(stat.text).toContain("Add files");
    expect(stat.text).toContain("2 files changed");
    expect(stat.text).not.toContain("+one");

    const one = await run("git_show", { ref: "HEAD", paths: ["b.txt"] });
    expect(one.text).toContain("b.txt");
    expect(one.text).not.toContain("a.txt");
    await expect(
      automation.inspect("git_show", { ref: "HEAD", paths: ["b.txt"] }),
    ).resolves.toMatchObject({ ok: true, command: "git show HEAD -- b.txt" });
  });
});
