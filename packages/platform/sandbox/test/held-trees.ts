/**
 * What the tests of folders held read-only whole work with: a copy of this
 * repository's own `.git`, which is never itself touched, a real confined
 * process that tries operations on it, and the permissions Windows keeps on
 * each entry.
 */

import { execFileSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { replaceFile } from "@zhiyin/files";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  confine,
  forgetConfinement,
  openProcessContainer,
  readOnlyHolds,
} from "../src/index.js";

/** The holds kept in this data folder, as the app keeps them. */
export const heldIn = (
  directory: string,
  options: Omit<Parameters<typeof readOnlyHolds>[1], "replace"> = {},
) => readOnlyHolds(directory, { ...options, replace: replaceFile });

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
/** The repository's own Git folder, which in a linked worktree is the main checkout's. */
export const repositoryGit = execFileSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { cwd: here, encoding: "utf8" },
).trim();
/** Folders a test makes, removed by `letGo` after it. */
export const folders = new TemporaryFolders();
const kept = new TemporaryFolders();
const purpose = "test";
const homes: string[] = [];

let programs = "";

/** Puts Node and the program that tries operations where confined processes may run them. */
export async function placePrograms(): Promise<void> {
  programs = await kept.make("zhiyin-tree-programs-");
  await cp(process.execPath, join(programs, "node.exe"));
  await cp(join(fixtures, "reach.mjs"), join(programs, "reach.mjs"));
}

/** Forgets each confinement a test made and removes its folders. */
export async function letGo(): Promise<void> {
  for (const each of homes.splice(0)) forgetConfinement(purpose, each);
  await folders.removeAll();
}

/** Removes the programs `placePrograms` put in place. */
export const removePrograms = () => kept.removeAll();

/** What a process confined to change `work` could do of each operation. */
export async function reach(
  work: string,
  operations: readonly (readonly unknown[])[],
): Promise<unknown[]> {
  const home = await folders.make("zhiyin-tree-home-");
  homes.push(home);
  const confined = await confine({
    purpose,
    home,
    read: [programs],
    write: [work],
    hosts: [],
  });
  const output = await folders.make("zhiyin-tree-output-");
  const container = openProcessContainer();
  try {
    const child = container.launch({
      executable: join(programs, "node.exe"),
      arguments: [
        "--preserve-symlinks-main",
        "--preserve-symlinks",
        join(programs, "reach.mjs"),
        JSON.stringify(operations),
      ],
      cwd: programs,
      stdout: join(output, "stdout.txt"),
      stderr: join(output, "stderr.txt"),
      confined,
    });
    if ((await child.wait()) !== 0)
      throw new Error(await readFile(join(output, "stderr.txt"), "utf8"));
    return JSON.parse(await readFile(join(output, "stdout.txt"), "utf8"));
  } finally {
    container.close();
  }
}

export function permissions(path: string): string {
  const advapi32 = koffi.load("advapi32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const GetNamedSecurityInfoW = advapi32.func(
    "uint32 GetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, void*, void*, _Out_ void**)",
  );
  const ToText = advapi32.func(
    "bool ConvertSecurityDescriptorToStringSecurityDescriptorW(void*, uint32, uint32, _Out_ void**, void*)",
  );
  const LocalFree = kernel32.func("void* LocalFree(void*)");
  const descriptor: unknown[] = [null];
  if (GetNamedSecurityInfoW(path, 1, 4, null, null, null, null, descriptor))
    throw new Error(`The permissions of ${path} could not be read.`);
  const text: unknown[] = [null];
  ToText(descriptor[0], 1, 4, text, null);
  const written = koffi.decode(text[0], "char16_t", -1) as string;
  LocalFree(text[0]);
  LocalFree(descriptor[0]);
  return written;
}

/** Every entry below a folder. */
async function everything(folder: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [folder];
  for (let next = pending.pop(); next; next = pending.pop())
    for (const entry of await readdir(next, { withFileTypes: true })) {
      const path = join(next, entry.name);
      found.push(path);
      if (entry.isDirectory()) pending.push(path);
    }
  return found;
}

/**
 * A copy of the folder `from` at `to`, its files copied sixteen at a time:
 * one at a time, a `.git` of thousands of files takes seconds to copy. A link
 * is copied as a link.
 */
async function copyTree(from: string, to: string): Promise<void> {
  const files: { readonly path: string; readonly link: boolean }[] = [];
  const pending = [from];
  for (let next = pending.pop(); next; next = pending.pop()) {
    await mkdir(join(to, relative(from, next)), { recursive: true });
    for (const entry of await readdir(next, { withFileTypes: true })) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else files.push({ path, link: entry.isSymbolicLink() });
    }
  }
  let next = 0;
  const copying = async () => {
    for (let at = next++; at < files.length; at = next++) {
      const { path, link } = files[at]!;
      const target = join(to, relative(from, path));
      await (link ? cp(path, target) : copyFile(path, target));
    }
  };
  await Promise.all(Array.from({ length: 16 }, copying));
}

/** A workspace holding a copy of this repository's `.git`, given to programs once. */
export async function workspace() {
  const work = await folders.make("zhiyin-tree-work-");
  await copyTree(repositoryGit, join(work, ".git"));
  const git = join(work, ".git");
  // A ref and an object of known names, beside the copied ones.
  await mkdir(join(git, "refs", "heads", "zhiyin-test"), { recursive: true });
  await writeFile(
    join(git, "refs", "heads", "zhiyin-test", "branch"),
    "0".repeat(40),
  );
  await mkdir(join(git, "objects", "zz"), { recursive: true });
  await writeFile(join(git, "objects", "zz", "object"), "compressed");
  await writeFile(join(work, "notes.txt"), "the person's notes");
  await reach(work, [["read", join(work, "notes.txt")]]);
  const entries = await everything(git);
  const sample = [git, ...entries.filter((_, index) => index % 250 === 0)];
  const before = new Map(sample.map((path) => [path, permissions(path)]));
  return { work, git, entries, before };
}

export const object = (git: string) => join(git, "objects", "zz", "object");
export const ref = (git: string) =>
  join(git, "refs", "heads", "zhiyin-test", "branch");
