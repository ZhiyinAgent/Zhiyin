/**
 * The places in a workspace that decide what a later git run starts, found
 * from real folders laid out as git lays them out. Nothing runs git.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { gitProgramLocations } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await folders.make("zhiyin-git-locations-");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Each location by its path from the workspace, with forward slashes. */
async function located(root: string) {
  const found = await gitProgramLocations(root);
  return Object.fromEntries(
    found.map(({ path, hold }) => [
      relative(root, path).replaceAll("\\", "/"),
      hold,
    ]),
  );
}

describe("what decides what a later git run starts", () => {
  it("is the repository's git folder, held whole with its objects, refs, configuration and hooks", async () => {
    const root = await workspace({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/config": "[core]\n\tbare = false\n",
      ".git/hooks/pre-commit.sample": "#!/bin/sh\n",
      ".git/info/exclude": "\n",
      ".git/objects/ab/cdef": "object",
      ".git/refs/heads/main": "0000\n",
      "src/app.py": "print(1)\n",
    });

    expect(await located(root)).toEqual({ ".git": "tree" });
  });

  it("is each submodule's gitfile, with the folders it is in kept where they are, its git folder held with the repository's", async () => {
    const root = await workspace({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/config": "[core]\n",
      ".git/modules/lib/HEAD": "ref: refs/heads/main\n",
      ".git/modules/lib/config": "[core]\n\tworktree = ../../../vendor/lib\n",
      ".git/modules/lib/hooks/post-checkout.sample": "#!/bin/sh\n",
      "vendor/lib/.git": "gitdir: ../../.git/modules/lib\n",
      "vendor/lib/code.c": "int main;\n",
    });

    expect(await located(root)).toEqual({
      ".git": "tree",
      "vendor/lib/.git": "read-only",
      vendor: "in-place",
      "vendor/lib": "in-place",
    });
  });

  it("is every repository nested deeper in the folder, as a folder of several projects holds", async () => {
    const root = await workspace({
      "notes.md": "Projects.\n",
      "app/.git/HEAD": "ref: refs/heads/main\n",
      "app/.git/config": "[core]\n",
      "app/.git/hooks/pre-commit.sample": "#!/bin/sh\n",
      "app/src/main.py": "print(1)\n",
      "clients/site/.git/HEAD": "ref: refs/heads/main\n",
      "clients/site/.git/config": "[core]\n",
    });

    expect(await located(root)).toEqual({
      "app/.git": "tree",
      "clients/site/.git": "tree",
    });
  });

  it("is a nested linked worktree's gitfile, with the folders it is in kept where they are", async () => {
    const root = await workspace({
      "main/.git/HEAD": "ref: refs/heads/main\n",
      "main/.git/config": "[core]\n",
      "main/.git/worktrees/fix/HEAD": "ref: refs/heads/fix\n",
      "main/.git/worktrees/fix/gitdir": "../../../../fix/.git\n",
      "fix/.git": "gitdir: ../main/.git/worktrees/fix\n",
    });

    expect(await located(root)).toEqual({
      "main/.git": "tree",
      "fix/.git": "read-only",
      fix: "in-place",
    });
  });

  it("leaves out what installed packages keep, where no one commits", async () => {
    const root = await workspace({
      "node_modules/lib/.git/HEAD": "ref: refs/heads/main\n",
      "node_modules/lib/.git/config": "[core]\n",
    });

    expect(await located(root)).toEqual({});
  });

  it("is a linked worktree's git folder, and the gitfile leading to it", async () => {
    const root = await workspace({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/worktrees/feature/HEAD": "ref: refs/heads/feature\n",
      ".git/worktrees/feature/commondir": "../..\n",
      "other/.git": "gitdir: ../.git/worktrees/feature\n",
    });
    await writeFile(
      join(root, ".git/worktrees/feature/gitdir"),
      `${join(root, "other", ".git")}\n`,
    );

    expect(await located(root)).toEqual({
      ".git": "tree",
      "other/.git": "read-only",
      other: "in-place",
    });
  });

  it("is the git folder a workspace's own gitfile names, when it is inside the workspace", async () => {
    const root = await workspace({
      ".git": "gitdir: repo.git\n",
      "repo.git/HEAD": "ref: refs/heads/main\n",
      "repo.git/objects/ab/cdef": "object",
    });

    expect(await located(root)).toEqual({
      ".git": "read-only",
      "repo.git": "tree",
    });
  });

  it("is nothing in a folder that is not a repository", async () => {
    const root = await workspace({ "notes.txt": "hello\n" });

    expect(await gitProgramLocations(root)).toEqual([]);
  });
});
