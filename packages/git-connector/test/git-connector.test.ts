import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { gitAutomation, resolveGit } from "../src/index.js";

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

  it("lists all eight tools", async () => {
    expect((await automation.listTools()).map((tool) => tool.name)).toEqual([
      "git_status",
      "git_diff",
      "git_log",
      "git_show",
      "git_branch",
      "git_stage",
      "git_commit",
      "git_stash",
    ]);
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
    });
    if (preview.ok) expect(preview.detail).toContain("note.txt");

    const commit = await run("git_commit", { message: "Add note" });
    expect(commit.isError).toBeFalsy();

    const log = await run("git_log", { limit: 5 });
    expect(log.text).toContain("Add note");
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
    expect(refusedInspection).toMatchObject({ ok: false });

    const refusedExecution = await run("git_show", {
      ref: "--upload-pack=evil",
    });
    expect(refusedExecution.isError).toBe(true);
  });

  it("refuses a flag in every staging path", async () => {
    const refusedInspection = await automation.inspect("git_stage", {
      paths: ["--all"],
    });
    expect(refusedInspection).toMatchObject({ ok: false });

    const refusedExecution = await run("git_stage", { paths: ["--all"] });
    expect(refusedExecution.isError).toBe(true);
  });

  it("stashes and restores uncommitted changes", async () => {
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");
    await run("git_stage", { paths: ["note.txt"] });
    await run("git_commit", { message: "Add note" });
    await writeFile(join(root, "note.txt"), "changed\n", "utf8");

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

  /**
   * The same rule, for what a repository brings that its settings do not
   * name outright: a hook git runs when a read refreshes the index, a filter
   * whose name holds "=", and a submodule's settings, which the parent's never
   * mention.
   */
  it("runs no hook, and nothing a submodule or an odd filter name brings, when it is only read", async () => {
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
    await run("git_stage", { paths: ["note.txt"] });
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
    await writeFile(
      join(root, ".git", "info", "attributes"),
      "*.txt filter=a=b\n",
      "utf8",
    );
    const subGit = join(root, ".git", "modules", "sub");
    await gitOutput(root, [
      "config",
      "--file",
      join(subGit, "config"),
      "filter.inner.clean",
      `${marking("submodule")} cat`,
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
    await sameSize(join(root, "sub", "sub.txt"));

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
    expect(await readdir(ran)).toEqual(
      expect.arrayContaining(["hook", "odd", "submodule"]),
    );
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
