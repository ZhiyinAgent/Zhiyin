/**
 * A folder held read-only whole, as Git's folder is for a sealed-off script:
 * tried by a real confined process on a copy of this repository's own `.git`,
 * which is never itself touched. Everything in it is read and nothing of it
 * changed; once let go, and at the next start when Zhiyin stopped holding it,
 * every permission is exactly as it was.
 */

import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { replaceFile } from "@zhiyin/files";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  confine,
  forgetConfinement,
  openProcessContainer,
  readOnlyHolds,
} from "../src/index.js";
import { Walks } from "../src/permission-walks.js";

/** The holds kept in this data folder, as the app keeps them. */
const heldIn = (
  directory: string,
  options: Omit<Parameters<typeof readOnlyHolds>[1], "replace"> = {},
) => readOnlyHolds(directory, { ...options, replace: replaceFile });

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
/** The repository's own Git folder, which in a linked worktree is the main checkout's. */
const repositoryGit = execFileSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { cwd: here, encoding: "utf8" },
).trim();
const folders = new TemporaryFolders();
const kept = new TemporaryFolders();
const purpose = "test";
const homes: string[] = [];
afterEach(async () => {
  for (const each of homes.splice(0)) forgetConfinement(purpose, each);
  await folders.removeAll();
});
afterAll(() => kept.removeAll());

let programs = "";
let isFolder = false;
beforeAll(async () => {
  programs = await kept.make("zhiyin-tree-programs-");
  await cp(process.execPath, join(programs, "node.exe"));
  await cp(join(fixtures, "reach.mjs"), join(programs, "reach.mjs"));
  isFolder = (await stat(repositoryGit).catch(() => undefined))?.isDirectory()
    ? true
    : false;
});

/** What a process confined to change `work` could do of each operation. */
async function reach(
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

function permissions(path: string): string {
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

/** A workspace holding a copy of this repository's `.git`, given to programs once. */
async function workspace() {
  const work = await folders.make("zhiyin-tree-work-");
  await cp(repositoryGit, join(work, ".git"), { recursive: true });
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

const object = (git: string) => join(git, "objects", "zz", "object");
const ref = (git: string) =>
  join(git, "refs", "heads", "zhiyin-test", "branch");

describe.runIf(process.platform === "win32")("a folder held whole", () => {
  it(
    "is read by a sealed-off program, which can neither delete, overwrite nor rename an object or a ref, nor add a file anywhere in it",
    { timeout: 120_000 },
    async () => {
      const { work, git, entries } = await workspace();
      const holds = heldIn(await folders.make("zhiyin-tree-data-"));

      let started = performance.now();
      const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);
      const holding = performance.now() - started;
      const results = await reach(work, [
        ["read", ref(git)],
        ["list", join(git, "objects", "zz")],
        ["delete", object(git)],
        ["write", object(git)],
        ["rename", ref(git), join(git, "refs", "heads", "moved")],
        ["delete", ref(git)],
        ["write", join(git, "objects", "zz", "new")],
        ["write", join(git, "new-file")],
        ["mkdir", join(git, "hooks-made")],
        ["rename", git, join(work, "moved-git")],
        ["write", join(work, "beside.txt")],
      ]);
      started = performance.now();
      await hold.release();
      const releasing = performance.now() - started;
      console.log(
        `Held ${entries.length} entries of .git in ${Math.round(holding)} ms, let go in ${Math.round(releasing)} ms.`,
      );

      expect(hold.failed).toEqual([]);
      expect(results).toEqual([
        "0".repeat(40),
        "object",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "done",
      ]);
    },
  );

  it(
    "gets back exactly the permissions it and what it holds had, and is all writable again",
    { timeout: 120_000 },
    async () => {
      const { work, git, before } = await workspace();
      const holds = heldIn(await folders.make("zhiyin-tree-data-"));

      const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);
      await hold.release();
      const results = await reach(work, [
        ["delete", object(git)],
        ["write", join(git, "new-file")],
        ["append", ref(git)],
      ]);

      expect(
        new Map([...before.keys()].map((path) => [path, permissions(path)])),
      ).toEqual(before);
      expect(results).toEqual(["done", "done", "done"]);
    },
  );

  it(
    "holds by itself an entry in it with permissions of its own",
    { timeout: 120_000 },
    async () => {
      const { work, git } = await workspace();
      // Its entries made its own, the workspace's grant among them.
      execFileSync("icacls", [ref(git), "/inheritance:d"], { stdio: "ignore" });
      const holds = heldIn(await folders.make("zhiyin-tree-data-"));
      const before = permissions(ref(git));

      const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);
      const results = await reach(work, [
        ["read", ref(git)],
        ["append", ref(git)],
      ]);
      await hold.release();

      expect(results).toEqual(["0".repeat(40), "EPERM"]);
      expect(permissions(ref(git))).toBe(before);
    },
  );

  it(
    "gets its permissions back at the next start when Zhiyin stopped while holding it",
    { timeout: 120_000 },
    async () => {
      const { work, git, before } = await workspace();
      const data = await folders.make("zhiyin-tree-data-");
      await heldIn(data).hold(work, [{ path: git, hold: "tree" }]);

      await heldIn(data).restored;

      expect(
        new Map([...before.keys()].map((path) => [path, permissions(path)])),
      ).toEqual(before);
      expect(await reach(work, [["delete", object(git)]])).toEqual(["done"]);
    },
  );
});

