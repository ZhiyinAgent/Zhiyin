/**
 * git run for a sealed-off shell, with the person's real git: it works in the
 * shell's folder, starts none of the programs a repository's settings name,
 * and refuses to work anywhere else.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
import { resolveGit, shellGit, type LinksIn } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const git = shellGit({ containment: { open: openProcessContainer } });

/** A workspace, a home and a folder of markers each program would leave. */
async function setting() {
  const workspace = await folders.make("zhiyin-shell-git-work-");
  const home = await folders.make("zhiyin-shell-git-home-");
  const markers = await folders.make("zhiyin-shell-git-markers-");
  const run = async (...args: string[]) => {
    const ran = await git({
      args,
      cwd: workspace,
      folders: [workspace],
      hosts: [],
      home,
      signal: new AbortController().signal,
    });
    return {
      exitCode: ran.exitCode,
      stdout: ran.stdout.toString("utf8"),
      stderr: ran.stderr.toString("utf8"),
    };
  };
  return { workspace, home, markers, run };
}

/** Text kept outside the shell's folders, written as settings so git can list it. */
const outsideText = "zhiyin-outside-text-7c41";

/**
 * A repository in the shell's folder whose `link` is a junction or a
 * symbolic link to a folder outside it, which holds `secret.cfg`. Undefined
 * when this account may not make the link.
 */
async function linkedOutside(kind: "junction" | "dir") {
  const at = await setting();
  const outside = await folders.make("zhiyin-shell-git-outside-");
  await writeFile(
    join(outside, "secret.cfg"),
    `[outside]\n\tsecret = ${outsideText}\n`,
  );
  await at.run("init", "-q");
  await at.run("config", "user.name", "Tester");
  await at.run("config", "user.email", "tester@example.com");
  await writeFile(join(at.workspace, "a.txt"), "one\n");
  try {
    await symlink(outside, join(at.workspace, "link"), kind);
  } catch {
    return undefined;
  }
  return at;
}

/** Every object the repository holds, read whole by git itself. */
function objectsOf(workspace: string): string {
  return execFileSync(
    resolveGit()!,
    ["cat-file", "--batch-all-objects", "--batch", "--unordered"],
    { cwd: workspace, encoding: "utf8" },
  );
}

/** A command a shell runs that leaves `name` in the markers folder. */
const leaves = (markers: string, name: string) =>
  `echo ran >> '${join(markers, name).replaceAll("\\", "/")}'`;

