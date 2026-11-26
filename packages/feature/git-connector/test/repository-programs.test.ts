/**
 * What a real repository's own settings and files would have git start: a
 * read starts none of it, a submodule's and a filter's named in odd bytes
 * included, while the person's own filters still apply.
 */

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { gitAutomation } from "../src/index.js";
import { readGit } from "../src/run-git.js";
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
