/**
 * git kept to the workspace's own repository, whatever points it elsewhere:
 * variables Zhiyin inherited, or the repository's own files.
 */

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
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
