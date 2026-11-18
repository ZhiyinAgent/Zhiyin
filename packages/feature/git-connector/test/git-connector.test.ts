import {
  appendFile,
  mkdir,
  rm,
  symlink,
  readdir,
  readFile,
  realpath,
  utimes,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { gitAutomation, resolveGit } from "../src/index.js";
import { leftUncommitted } from "../src/resulting-state.js";
import { endings, readGit } from "../src/run-git.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const emptyEnvironment: NodeJS.ProcessEnv = { PATH: "" };

describe("resolveGit", () => {
  it("is found when a real executable is configured", () => {
    expect(
      resolveGit({ ...emptyEnvironment, ZHIYIN_GIT: process.execPath }),
    ).toBe(process.execPath);
  });

  it("is undefined when nothing is found", () => {
    expect(resolveGit(emptyEnvironment)).toBeUndefined();
  });
});

describe("gitAutomation without a workspace folder", () => {
  const automation = gitAutomation({
    workspaceRoot: () => undefined,
    resolveGit: () => process.execPath,
  });

  it("refuses to inspect or run a tool", async () => {
    await expect(automation.inspect("git_status", {})).resolves.toMatchObject({
      ok: false,
      reason: "Choose a folder before using git.",
    });
    const result = (await automation.callTool("git_status", {})) as {
      isError?: boolean;
      content: readonly { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Choose a folder before using git.");
  });
});

describe("gitAutomation with a git whose version it cannot trust", () => {
  it("reads nothing with a program that does not say it is git 2.31 or newer", async () => {
    const root = await folders.make("zhiyin-git-old-");
    // Node answers --version with its own version, not git's.
    const automation = gitAutomation({
      workspaceRoot: () => root,
      resolveGit: () => process.execPath,
    });

    const result = (await automation.callTool("git_status", {})) as {
      isError?: boolean;
      content: readonly { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Git 2.31 or newer");
  });
});

describe("what git answered", () => {
  it("is shown under words a person reads, not the tool's name", () => {
    const automation = gitAutomation({
      workspaceRoot: () => "C:/somewhere",
      resolveGit: () => undefined,
    });

    expect(
      automation.describeResult?.(
        "git_status",
        {},
        {
          ok: true,
          value: { content: [{ type: "text", text: "## main" }] },
        },
      ),
    ).toEqual([{ kind: "text", label: "What git answered", text: "## main" }]);
  });
});

describe("the limits of a git command", () => {
  it("are stated in every git tool's description", async () => {
    const automation = gitAutomation({
      workspaceRoot: () => "C:/somewhere",
      resolveGit: () => process.execPath,
    });

    for (const tool of await automation.listTools())
      expect(tool.description).toContain(
        "Each git command may run for 30 seconds and print 64 MB.",
      );
  });

  it("are named, with what to do instead, when git is stopped at one", () => {
    expect(endings.timeout).toBe(
      "The git command took longer than 30 seconds, the most one may take, and was stopped. Ask for less, such as fewer commits or fewer paths.",
    );
    expect(endings.outputLimit).toBe(
      "The git command printed more than 64 MB, the most one may print, and was stopped. Ask for less, such as fewer commits or fewer paths.",
    );
  });
});

describe("what is left uncommitted", () => {
  it("names untracked folders without their files when git cannot count them in 3 seconds", async () => {
    vi.useFakeTimers();
    try {
      // git lists one loose file and two folders, and never finishes listing
      // the files in them until it is stopped.
      const read = (args: readonly string[], signal?: AbortSignal) =>
        args[0] === "status"
          ? Promise.resolve("?? loose.txt\0?? out/\0?? build/\0")
          : new Promise<string | undefined>((settle) =>
              signal?.addEventListener("abort", () => settle(undefined)),
            );

      const left = leftUncommitted(read);
      await vi.advanceTimersByTimeAsync(2_999);
      const early = await Promise.race([left, Promise.resolve("waiting")]);
      await vi.advanceTimersByTimeAsync(1);

      expect(early).toBe("waiting");
      expect(await left).toBe(
        "Not committed: 1 untracked file, 2 untracked folders (files not counted).",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("gitAutomation without git installed", () => {
  const automation = gitAutomation({
    workspaceRoot: () => "C:/somewhere",
    resolveGit: () => undefined,
  });

  it("refuses to list tools, inspect, or run one", async () => {
    await expect(automation.listTools()).rejects.toThrow(/no git was found/i);
    await expect(automation.inspect("git_status", {})).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no git was found/i),
    });
    const result = (await automation.callTool("git_status", {})) as {
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
  });
});

const git = resolveGit();
const withGit = git ? describe : describe.skip;

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

  it("works on the repository in the folder it reads at each call", async () => {
    const other = await folders.make("zhiyin-git-connector-");
    await execGitInit(git as string, other);
    await writeFile(join(root, "first.txt"), "first");
    await writeFile(join(other, "second.txt"), "second");

    const inFirst = await run("git_status", {});
    root = other;
    const inSecond = await run("git_status", {});

    expect(inFirst.text).toContain("first.txt");
    expect(inFirst.text).not.toContain("second.txt");
    expect(inSecond.text).toContain("second.txt");
    expect(inSecond.text).not.toContain("first.txt");
  });

  it("ties what a call was allowed for to the folder it was allowed in, so another folder is asked about again", async () => {
    const other = await folders.make("zhiyin-git-connector-");
    await execGitInit(git as string, other);
    await writeFile(join(other, "theirs.txt"), "theirs");

    const here = await automation.inspect("git_status", {});
    const sameFolder = await automation.inspect("git_status", {});
    root = other;
    const there = await automation.inspect("git_status", {});

    expect(here).toMatchObject({ ok: true, identity: expect.any(String) });
    expect(sameFolder).toMatchObject({
      identity: (here as { identity: string }).identity,
    });
    expect(there).toMatchObject({ ok: true, identity: expect.any(String) });
    expect((there as { identity: string }).identity).not.toBe(
      (here as { identity: string }).identity,
    );
    // Allowed in the first folder, the call does not run in the second.
    const refused = (await automation.callTool(
      "git_status",
      {},
      undefined,
      (here as { identity: string }).identity,
    )) as { isError?: boolean; content: { text: string }[] };
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("folder");
    expect(refused.content[0]!.text).not.toContain("theirs.txt");
    const allowed = (await automation.callTool(
      "git_status",
      {},
      undefined,
      (there as { identity: string }).identity,
    )) as { isError?: boolean; content: { text: string }[] };
    expect(allowed.content[0]!.text).toContain("theirs.txt");
  });

  it("lists all ten tools", async () => {
    expect((await automation.listTools()).map((tool) => tool.name)).toEqual([
      "git_status",
      "git_diff",
      "git_log",
      "git_show",
      "git_branch",
      "git_stage",
      "git_commit",
      "git_stash",
      "git_create_branch",
      "git_switch_branch",
    ]);
  });

  it("names each tool for the person while a call to it is written", async () => {
    expect(
      Object.fromEntries(
        (await automation.listTools()).map((tool) => [tool.name, tool.label]),
      ),
    ).toEqual({
      git_status: "Check the status of the git repository",
      git_diff: "Show the changes",
      git_log: "Show commits",
      git_show: "Show a commit",
      git_branch: "List branches",
      git_stage: "Stage changes",
      git_commit: "Commit the staged changes",
      git_stash: "Stash changes",
      git_create_branch: "Create a branch",
      git_switch_branch: "Switch branches",
    });
  });

  it("says which of its tools only read, so a specialist that only reads can use them", async () => {
    expect(
      Object.fromEntries(
        (await automation.listTools()).map((tool) => [tool.name, tool.access]),
      ),
    ).toEqual({
      git_status: "read",
      git_diff: "read",
      git_log: "read",
      git_show: "read",
      git_branch: "read",
      git_stage: undefined,
      git_commit: undefined,
      git_stash: undefined,
      git_create_branch: undefined,
      git_switch_branch: undefined,
    });
  });

  it("stages, commits, and reads back what it committed", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    const status = await run("git_status", {});
    expect(status.text).toContain("note.txt");

    const stage = await run("git_stage", { paths: ["note.txt"] });
    expect(stage.isError).toBeFalsy();

    const preview = await automation.inspect("git_commit", {
      message: "Add note",
    });
    expect(preview).toMatchObject({
      ok: true,
      action: "Commit the staged changes",
      // A commit runs the repository's own hooks with the account's full
      // access, so it is asked about every time.
      asksEachTime: true,
    });
    if (preview.ok) expect(preview.detail).toContain("note.txt");

    const commit = await run("git_commit", { message: "Add note" });
    expect(commit.isError).toBeFalsy();

    const log = await run("git_log", { limit: 5 });
    expect(log.text).toContain("Add note");
  });

  it("says staging takes paths, where a folder or pattern adds everything under it", async () => {
    expect(
      await automation.inspect("git_stage", { paths: ["."] }),
    ).toMatchObject({
      ok: true,
      action: "Stage 1 path",
      target: ".",
      detail:
        "Adds the current content of . to what the next commit will include. A folder or pattern adds every file under it, apart from new files git ignores. Nothing is committed yet.",
    });
    expect(
      await automation.inspect("git_stage", { paths: ["src", "*.md"] }),
    ).toMatchObject({ ok: true, action: "Stage 2 paths" });
  });

  it("shows the person each call's inputs in words, then the git command it runs, a value with a space or a quote quoted", async () => {
    const shown = async (tool: string, args: Record<string, unknown>) => {
      const inspection = await automation.inspect(tool, args);
      return inspection.ok ? inspection.invocation : inspection;
    };

    expect(
      await shown("git_stage", { paths: ["src/a b.ts", "README.md"] }),
    ).toEqual({
      name: "Stage 2 paths",
      arguments: [
        { name: "Files", value: "src/a b.ts, README.md", readable: true },
        {
          name: "Command",
          value: 'git add -- "src/a b.ts" README.md',
          runs: true,
        },
      ],
    });
    expect(
      await shown("git_commit", {
        message: 'Fix the "date" bug\n\nIt slipped.',
      }),
    ).toEqual({
      name: "Commit the staged changes",
      arguments: [
        {
          name: "Message",
          value: 'Fix the "date" bug\n\nIt slipped.',
          readable: true,
        },
        {
          name: "Command",
          value: 'git commit -m "Fix the \\"date\\" bug\n\nIt slipped."',
          runs: true,
        },
      ],
    });
    expect(await shown("git_status", {})).toEqual({
      name: "Check the status of the git repository",
      arguments: [{ name: "Command", value: "git status", runs: true }],
    });
  });

  it("says a commit's hooks run with it and can change it, where the repository has them", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    const stat = await gitOutput(root, ["diff", "--staged", "--stat"]);

    const without = await automation.inspect("git_commit", {
      message: "Add note",
    });
    await writeFile(
      join(root, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    const withHook = await automation.inspect("git_commit", {
      message: "Add note",
    });
    // Where husky keeps them: hooks follow core.hooksPath.
    await mkdir(join(root, ".husky"));
    await writeFile(join(root, ".husky", "commit-msg"), "#!/bin/sh\n", "utf8");
    await gitOutput(root, ["config", "core.hooksPath", ".husky"]);
    const moved = await automation.inspect("git_commit", {
      message: "Add note",
    });

    expect(without).toMatchObject({
      ok: true,
      detail: `Commits what is staged:\n${stat}`,
    });
    expect(withHook).toMatchObject({
      ok: true,
      detail: `Commits what is staged:\n${stat}\n\nIts commit hooks (pre-commit) run with it, with your account's full access, and can change what is committed.`,
    });
    expect(moved).toMatchObject({
      ok: true,
      detail: expect.stringContaining(
        "Its commit hooks (commit-msg) run with it",
      ),
    });

    // Named in settings, as Git 2.54 and later run them, and as Git for
    // Windows finds a program.
    await gitOutput(root, ["config", "hook.lint.event", "pre-commit"]);
    await writeFile(join(root, ".husky", "post-commit.exe"), "", "utf8");
    expect(
      await automation.inspect("git_commit", { message: "Add note" }),
    ).toMatchObject({
      ok: true,
      detail: expect.stringContaining(
        "Its commit hooks (pre-commit, commit-msg, post-commit) run with it",
      ),
    });

    // A hooks folder on another computer is not looked at before approval.
    await gitOutput(root, [
      "config",
      "core.hooksPath",
      "//nowhere.invalid/hooks",
    ]);
    await gitOutput(root, ["config", "--unset", "hook.lint.event"]);
    expect(
      await automation.inspect("git_commit", { message: "Add note" }),
    ).toMatchObject({
      ok: true,
      detail: expect.stringContaining("Any commit hooks it has run with it"),
    });
  });

  it("names the commit hooks even when nothing is staged, since git runs them before it refuses", async () => {
    await writeFile(
      join(root, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );

    expect(
      await automation.inspect("git_commit", { message: "Nothing yet" }),
    ).toMatchObject({
      ok: true,
      detail:
        "Nothing is staged. This commit would be empty and git will refuse it.\n\nIts commit hooks (pre-commit) run with it, with your account's full access, and can change what is committed.",
    });
  });

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

  it("answers a staging with what it changed in what is staged, and a staging that changed nothing as an error", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await writeFile(join(root, "other.txt"), "other\n", "utf8");

    const staged = await run("git_stage", { paths: ["note.txt"] });
    const again = await run("git_stage", { paths: ["note.txt"] });

    expect(staged.isError).toBeFalsy();
    expect(staged.text).toMatch(
      /^Staged 1 file: note\.txt\.\nStaged now, for the next commit:\n note\.txt \| 1 \+\n 1 file changed, 1 insertion\(\+\)$/,
    );
    expect(again).toEqual({
      isError: true,
      text: "Staging changed nothing: what is staged for note.txt already matches the files.",
    });
  });

  it("answers a commit with the commit made and what is left uncommitted", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await writeFile(join(root, "left.txt"), "left\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });

    const commit = await run("git_commit", { message: "Add note" });

    expect(commit.isError).toBeFalsy();
    expect(commit.text).toMatch(
      /^\[\S+ \(root-commit\) [0-9a-f]+\] Add note\n/,
    );
    expect(commit.text).toMatch(
      /\nNow on \S+ at [0-9a-f]{7,} Add note\. Not committed: 1 untracked file\.$/,
    );
  });

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

  it("counts an untracked folder as a folder, with the files it holds", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await writeFile(join(root, "loose.txt"), "loose\n", "utf8");
    await mkdir(join(root, "out", "deep"), { recursive: true });
    for (const name of ["a", "b", "c", "d"])
      await writeFile(join(root, "out", `${name}.txt`), name, "utf8");
    await writeFile(join(root, "out", "deep", "e.txt"), "e", "utf8");
    await run("git_stage", { paths: ["note.txt"] });

    const commit = await run("git_commit", { message: "Add note" });

    expect(commit.text).toMatch(
      /\. Not committed: 1 untracked file, 1 untracked folder \(5 files\)\.$/,
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

  it("reports the current branch after a commit", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });

    const branch = await run("git_branch", {});
    expect(branch.isError).toBeFalsy();
    expect(branch.text).toMatch(/^\*\s+\S+/m);
  });

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

  it("refuses a flag in every staging path", async () => {
    const refusedInspection = await automation.inspect("git_stage", {
      paths: ["--all"],
    });
    expect(refusedInspection).toMatchObject({
      ok: false,
      reason: "Name one or more real paths to stage.",
    });
    // Staging runs the repository's own filters, so it is asked every time.
    expect(
      await automation.inspect("git_stage", { paths: ["note.txt"] }),
    ).toMatchObject({ ok: true, asksEachTime: true });

    const refusedExecution = await run("git_stage", { paths: ["--all"] });
    expect(refusedExecution.isError).toBe(true);
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

  it("declares that each call in the workspace's own repository reads it, and that each change runs the repository's programs and cannot be put back", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await run("git_create_branch", { name: "feature" });

    const reads = {
      reads: "workspace",
      changes: "none",
      sends: "none",
      actsAsPerson: "none",
      runs: "none",
      lasting: false,
      brings: "none",
    };
    const changes = {
      reads: "workspace",
      changes: "workspace-for-good",
      sends: "none",
      actsAsPerson: "none",
      runs: "full-access",
      lasting: false,
      brings: "none",
    };
    const calls: readonly (readonly [
      string,
      Record<string, unknown>,
      object,
    ])[] = [
      ["git_status", {}, reads],
      ["git_diff", {}, reads],
      ["git_diff", { staged: true }, reads],
      ["git_log", { limit: 3 }, reads],
      ["git_show", { ref: "HEAD" }, reads],
      ["git_branch", {}, reads],
      ["git_stash", { action: "list" }, reads],
      ["git_stage", { paths: ["note.txt"] }, changes],
      ["git_commit", { message: "Another" }, changes],
      ["git_stash", { action: "save" }, changes],
      ["git_stash", { action: "pop" }, changes],
      ["git_create_branch", { name: "other" }, changes],
      ["git_switch_branch", { name: "feature" }, changes],
    ];
    for (const [name, args, effects] of calls) {
      const inspection = await automation.inspect(name, args);
      expect(
        inspection.ok && inspection.effects,
        `${name} ${JSON.stringify(args)}`,
      ).toEqual(effects);
    }
  });

  it("says a git command was stopped, not that git reported an error", async () => {
    const stopped = new AbortController();
    stopped.abort();

    const result = (await automation.callTool(
      "git_status",
      {},
      stopped.signal,
    )) as { isError?: boolean; content: readonly { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "The git command was stopped before it finished.",
    );
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

  it("commits in the workspace's repository when Zhiyin inherited variables naming another", async () => {
    // As a terminal, or a git hook, that started Zhiyin would have left them.
    const elsewhere = await folders.make("zhiyin-git-elsewhere-");
    await execGitInit(git as string, elsewhere);
    process.env.GIT_DIR = join(elsewhere, ".git");
    process.env.GIT_INDEX_FILE = join(elsewhere, ".git", "other-index");
    process.env.GIT_WORK_TREE = elsewhere;

    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    expect(
      (await run("git_stage", { paths: ["note.txt"] })).isError,
    ).toBeFalsy();
    expect(
      (await run("git_commit", { message: "Add note" })).isError,
    ).toBeFalsy();

    expect(await gitOutput(root, ["log", "--format=%s"])).toBe("Add note");
    expect(await gitOutput(elsewhere, ["rev-list", "--all"])).toBe("");
  });

  /**
   * A repository's own settings can name programs for git to run: a file
   * monitor, an outside diff tool, a converter for diffs, a filter. A folder
   * that arrives with its `.git` in it, from an archive or a shared drive,
   * brings them along. Reading the repository runs none of them.
   */
  it("runs no program the repository's settings name when it is only read", async () => {
    const ran = join(root, "ran");
    const marking = (name: string) =>
      `touch '${join(ran, name).replaceAll("\\", "/")}';`;
    await mkdir(ran);
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await writeFile(join(root, "other.txt"), "staged\n", "utf8");
    await run("git_stage", { paths: ["other.txt"] });
    await writeFile(
      join(root, ".git", "info", "attributes"),
      "*.txt diff=planted filter=planted\n",
      "utf8",
    );
    for (const [key, value] of [
      ["core.fsmonitor", `${marking("fsmonitor")} true`],
      ["diff.external", `${marking("external")} true`],
      ["diff.planted.textconv", `${marking("textconv")} cat`],
      ["filter.planted.clean", `${marking("clean")} cat`],
      ["filter.planted.smudge", `${marking("smudge")} cat`],
      ["filter.planted.process", `${marking("process")} true`],
      ["log.showSignature", "true"],
      ["gpg.program", `${marking("gpg")} true`],
    ])
      await gitOutput(root, ["config", key as string, value as string]);
    await writeFile(join(root, "note.txt"), "hello again\n", "utf8");

    const failed: string[] = [];
    for (const [name, args] of [
      ["git_status", {}],
      ["git_diff", {}],
      ["git_diff", { staged: true }],
      ["git_log", { limit: 5 }],
      ["git_show", { ref: "HEAD" }],
      ["git_branch", {}],
      ["git_stash", { action: "list" }],
    ] as const) {
      const result = await run(name, args);
      if (result.isError) failed.push(`${name}: ${result.text}`);
    }
    await automation.inspect("git_commit", { message: "Add other" });

    expect(failed).toEqual([]);
    expect(await readdir(ran)).toEqual([]);

    // The same read, run as git runs it by default, does start them.
    await gitOutput(root, ["diff"]).catch(() => "");
    expect(await readdir(ran)).toEqual(
      expect.arrayContaining(["fsmonitor", "process"]),
    );
  });

  it("reads back what a change left without running a filter the change itself set up", async () => {
    const ran = await folders.make("zhiyin-git-ran-");
    // The repository's own hook names a filter once the commit is made, and
    // touches a committed file without changing it, so the next status has
    // to read that file through the filter.
    await writeFile(
      join(root, ".git", "hooks", "post-commit"),
      [
        "#!/bin/sh",
        `git config filter.late.clean "touch '${join(ran, "clean").replaceAll("\\", "/")}'; cat"`,
        'mkdir -p "$(git rev-parse --git-dir)/info"',
        'echo "*.txt filter=late" > "$(git rev-parse --git-dir)/info/attributes"',
        'touch -d "1 hour ago" note.txt',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });

    const commit = await run("git_commit", { message: "Add note" });

    expect(commit.isError).toBeFalsy();
    expect(commit.text).toMatch(/Nothing is left uncommitted\.$/);
    expect(await readdir(ran)).toEqual([]);

    // The same status, run as git runs it by default, runs the filter.
    await gitOutput(root, ["status"]);
    expect(await readdir(ran)).toEqual(["clean"]);
  });

  it.each([
    ["its settings", []],
    ["the settings of its work tree", ["--worktree"]],
  ] as const)(
    "runs no hook the repository defines in %s when it is only read",
    async (_where, scope) => {
      const ran = await folders.make("zhiyin-git-ran-");
      await writeFile(join(root, "same.txt"), "hello\n", "utf8");
      await run("git_stage", { paths: ["same.txt"] });
      await run("git_commit", { message: "Add same" });
      if (scope.length)
        await gitOutput(root, ["config", "extensions.worktreeConfig", "true"]);
      // Git 2.54 and later run a hook named in settings, wherever hooks are
      // looked for; writing the index runs this one.
      await gitOutput(root, [
        "config",
        ...scope,
        "hook.planted.event",
        "post-index-change",
      ]);
      await gitOutput(root, [
        "config",
        ...scope,
        "hook.planted.command",
        `touch '${join(ran, "hook").replaceAll("\\", "/")}'`,
      ]);
      // Touched without a change, so a diff writes the index again.
      const touch = async (hoursAgo: number) => {
        const then = new Date(Date.now() - hoursAgo * 3_600_000);
        await utimes(join(root, "same.txt"), then, then);
      };
      await touch(1);

      for (const [name, args] of [
        ["git_status", {}],
        ["git_diff", {}],
        ["git_diff", { staged: true }],
      ] as const)
        await run(name, args);

      expect(await readdir(ran)).toEqual([]);

      // The same read, run as git runs it by default, runs the hook where git
      // knows such hooks.
      await touch(2);
      await gitOutput(root, ["diff"]);
      const [major, minor] = (await gitOutput(root, ["--version"]))
        .replace(/^git version /, "")
        .split(".")
        .map(Number);
      const knowsSuchHooks = major! > 2 || (major === 2 && minor! >= 54);
      expect(await readdir(ran)).toEqual(knowsSuchHooks ? ["hook"] : []);
    },
  );

  it("starts no transport the repository's own settings allow when it is only read", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    const clone = join(await folders.make("zhiyin-git-clone-"), "clone");
    await gitOutput(root, [
      "clone",
      "--no-local",
      `file:///${root.replaceAll("\\", "/")}`,
      clone,
    ]);
    // A repository can allow a transport for itself, as partial clones
    // fetching what they miss through a program would need.
    await gitOutput(clone, ["config", "protocol.file.allow", "always"]);

    const listed = await readGit(git as string, clone, ["ls-remote", "origin"]);

    expect(listed.exitCode).not.toBe(0);
    // Run as git runs it by default, it reaches the other repository.
    expect(await gitOutput(clone, ["ls-remote", "origin"])).toContain("HEAD");
  });

  it("reads nothing from a repository whose settings it cannot read whole", async () => {
    // A hook named at such length that the list of settings is shortened.
    await appendFile(
      join(root, ".git", "config"),
      `[hook "${"a".repeat(410_000)}"]\n\tcommand = echo ran\n`,
    );

    const status = await readGit(git as string, root, ["status"]);

    expect(status.exitCode).toBeNull();
    expect(status.stderr).toContain(
      "could not read this repository's settings",
    );
  });

  it("keeps the person's own filters when it reads, so a file they store through one reads as unchanged", async () => {
    // A filter of the person's, as Git LFS is: stored in capitals.
    const global = join(await folders.make("zhiyin-git-global-"), "config");
    await writeFile(global, '[filter "upper"]\n\tclean = tr a-z A-Z\n');
    process.env.GIT_CONFIG_GLOBAL = global;
    await writeFile(join(root, ".gitattributes"), "*.up filter=upper\n");
    await writeFile(join(root, "note.up"), "hello\n");
    await run("git_stage", { paths: [".gitattributes", "note.up"] });
    await run("git_commit", { message: "Add note" });
    // Touched without a change, so git compares it through the filter again.
    const hourAgo = new Date(Date.now() - 3_600_000);
    await utimes(join(root, "note.up"), hourAgo, hourAgo);

    const status = await run("git_status", {});

    expect(status.isError).toBeFalsy();
    expect(status.text).not.toContain("note.up");
  });

  it("fetches nothing a partial clone is missing when it is only read", async () => {
    const ran = await folders.make("zhiyin-git-ran-");
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await gitOutput(root, ["config", "uploadpack.allowFilter", "true"]);
    const clone = join(await folders.make("zhiyin-git-clone-"), "clone");
    await gitOutput(root, [
      "clone",
      "--no-local",
      "--filter=blob:none",
      "--no-checkout",
      `file:///${root.replaceAll("\\", "/")}`,
      clone,
    ]);
    // Fetching a missing file runs the program the clone's settings name.
    await gitOutput(clone, [
      "config",
      "remote.origin.uploadpack",
      `touch '${join(ran, "fetch").replaceAll("\\", "/")}'; git upload-pack`,
    ]);
    const reading = gitAutomation({ workspaceRoot: () => clone });

    for (const [name, args] of [
      ["git_status", {}],
      ["git_diff", { staged: true }],
      ["git_log", { limit: 5 }],
      ["git_show", { ref: "HEAD" }],
    ] as const)
      await reading.callTool(name, args);

    expect(await readdir(ran)).toEqual([]);

    // The same read, run as git runs it by default, fetches the file.
    await gitOutput(clone, ["show", "HEAD"]);
    expect(await readdir(ran)).toEqual(["fetch"]);
  });

  const submodulesUnseen =
    "Changes inside submodules' own files are not shown.";

  it("says that changes inside a submodule's own files are not shown, from any folder of the repository", async () => {
    const sub = await folders.make("zhiyin-git-submodule-");
    await execGitInit(git as string, sub);
    await writeFile(join(sub, "sub.txt"), "a\n", "utf8");
    await gitOutput(sub, ["add", "sub.txt"]);
    await gitOutput(sub, ["commit", "-m", "Sub"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["docs/note.txt"] });
    await run("git_commit", { message: "Add note" });
    await gitOutput(root, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      sub.replaceAll("\\", "/"),
      "sub",
    ]);
    await gitOutput(root, ["commit", "-m", "Add submodule"]);
    await writeFile(join(root, "sub", "sub.txt"), "edited\n", "utf8");
    await writeFile(join(root, "docs", "note.txt"), "changed\n", "utf8");

    const status = await run("git_status", {});
    const diff = await run("git_diff", {});
    const inDocs = (await gitAutomation({
      workspaceRoot: () => join(root, "docs"),
    }).callTool("git_status", {})) as { content: readonly { text: string }[] };

    expect(status.text).toContain("docs/note.txt");
    expect(status.text).toContain(submodulesUnseen);
    expect(diff.text).toContain("changed");
    expect(diff.text).toContain(submodulesUnseen);
    expect(inDocs.content[0]?.text).toContain(submodulesUnseen);
  });

  it("says nothing of submodules in a repository without any", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");

    const status = await run("git_status", {});
    const diff = await run("git_diff", {});

    expect(status.text).toContain("note.txt");
    expect(status.text).not.toContain("submodule");
    expect(diff.text).not.toContain("submodule");
  });

  /**
   * The same rule, for what a repository brings that its settings do not
   * name outright: a hook git runs when a read refreshes the index, a filter
   * whose name holds "=" or whose program reads like another filter's name,
   * and a submodule's settings, which the parent's never mention, even where
   * the parent's settings have git look inside the submodule.
   */
  it("runs no hook, and nothing a submodule or an odd filter brings, when it is only read", async () => {
    const ran = join(root, "ran");
    const marking = (name: string) =>
      `touch '${join(ran, name).replaceAll("\\", "/")}';`;
    await mkdir(ran);
    const sub = await folders.make("zhiyin-git-submodule-");
    await execGitInit(git as string, sub);
    await writeFile(join(sub, "sub.txt"), "a\n", "utf8");
    await gitOutput(sub, ["add", "sub.txt"]);
    await gitOutput(sub, ["commit", "-m", "Sub"]);
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await writeFile(join(root, "readme.md"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt", "readme.md"] });
    await run("git_commit", { message: "Add note" });
    await gitOutput(root, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      sub.replaceAll("\\", "/"),
      "sub",
    ]);
    await gitOutput(root, ["commit", "-m", "Add submodule"]);

    await writeFile(
      join(root, ".git", "hooks", "post-index-change"),
      `#!/bin/sh\n${marking("hook")}\n`,
      "utf8",
    );
    await gitOutput(root, [
      "config",
      "filter.a=b.clean",
      `${marking("odd")} cat`,
    ]);
    // Settings are listed as name and value on one line, and this program
    // ends in what reads like the name of another filter.
    await gitOutput(root, [
      "config",
      "filter.c.clean",
      `${marking("value")} cat; : x.smudge y`,
    ]);
    await writeFile(
      join(root, ".git", "info", "attributes"),
      "*.txt filter=a=b\n*.md filter=c\n",
      "utf8",
    );
    // Settings that have git look inside a submodule, as a git of its own
    // that reads the submodule's settings.
    await gitOutput(root, ["config", "diff.submodule", "diff"]);
    await gitOutput(root, ["config", "status.submoduleSummary", "true"]);
    const subGit = join(root, ".git", "modules", "sub");
    await gitOutput(root, [
      "config",
      "--file",
      join(subGit, "config"),
      "filter.inner.clean",
      `${marking("submodule")} cat`,
    ]);
    await gitOutput(root, [
      "config",
      "--file",
      join(subGit, "config"),
      "diff.external",
      `${marking("external")} :`,
    ]);
    await mkdir(join(subGit, "info"), { recursive: true });
    await writeFile(
      join(subGit, "info", "attributes"),
      "*.txt filter=inner\n",
      "utf8",
    );
    // Changed at the same size, so git has to read each file to know.
    const sameSize = async (path: string) => {
      const before = await readFile(path, "utf8");
      await writeFile(
        path,
        `${before[0] === "a" ? "b" : "a"}${before.slice(1)}`,
      );
    };
    await sameSize(join(root, "note.txt"));
    await sameSize(join(root, "readme.md"));
    await sameSize(join(root, "sub", "sub.txt"));
    // Touched without a change, so a read refreshes its entry, writes the
    // index and would run the hook.
    const twoHoursAgo = new Date(Date.now() - 7_200_000);
    await utimes(join(root, ".gitmodules"), twoHoursAgo, twoHoursAgo);

    const failed: string[] = [];
    for (const [name, args] of [
      ["git_status", {}],
      ["git_diff", {}],
      ["git_diff", { staged: true }],
      ["git_log", { limit: 5 }],
      ["git_show", { ref: "HEAD" }],
      ["git_branch", {}],
      ["git_stash", { action: "list" }],
    ] as const) {
      const result = await run(name, args);
      if (result.isError) failed.push(`${name}: ${result.text}`);
    }
    await automation.inspect("git_commit", { message: "Add other" });

    expect(failed).toEqual([]);
    expect(await readdir(ran)).toEqual([]);

    // The same read, run as git runs it by default, does start them. A file
    // git last saw at another time has its entry refreshed, so the index is
    // written and the hook runs, however fast the steps above went.
    const hourAgo = new Date(Date.now() - 3_600_000);
    await utimes(join(root, ".gitmodules"), hourAgo, hourAgo);
    await gitOutput(root, ["status"]);
    await gitOutput(root, ["show", "HEAD"]);
    expect(await readdir(ran)).toEqual(
      expect.arrayContaining(["hook", "odd", "value", "submodule", "external"]),
    );
  });

  /**
   * A filter of the repository's own, named in the bytes given, that would
   * mark that it ran; and a file it filters, changed at the same size and
   * seen at another time, so git has to read it through the filter.
   */
  async function plantFilter(name: Buffer): Promise<string> {
    const ran = await folders.make("zhiyin-git-ran-");
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    const marking = `touch '${join(ran, "clean").replaceAll("\\", "/")}'; cat`;
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
    return ran;
  }

  it("reads nothing, and runs nothing, from a repository that names its own filter in bytes that are not UTF-8", async () => {
    // "p" and byte 0xE9, é in Latin-1: Windows hands git its settings as
    // UTF-8, so no setting Zhiyin gives can name this filter.
    const ran = await plantFilter(Buffer.from([0x70, 0xe9]));

    for (const [name, args] of [
      ["git_status", {}],
      ["git_diff", {}],
    ] as const)
      expect(await run(name, args)).toEqual({
        isError: true,
        text: "This repository's settings name a filter or hook in characters Zhiyin cannot pass back to git, so it read nothing from it.",
      });
    expect(await readdir(ran)).toEqual([]);

    // The same read, run as git runs it by default, does start it.
    await gitOutput(root, ["status"]);
    expect(await readdir(ran)).toEqual(["clean"]);
  });

  it("reads nothing from a repository that names its own hook in bytes that are not UTF-8", async () => {
    // Git 2.54 and later run a hook named in settings; turning it off needs
    // its name, as for a filter.
    await appendFile(
      join(root, ".git", "config"),
      Buffer.concat([
        Buffer.from('[hook "'),
        Buffer.from([0x70, 0xe9]),
        Buffer.from('"]\n\tevent = post-index-change\n\tcommand = true\n'),
      ]),
    );

    expect(await run("git_status", {})).toEqual({
      isError: true,
      text: "This repository's settings name a filter or hook in characters Zhiyin cannot pass back to git, so it read nothing from it.",
    });
  });

  it("reads a repository whatever the person's own settings name their filters in", async () => {
    const own = join(await folders.make("zhiyin-git-global-"), "gitconfig");
    await writeFile(
      own,
      Buffer.concat([
        Buffer.from('[filter "'),
        Buffer.from([0x70, 0xe9]),
        Buffer.from('"]\n\tclean = cat\n'),
      ]),
    );
    process.env.GIT_CONFIG_GLOBAL = own;
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");

    const status = await run("git_status", {});

    expect(status.isError).toBeUndefined();
    expect(status.text).toContain("note.txt");
  });

  it("reads a repository that names its own filter in UTF-8 beyond ASCII, with the filter off", async () => {
    const ran = await plantFilter(Buffer.from("pé", "utf8"));

    const status = await run("git_status", {});
    const diff = await run("git_diff", {});

    expect(status).toMatchObject({ isError: undefined });
    expect(status.text).toContain("note.txt");
    expect(diff.text).toContain("+jello");
    expect(await readdir(ran)).toEqual([]);
  });
});

/**
 * A repository's own files can send git elsewhere: its settings can name
 * another work tree, its `.git` can be a file naming another repository, and
 * its `commondir` another repository's history. A folder can arrive with its
 * `.git` from anywhere, so git runs only where the folder holding `.git` is
 * the work tree, and the history is that folder's own, a submodule's kept in
 * its parent, or a linked work tree's that names it back.
 */
withGit("gitAutomation where a repository's own files point elsewhere", () => {
  let parent = "";
  let repo = "";
  const secret = "TOP SECRET, kept outside the folder";

  beforeEach(async () => {
    process.env.GIT_AUTHOR_NAME = "Test";
    process.env.GIT_AUTHOR_EMAIL = "test@example.com";
    process.env.GIT_COMMITTER_NAME = "Test";
    process.env.GIT_COMMITTER_EMAIL = "test@example.com";
    // By its full name, as git names it.
    parent = await realpath(await folders.make("zhiyin-git-elsewhere-"));
    repo = join(parent, "repo");
    await mkdir(repo);
  });

  /** Every text a call gave back, joined. */
  async function said(
    root: string,
    calls: readonly (readonly [string, Record<string, unknown>])[],
  ) {
    const automation = gitAutomation({ workspaceRoot: () => root });
    const results = [];
    for (const [name, args] of calls) {
      const result = (await automation.callTool(name, args)) as {
        isError?: boolean;
        content: readonly { text: string }[];
      };
      results.push({
        name,
        isError: result.isError,
        text: result.content.map((part) => part.text).join("\n"),
      });
    }
    return results;
  }

  /** A repository beside the folder, with a commit of the secret. */
  async function other(): Promise<string> {
    const elsewhere = join(parent, "other");
    await mkdir(elsewhere);
    await execGitInit(git as string, elsewhere);
    await writeFile(join(elsewhere, "secret.txt"), `${secret}\n`, "utf8");
    await gitOutput(elsewhere, ["add", "secret.txt"]);
    await gitOutput(elsewhere, ["commit", "-m", "Keep the secret"]);
    return elsewhere;
  }

  it("runs no git where the repository's settings move its work tree out of the folder", async () => {
    await mkdir(join(parent, "outside"));
    await writeFile(join(parent, "outside", "secret.txt"), `${secret}\n`);
    await execGitInit(git as string, repo);
    const blob = await gitOutput(repo, [
      "hash-object",
      "-w",
      join(parent, "outside", "secret.txt"),
    ]);
    await gitOutput(repo, [
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},outside/secret.txt`,
    ]);
    await gitOutput(repo, ["config", "core.worktree", "../.."]);
    const inspected = await gitAutomation({
      workspaceRoot: () => repo,
    }).inspect("git_diff", {});

    const results = await said(repo, [
      ["git_status", {}],
      ["git_diff", {}],
      ["git_stash", { action: "save" }],
    ]);

    const refusal = `Git would act on ${parent}, not on the folder that holds this repository, ${repo}: its own files point there. Zhiyin runs no git in it.`;
    expect(inspected).toEqual({ ok: false, reason: refusal });
    expect(results).toEqual(
      ["git_status", "git_diff", "git_stash"].map((name) => ({
        name,
        isError: true,
        text: refusal,
      })),
    );
    expect(await readFile(join(parent, "outside", "secret.txt"), "utf8")).toBe(
      `${secret}\n`,
    );
  });

  it("runs no git where the folder's .git is a file naming another repository", async () => {
    const elsewhere = await other();
    await writeFile(
      join(repo, ".git"),
      `gitdir: ${join(elsewhere, ".git").replaceAll("\\", "/")}\n`,
    );

    const results = await said(repo, [
      ["git_log", {}],
      ["git_show", { ref: "HEAD" }],
    ]);

    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/^Git would read the history kept in /);
      expect(result.text).not.toContain(secret);
    }
  });

  it("runs no git where the repository's commondir names another repository's history", async () => {
    const elsewhere = await other();
    await execGitInit(git as string, repo);
    await writeFile(
      join(repo, ".git", "commondir"),
      `${join(elsewhere, ".git").replaceAll("\\", "/")}\n`,
    );

    const results = await said(repo, [
      ["git_log", {}],
      ["git_show", { ref: "HEAD" }],
    ]);

    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/^Git would read the history kept in /);
      expect(result.text).not.toContain(secret);
    }
  });

  it("runs no git, a change included, where git cannot say where it would act", async () => {
    await mkdir(join(parent, "outside"));
    await writeFile(join(parent, "outside", "kept.txt"), "committed\n");
    await execGitInit(git as string, repo);
    // The index tracks a file outside the folder, which a stash would put
    // back as it was committed.
    const blob = await gitOutput(repo, [
      "hash-object",
      "-w",
      join(parent, "outside", "kept.txt"),
    ]);
    await gitOutput(repo, [
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},outside/kept.txt`,
    ]);
    await gitOutput(repo, ["commit", "-m", "Track it"]);
    await writeFile(join(parent, "outside", "kept.txt"), "edited\n");
    await gitOutput(repo, ["config", "core.worktree", "../.."]);
    // A filter of its own named in bytes that are not UTF-8: a read refuses
    // the repository, so git is never asked where it would act.
    await appendFile(
      join(repo, ".git", "config"),
      Buffer.concat([
        Buffer.from('[filter "'),
        Buffer.from([0x70, 0xe9]),
        Buffer.from('"]\n\tclean = cat\n'),
      ]),
    );

    const [stash] = await said(repo, [["git_stash", { action: "save" }]]);

    expect(stash?.isError).toBe(true);
    expect(await readFile(join(parent, "outside", "kept.txt"), "utf8")).toBe(
      "edited\n",
    );
  });

  it("runs no git where the folder's .git is a file naming a bare repository", async () => {
    const elsewhere = await other();
    await gitOutput(parent, [
      "clone",
      "--quiet",
      "--bare",
      elsewhere.replaceAll("\\", "/"),
      "bare.git",
    ]);
    await writeFile(
      join(repo, ".git"),
      `gitdir: ${join(parent, "bare.git").replaceAll("\\", "/")}\n`,
    );

    for (const result of await said(repo, [
      ["git_log", {}],
      ["git_show", { ref: "HEAD" }],
    ])) {
      expect(result.isError).toBe(true);
      expect(result.text).not.toContain(secret);
    }
  });

  it("runs no git where the folder's .git is a link to another repository's", async () => {
    const elsewhere = await other();
    await symlink(join(elsewhere, ".git"), join(repo, ".git"), "junction");

    for (const result of await said(repo, [["git_log", {}]])) {
      expect(result.isError).toBe(true);
      expect(result.text).not.toContain("Keep the secret");
    }
  });

  it("runs no git where the history borrows another repository's objects", async () => {
    const elsewhere = await other();
    await execGitInit(git as string, repo);
    const head = await gitOutput(elsewhere, ["rev-parse", "HEAD"]);
    // Plain text that names the other repository's objects, and a branch
    // naming its commit.
    await writeFile(
      join(repo, ".git", "objects", "info", "alternates"),
      `${join(elsewhere, ".git", "objects").replaceAll("\\", "/")}\n`,
    );
    await mkdir(join(repo, ".git", "refs", "heads"), { recursive: true });
    await writeFile(join(repo, ".git", "refs", "heads", "master"), `${head}\n`);
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/master\n");

    for (const result of await said(repo, [
      ["git_log", {}],
      ["git_show", { ref: head }],
    ])) {
      expect(result.isError).toBe(true);
      expect(result.text).not.toContain(secret);
    }
  });

  it("runs no git where the history's objects are a link to another repository's", async () => {
    const elsewhere = await other();
    await execGitInit(git as string, repo);
    const head = await gitOutput(elsewhere, ["rev-parse", "HEAD"]);
    await rm(join(repo, ".git", "objects"), { recursive: true, force: true });
    await symlink(
      join(elsewhere, ".git", "objects"),
      join(repo, ".git", "objects"),
      "junction",
    );

    const [shown] = await said(repo, [["git_show", { ref: head }]]);

    expect(shown?.isError).toBe(true);
    expect(shown?.text).not.toContain(secret);
  });

  // Through this computer's own share of its drive, which reaches the
  // repository as a network path would.
  const share = `//localhost/${tmpdir().slice(0, 1)}$/`;
  it.skipIf(!existsSync(share))(
    "runs no git where the folder's .git points to a repository over the network",
    async () => {
      const elsewhere = await other();
      const overNetwork = `${share}${join(elsewhere, ".git").slice(3).replaceAll("\\", "/")}`;
      await writeFile(join(repo, ".git"), `gitdir: ${overNetwork}\n`);

      const [log] = await said(repo, [["git_log", {}]]);

      expect(log).toEqual({
        name: "git_log",
        isError: true,
        text: "Git would reach a repository over the network, where this folder's .git points. Zhiyin runs no git in it.",
      });
    },
  );

  it("runs no git where a folder deeper in the history is a link to another repository's", async () => {
    const elsewhere = await other();
    await execGitInit(git as string, repo);
    await rm(join(repo, ".git", "refs", "heads"), {
      recursive: true,
      force: true,
    });
    await symlink(
      join(elsewhere, ".git", "refs", "heads"),
      join(repo, ".git", "refs", "heads"),
      "junction",
    );

    const [log] = await said(repo, [["git_log", {}]]);

    expect(log?.isError).toBe(true);
    expect(log?.text).toMatch(/keeps objects or references somewhere else/);
  });

  // Making a link to a file takes Developer Mode or an administrator, but
  // following one takes nothing, and an archive can bring one.
  it("runs no git where the history's pack files or its packed references are links to another repository's", async () => {
    const elsewhere = await other();
    await gitOutput(elsewhere, ["gc", "--quiet"]);
    const head = await gitOutput(elsewhere, ["rev-parse", "HEAD"]);
    await execGitInit(git as string, repo);
    const packs = join(elsewhere, ".git", "objects", "pack");
    try {
      for (const name of await readdir(packs))
        await symlink(
          join(packs, name),
          join(repo, ".git", "objects", "pack", name),
          "file",
        );
    } catch {
      return; // No links to files here.
    }
    await writeFile(join(repo, ".git", "refs", "heads", "master"), `${head}\n`);
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/master\n");

    const [shown] = await said(repo, [["git_show", { ref: head }]]);

    expect(shown?.isError).toBe(true);
    expect(shown?.text).not.toContain(secret);

    await rm(join(repo, ".git", "objects", "pack"), {
      recursive: true,
      force: true,
    });
    await mkdir(join(repo, ".git", "objects", "pack"));
    await symlink(
      join(elsewhere, ".git", "packed-refs"),
      join(repo, ".git", "packed-refs"),
      "file",
    );
    const [log] = await said(repo, [["git_log", {}]]);
    expect(log?.isError).toBe(true);
    expect(log?.text).toMatch(/keeps objects or references somewhere else/);
  });

  it("runs no git where the history is kept apart from the work tree", async () => {
    await gitOutput(parent, [
      "init",
      "--quiet",
      "--separate-git-dir",
      join(parent, "kept.git").replaceAll("\\", "/"),
      "repo",
    ]);

    const [status] = await said(repo, [["git_status", {}]]);

    expect(status?.isError).toBe(true);
    expect(status?.text).toMatch(/^Git would read the history kept in /);
  });

  it("works in a submodule's folder, a linked work tree and a folder inside a repository", async () => {
    const elsewhere = await other();
    await execGitInit(git as string, repo);
    await writeFile(join(repo, "note.txt"), "hello\n", "utf8");
    await gitOutput(repo, ["add", "note.txt"]);
    await gitOutput(repo, ["commit", "-m", "Add note"]);
    await gitOutput(repo, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      elsewhere.replaceAll("\\", "/"),
      "sub",
    ]);
    await gitOutput(repo, ["commit", "-m", "Add submodule"]);
    await gitOutput(repo, ["worktree", "add", "../linked"]);
    // A submodule in the linked work tree keeps its history in the linked
    // work tree's own record.
    await gitOutput(join(parent, "linked"), [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
    ]);
    await mkdir(join(repo, "docs"));

    for (const root of [
      join(repo, "sub"),
      join(parent, "linked"),
      join(parent, "linked", "sub"),
      join(repo, "docs"),
    ]) {
      const [log] = await said(root, [["git_log", { limit: 1 }]]);
      expect(log?.isError, `${root}: ${log?.text}`).toBeUndefined();
    }
  });

  it("declares that a call reads and changes outside the folder where the repository or its history lies beyond it", async () => {
    const elsewhere = await other();
    await execGitInit(git as string, repo);
    await writeFile(join(repo, "note.txt"), "hello\n", "utf8");
    await gitOutput(repo, ["add", "note.txt"]);
    await gitOutput(repo, ["commit", "-m", "Add note"]);
    await gitOutput(repo, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      elsewhere.replaceAll("\\", "/"),
      "sub",
    ]);
    await gitOutput(repo, ["commit", "-m", "Add submodule"]);
    await gitOutput(repo, ["worktree", "add", "../linked"]);
    await mkdir(join(repo, "docs"));

    const reads = {
      reads: "elsewhere",
      changes: "none",
      sends: "none",
      actsAsPerson: "none",
      runs: "none",
      lasting: false,
      brings: "none",
    };
    const changes = {
      reads: "elsewhere",
      changes: "elsewhere",
      sends: "none",
      actsAsPerson: "none",
      runs: "full-access",
      lasting: false,
      brings: "none",
    };
    // A folder inside the repository; a submodule and a linked work tree,
    // whose history is kept in the repository that holds them.
    for (const root of [
      join(repo, "docs"),
      join(repo, "sub"),
      join(parent, "linked"),
    ]) {
      const automation = gitAutomation({ workspaceRoot: () => root });
      for (const [name, args, effects] of [
        ["git_log", { limit: 1 }, reads],
        ["git_stash", { action: "list" }, reads],
        ["git_commit", { message: "Another" }, changes],
        ["git_stash", { action: "save" }, changes],
      ] as const) {
        const inspection = await automation.inspect(name, args);
        expect(inspection.ok && inspection.effects, `${root}: ${name}`).toEqual(
          effects,
        );
      }
    }
  });
});

/** Git's own variables that tie a command to one repository, as it lists them. */
const repositoryVariables = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
]);

/** The environment with none of them, so a check reads the folder it names. */
function ownEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !repositoryVariables.has(name.toUpperCase()),
    ),
  );
}

/** What git prints in a folder, read independently of the connector. */
async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) =>
    execFile(
      git as string,
      args,
      { cwd, env: ownEnvironment() },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    ),
  );
}

async function execGitInit(gitExe: string, cwd: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(gitExe, ["init", "--quiet"], {
      cwd,
      env: ownEnvironment(),
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`git init failed: ${code}`)),
    );
    child.on("error", reject);
  });
}