describe.runIf(process.platform === "win32")(
  "a folder held whole in place",
  () => {
    it(
      "cannot be moved away by a sealed-off program, by its own name or through the folder it is in",
      { timeout: 120_000 },
      async () => {
        const { work, git } = await workspace();
        const holds = heldIn(await folders.make("zhiyin-tree-data-"));
        const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);

        // Moving a folder needs its own right to be deleted, or its parent's
        // right to remove what it holds; the workspace's grant gives neither.
        const results = await reach(work, [
          ["rename", git, join(work, "moved-git")],
          ["mkdir", join(work, "other")],
          ["rename", join(work, "other"), join(work, "other-moved")],
        ]);
        await hold.release();

        expect(results).toEqual(["EPERM", "done", "done"]);
      },
    );

    it(
      "is not held where apps may remove what the folder it is in holds, and keeps its permissions",
      { timeout: 120_000 },
      async () => {
        const { work, git, before } = await workspace();
        // Every app given the right to remove anything in the workspace.
        execFileSync("icacls", [work, "/grant", "*S-1-15-2-1:(DC)"], {
          stdio: "ignore",
        });
        const holds = heldIn(await folders.make("zhiyin-tree-data-"));

        const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);

        expect(hold.held).toEqual([]);
        expect(hold.failed).toEqual([
          {
            path: git,
            reason: expect.stringContaining("cannot keep it in place"),
          },
        ]);
        expect(permissions(git)).toBe(before.get(git));
      },
    );

    it(
      "gets its permissions back only on the same folder, never on what a link put under its name leads to",
      { timeout: 120_000 },
      async () => {
        const { work, git } = await workspace();
        const elsewhere = await folders.make("zhiyin-tree-elsewhere-");
        const elsewhereBefore = permissions(elsewhere);
        const holds = heldIn(await folders.make("zhiyin-tree-data-"));
        const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);

        // The person moves the folder away and leaves a junction in its place.
        await rename(git, join(work, "moved-git"));
        await symlink(elsewhere, git, "junction");
        await hold.release();

        expect(permissions(elsewhere)).toBe(elsewhereBefore);
      },
    );
  },
);

describe.runIf(process.platform === "win32")(
  "a folder whose hold was cut short",
  () => {
    it(
      "gets its own permissions back whole at the next start, what it holds taking from it again",
      { timeout: 120_000 },
      async () => {
        const { work, git, before } = await workspace();
        const data = await folders.make("zhiyin-tree-data-");
        let stopped: () => void = () => undefined;
        let reached: () => void = () => undefined;
        const atCrash = new Promise<void>((resolve) => (reached = resolve));
        // Stopped once its journal is written and the folder kept in place,
        // before its permissions are set by name, as a crash would stop it.
        const holding = heldIn(data, {
          walks: new Walks(),
          beforeTree: () => {
            reached();
            return new Promise<void>((resolve) => (stopped = resolve));
          },
        }).hold(work, [{ path: git, hold: "tree" }]);
        await atCrash;
        const cut = permissions(git);

        await heldIn(data, { walks: new Walks() }).restored;
        const back = new Map(
          [...before.keys()].map((path) => [path, permissions(path)]),
        );
        stopped();
        await (await holding).release();

        expect(cut).not.toBe(before.get(git));
        expect(back).toEqual(before);
      },
    );
  },
);

describe.runIf(process.platform === "win32")("this test", () => {
  it("has this repository's `.git` folder to copy", () => {
    expect(isFolder).toBe(true);
  });
});

describe.runIf(process.platform === "win32")(
  "a folder whose hold failed and could not be undone",
  () => {
    it(
      "stays written down, and gets its own permissions back at the next start",
      { timeout: 120_000 },
      async () => {
        const work = await folders.make("zhiyin-tree-work-");
        const records = join(work, "records");
        await mkdir(records);
        await writeFile(join(records, "config"), "settings");
        // The folder given to programs first, as before any run.
        await reach(work, [["read", join(records, "config")]]);
        const before = new Map(
          [records, join(records, "config")].map((path) => [
            path,
            permissions(path),
          ]),
        );
        const data = await folders.make("zhiyin-tree-data-");
        // Windows keeps the folder in place, then refuses to set its
        // permissions by name and to undo that.
        let sets = 0;
        const holds = heldIn(data, {
          walks: new Walks(),
          calls: (real) => ({
            ...real,
            set: (handle, given) =>
              ++sets === 1 ? real.set(handle, given) : "Access is denied.",
            setTree: async () => "Access is denied.",
          }),
        });
        const held = await holds.hold(work, [{ path: records, hold: "tree" }]);
        const left = permissions(records);
        await held.release();

        await heldIn(data, { walks: new Walks() }).restored;
        const back = new Map(
          [...before.keys()].map((path) => [path, permissions(path)]),
        );

        expect(held.failed).toEqual([
          { path: records, reason: "Access is denied." },
        ]);
        expect(left).not.toBe(before.get(records));
        expect(back).toEqual(before);
      },
    );
  },
);
