import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { gitAutomation, resolveGit } from "../src/index.js";
import { leftUncommitted } from "../src/resulting-state.js";
import { endings } from "../src/run-git.js";
import { execGitInit, git, gitOutput, withGit } from "./real-git.js";

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
});