describe.runIf(process.platform === "win32" && resolveGit() !== undefined)(
  "git for a sealed-off shell",
  { timeout: 120_000 },
  () => {
    it("runs status, add, commit, diff and log in the shell's folder", async () => {
      const { workspace, run } = await setting();
      expect((await run("init", "-q")).exitCode).toBe(0);
      await run("config", "user.name", "Tester");
      await run("config", "user.email", "tester@example.com");
      await writeFile(join(workspace, "a.txt"), "one\n");

      expect((await run("status", "--short")).stdout).toContain("?? a.txt");
      expect((await run("add", "a.txt")).exitCode).toBe(0);
      expect((await run("commit", "-q", "-m", "first")).exitCode).toBe(0);
      await writeFile(join(workspace, "a.txt"), "two\n");
      expect((await run("diff")).stdout).toContain("+two");
      expect((await run("log", "--oneline")).stdout).toContain("first");
    });

    it("makes a repository from no templates, saying nothing of them", async () => {
      const { workspace, run } = await setting();

      const made = await run("init", "-q");

      expect(made).toMatchObject({ exitCode: 0, stderr: "" });
      expect(existsSync(join(workspace, ".git", "hooks"))).toBe(false);
    });

    it("starts none of the programs the repository's settings and its includes name", async () => {
      const { workspace, markers, run } = await setting();
      await run("init", "-q");
      await run("config", "user.name", "Tester");
      await run("config", "user.email", "tester@example.com");
      const hooks = join(workspace, ".git", "hooks");
      await mkdir(hooks, { recursive: true });
      for (const hook of ["pre-commit", "post-commit", "commit-msg"])
        await writeFile(
          join(hooks, hook),
          `#!/bin/sh\n${leaves(markers, `hook-${hook}`)}\n`,
        );
      await writeFile(
        join(workspace, "included.cfg"),
        [
          "[core]",
          `\tpager = ${leaves(markers, "included-pager")}`,
          '[diff "inc"]',
          `\ttextconv = ${leaves(markers, "included-textconv")}`,
        ].join("\n"),
      );
      await appendFile(
        join(workspace, ".git", "config"),
        [
          "",
          "[core]",
          `\tfsmonitor = ${leaves(markers, "fsmonitor")}`,
          `\tpager = ${leaves(markers, "pager")}`,
          `\tsshCommand = ${leaves(markers, "ssh")}`,
          `\teditor = ${leaves(markers, "editor")}`,
          '[filter "evil"]',
          `\tclean = ${leaves(markers, "clean")}`,
          `\tsmudge = ${leaves(markers, "smudge")}`,
          "\trequired = true",
          '[diff "evil"]',
          `\ttextconv = ${leaves(markers, "textconv")}`,
          `\tcommand = ${leaves(markers, "diff-command")}`,
          '[merge "evil"]',
          `\tdriver = ${leaves(markers, "merge-driver")}`,
          "[diff]",
          `\texternal = ${leaves(markers, "external-diff")}`,
          "[alias]",
          `\tst = !${leaves(markers, "alias")}`,
          "[include]",
          "\tpath = ../included.cfg",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(workspace, ".gitattributes"),
        "*.txt filter=evil diff=evil merge=evil\n*.md diff=inc\n",
      );
      await writeFile(join(workspace, "a.txt"), "one\n");
      await writeFile(join(workspace, "b.md"), "one\n");

      await run("status");
      await run("add", "-A");
      const committed = await run("commit", "-q", "-m", "first");
      await writeFile(join(workspace, "a.txt"), "two\n");
      await writeFile(join(workspace, "b.md"), "two\n");
      const diffed = await run("diff");
      await run("log", "-p");
      await run("checkout", "--", "a.txt", "b.md");
      await run("checkout", "-q", "-b", "other");
      await writeFile(join(workspace, "a.txt"), "theirs\n");
      await run("commit", "-q", "-am", "theirs");
      await run("checkout", "-q", "-");
      await writeFile(join(workspace, "a.txt"), "ours\n");
      await run("commit", "-q", "-am", "ours");
      const merged = await run("merge", "other");
      const alias = await run("st");
      await run("fetch", "git@example.com:x/y.git");

      expect(committed.exitCode).toBe(0);
      expect(diffed.stdout).toContain("+two");
      expect(merged.stdout).toContain("CONFLICT");
      expect(alias.exitCode).not.toBe(0);
      expect(await readdir(markers)).toEqual([]);
    });

    it("refuses a folder, a path or an option that would take it beyond the shell's folders", async () => {
      const { workspace, home, run } = await setting();
      const elsewhere = await folders.make("zhiyin-shell-git-elsewhere-");

      const fromElsewhere = await git({
        args: ["init", "-q"],
        cwd: elsewhere,
        folders: [workspace],
        hosts: [],
        home,
        signal: new AbortController().signal,
      });
      const initElsewhere = await run("init", "-q", elsewhere);
      const climbing = await run("init", "-q", "../outside");
      const moved = await run("-C", elsewhere, "init", "-q");
      const configured = await run("-c", "core.pager=less", "log");
      const tool = await run("difftool");

      for (const refused of [
        fromElsewhere,
        initElsewhere,
        climbing,
        moved,
        configured,
        tool,
      ])
        expect(refused.exitCode === 128 || refused.exitCode !== 0).toBe(true);
      expect(fromElsewhere.stderr.toString()).toContain("outside the folders");
      expect(initElsewhere.stderr).toContain("outside the folders");
      expect(climbing.stderr).toContain("outside the folders");
      expect(moved.stderr).toContain("-C");
      expect(configured.stderr).toContain("-c");
      expect(tool.stderr).toContain("difftool");
      expect(existsSync(join(elsewhere, ".git"))).toBe(false);
    });

    it("refuses a repository whose work tree is set outside the shell's folders", async () => {
      const { workspace, run } = await setting();
      const elsewhere = await folders.make("zhiyin-shell-git-tree-");
      await run("init", "-q");
      await appendFile(
        join(workspace, ".git", "config"),
        `\n[core]\n\tworktree = ${elsewhere.replaceAll("\\", "/")}\n`,
      );

      const status = await run("status");

      expect(status.exitCode).toBe(128);
      expect(status.stderr).toContain("outside the folders");
    });

    describe.each([
      ["a junction", "junction"],
      ["a symbolic link", "dir"],
    ] as const)(
      "with %s in the shell's folder to a folder outside it",
      (_, kind) => {
        it.for<[string, string[]]>([
          ["add of a path through it", ["add", "link/secret.cfg"]],
          ["add -A", ["add", "-A"]],
          [
            "hash-object of a path through it",
            ["hash-object", "-w", "link/secret.cfg"],
          ],
          [
            "diff --no-index of a path through it",
            ["diff", "--no-index", "a.txt", "link/secret.cfg"],
          ],
          [
            "config --file naming a path through it",
            ["config", "--file", "link/secret.cfg", "--list"],
          ],
          [
            "config --file= naming a path through it",
            ["config", "--file=link/secret.cfg", "--list"],
          ],
          [
            "commit -F with a message file through it",
            ["commit", "-q", "-Flink/secret.cfg"],
          ],
        ])(
          "%s brings none of the outside folder's content into the shell's folder",
          async ([, args], context) => {
            const at = await linkedOutside(kind);
            if (!at)
              return context.skip(
                "this account may not make symbolic links unelevated",
              );

            const ran = await at.run(...args);

            expect(ran.stdout + ran.stderr).not.toContain(outsideText);
            expect(objectsOf(at.workspace)).not.toContain(outsideText);
          },
        );

        it("refuses a path through it, saying why and suggesting full access", async (context) => {
          const at = await linkedOutside(kind);
          if (!at)
            return context.skip(
              "this account may not make symbolic links unelevated",
            );

          const relative = await at.run("hash-object", "-w", "link/secret.cfg");
          const absolute = await at.run(
            "hash-object",
            "-w",
            join(at.workspace, "link", "secret.cfg"),
          );

          for (const refused of [relative, absolute]) {
            expect(refused.exitCode).toBe(128);
            expect(refused.stderr).toMatch(/link/i);
            expect(refused.stderr).toContain("outside the folders");
            expect(refused.stderr).toContain("full access");
          }
        });

        it("refuses the whole repository, saying which link leads out", async (context) => {
          const at = await linkedOutside(kind);
          if (!at)
            return context.skip(
              "this account may not make symbolic links unelevated",
            );

          const status = await at.run("status");

          expect(status.exitCode).toBe(128);
          expect(status.stderr).toContain(join(at.workspace, "link"));
          expect(status.stderr).toContain("outside the folders");
          expect(status.stderr).toContain("full access");
        });

        it("refuses a git folder, and a folder outside a repository, that hold one", async (context) => {
          const inGitFolder = await setting();
          const plain = await setting();
          const outside = await folders.make("zhiyin-shell-git-outside-");
          await writeFile(join(outside, "secret.txt"), `${outsideText}\n`);
          await inGitFolder.run("init", "-q");
          try {
            await symlink(
              outside,
              join(inGitFolder.workspace, ".git", "linked"),
              kind,
            );
            await symlink(outside, join(plain.workspace, "link"), kind);
          } catch {
            return context.skip(
              "this account may not make symbolic links unelevated",
            );
          }

          const status = await inGitFolder.run("status");
          const grepped = await plain.run("grep", "--no-index", outsideText);

          for (const refused of [status, grepped]) {
            expect(refused.exitCode).toBe(128);
            expect(refused.stdout).not.toContain(outsideText);
            expect(refused.stderr).toContain(outside);
          }
        });

        it("works with a link that stays inside the shell's folder", async (context) => {
          const { workspace, run } = await setting();
          await run("init", "-q");
          await mkdir(join(workspace, "kept"));
          await writeFile(join(workspace, "kept", "b.txt"), "inside\n");
          try {
            await symlink(
              join(workspace, "kept"),
              join(workspace, "near"),
              kind,
            );
          } catch {
            return context.skip(
              "this account may not make symbolic links unelevated",
            );
          }

          const added = await run("add", "-A");
          const status = await run("status", "--short");

          expect(added.exitCode).toBe(0);
          expect(status.stdout).toContain("kept/b.txt");
        });
      },
    );

    describe("given an index of the links in a folder", () => {
      /** A repository, and git run in it with `linksIn` for its links. */
      async function indexed(linksIn: LinksIn) {
        const at = await setting();
        await at.run("init", "-q");
        const ask = shellGit({
          containment: { open: openProcessContainer },
          linksIn,
        });
        const run = async (...args: string[]) => {
          const ran = await ask({
            args,
            cwd: at.workspace,
            folders: [at.workspace],
            hosts: [],
            home: at.home,
            signal: new AbortController().signal,
          });
          return {
            exitCode: ran.exitCode,
            stderr: ran.stderr.toString("utf8"),
          };
        };
        return { ...at, run };
      }

      it("takes the links from the index, refusing one it names as leading out", async () => {
        const outside = await folders.make("zhiyin-shell-git-outside-");
        const asked: string[] = [];
        let workspace = "";
        const at = await indexed(async (root) => {
          asked.push(root);
          // A link only the index knows of: none is on disk.
          return [{ path: join(workspace, "door"), target: outside }];
        });
        workspace = at.workspace;

        const status = await at.run("status");

        expect(asked.length).toBeGreaterThan(0);
        expect(status.exitCode).toBe(128);
        expect(status.stderr).toContain(join(at.workspace, "door"));
        expect(status.stderr).toContain("outside the folders");
      });

      it("walks the folder when the index cannot say, finding the link on disk", async () => {
        const outside = await folders.make("zhiyin-shell-git-outside-");
        const at = await indexed(async () => undefined);
        await symlink(outside, join(at.workspace, "link"), "junction");

        const status = await at.run("status");

        expect(status.exitCode).toBe(128);
        expect(status.stderr).toContain(join(at.workspace, "link"));
        expect(status.stderr).toContain("outside the folders");
      });
    });

    it("reaches no network when the conversation names no host", async () => {
      const { run } = await setting();

      const listed = await run("ls-remote", "https://example.com/x.git");

      expect(listed.exitCode).not.toBe(0);
      expect(listed.stderr).toMatch(/not allowed|transport/i);
    });
  },
);
