/**
 * Paths held against sealed-off programs, tried by a real confined process
 * on real files: what it may still do to a held path and around it, and that
 * each path gets its own permissions back, after the hold or at the next
 * start when Zhiyin stopped holding it.
 */

import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { replaceFile } from "@zhiyin/files";
import { holdOpen, TemporaryFolders } from "@zhiyin/test-support";
import {
  confine,
  forgetConfinement,
  openProcessContainer,
  readOnlyHolds,
} from "../src/index.js";
import { folderGrants, windowsPermissions } from "../src/folder-grants.js";
import { sessionWalks } from "../src/permission-walks.js";

/** The holds kept in this data folder, as the app keeps them. */
const heldIn = (
  directory: string,
  options: Omit<Parameters<typeof readOnlyHolds>[1], "replace"> = {},
) => readOnlyHolds(directory, { ...options, replace: replaceFile });

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
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
beforeAll(async () => {
  programs = await kept.make("zhiyin-held-programs-");
  await copyFile(process.execPath, join(programs, "node.exe"));
  await copyFile(join(fixtures, "reach.mjs"), join(programs, "reach.mjs"));
});

/** What a process confined to change `work` could do of each operation. */
async function reach(
  work: string,
  operations: readonly (readonly unknown[])[],
): Promise<unknown[]> {
  const home = await folders.make("zhiyin-held-home-");
  homes.push(home);
  const confined = await confine({
    purpose,
    home,
    read: [programs],
    write: [work],
    hosts: [],
  });
  const output = await folders.make("zhiyin-held-output-");
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
    const code = await child.wait();
    if (code !== 0)
      throw new Error(await readFile(join(output, "stderr.txt"), "utf8"));
    return JSON.parse(await readFile(join(output, "stdout.txt"), "utf8"));
  } finally {
    container.close();
  }
}

/** A path's permissions as Windows writes them. */
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

/** A workspace with a large file and a file beside it. */
async function workspace() {
  const work = await folders.make("zhiyin-held-work-");
  await mkdir(join(work, "data"));
  await writeFile(join(work, "data", "big.parquet"), "the person's data");
  await writeFile(join(work, "data", "beside.txt"), "the person's notes");
  return work;
}

describe.runIf(process.platform === "win32")("a path held read-only", () => {
  it("is read by a sealed-off program, which can neither overwrite, append to, delete, rename nor replace it, while the rest of its folder stays writable", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const hold = await holds.hold(work, [{ path: big, hold: "read-only" }]);

    const results = await reach(work, [
      ["read", big],
      ["write", big],
      ["append", big],
      ["delete", big],
      ["rename", big, join(work, "data", "moved.parquet")],
      ["write", join(work, "data", "other.parquet")],
      ["rename", join(work, "data", "other.parquet"), big],
      ["append", join(work, "data", "beside.txt")],
      ["write", join(work, "data", "new.txt")],
    ]);
    await hold.release();

    expect(hold).toMatchObject({ held: [big], failed: [] });
    expect(results).toEqual([
      "the person's data",
      "EPERM",
      "EPERM",
      "EPERM",
      "EPERM",
      "done",
      "EPERM",
      "done",
      "done",
    ]);
    expect(await readFile(big, "utf8")).toBe("the person's data");
  });

  it("gets back exactly the permissions it had once the hold is let go", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    // Granted as a run would, so its permissions carry the grant.
    await reach(work, [["read", big]]);
    const before = permissions(big);

    const hold = await holds.hold(work, [{ path: big, hold: "read-only" }]);
    const during = permissions(big);
    await hold.release();

    expect(during).not.toBe(before);
    expect(permissions(big)).toBe(before);
    expect(await reach(work, [["append", big]])).toEqual(["done"]);
  });

  it("is a folder that takes no new entry and cannot be moved, though what it holds keeps the permissions it had", async () => {
    const work = await workspace();
    const hooks = join(work, ".git", "hooks");
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, "pre-commit.sample"), "sample");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const hold = await holds.hold(work, [{ path: hooks, hold: "read-only" }]);

    const results = await reach(work, [
      ["list", hooks],
      ["write", join(hooks, "pre-commit")],
      ["rename", hooks, join(work, ".git", "moved")],
      ["append", join(hooks, "pre-commit.sample")],
    ]);
    await hold.release();

    expect(results).toEqual(["pre-commit.sample", "EPERM", "EPERM", "done"]);
    expect(await readdir(hooks)).toEqual(["pre-commit.sample"]);
  });

  it("is held while another program briefly holds the record of what is held open", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const beside = join(work, "data", "beside.txt");
    const data = await folders.make("zhiyin-held-data-");
    const holds = heldIn(data);
    const first = await holds.hold(work, [{ path: big, hold: "read-only" }]);
    const release = holdOpen(join(data, "held-permissions.json"));
    setTimeout(release, 300);

    const second = await holds.hold(work, [
      { path: beside, hold: "read-only" },
    ]);
    await second.release();
    await first.release();

    expect(second).toMatchObject({ held: [beside], failed: [] });
  });

  it("is read when the folder it is in was never given to a program before", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const hold = await holds.hold(work, [{ path: big, hold: "read-only" }]);

    const results = await reach(work, [
      ["read", big],
      ["write", big],
    ]);
    await hold.release();

    expect(results).toEqual(["the person's data", "EPERM"]);
  });

  it("stays held while a grant of its folder is written again", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const hold = await holds.hold(work, [{ path: big, hold: "read-only" }]);

    // Another session's grant of the folder, written behind, as a run's is.
    await folderGrants(windowsPermissions, sessionWalks).grantAll([
      { folder: work, access: "write" },
    ]);
    await sessionWalks.run(async () => undefined, false);
    const results = await reach(work, [["write", big]]);
    await hold.release();

    expect(results).toEqual(["EPERM"]);
  });

  it("is held as long as its last holder holds it", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const first = await holds.hold(work, [{ path: big, hold: "read-only" }]);
    const second = await holds.hold(work, [{ path: big, hold: "read-only" }]);

    await first.release();
    const whileSecond = await reach(work, [["write", big]]);
    await second.release();
    const after = await reach(work, [["append", big]]);

    expect(whileSecond).toEqual(["EPERM"]);
    expect(after).toEqual(["done"]);
  });
});

describe.runIf(process.platform === "win32")("a path held in place", () => {
  it("is a folder that cannot be moved or deleted, while what it holds can be changed and added to", async () => {
    const work = await workspace();
    const data = join(work, "data");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const hold = await holds.hold(work, [{ path: data, hold: "in-place" }]);

    const results = await reach(work, [
      ["rename", data, join(work, "moved")],
      ["write", join(data, "new.txt")],
      ["append", join(data, "beside.txt")],
      ["mkdir", join(data, "made")],
    ]);
    await hold.release();

    expect(results).toEqual(["EPERM", "done", "done", "done"]);
  });
});

describe.runIf(process.platform === "win32")("what a hold left behind", () => {
  it("is put back at the next start when Zhiyin stopped while holding it", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const data = await folders.make("zhiyin-held-data-");
    await reach(work, [["read", big]]);
    const before = permissions(big);
    // Held, and never let go of: Zhiyin stopped.
    await heldIn(data).hold(work, [{ path: big, hold: "read-only" }]);
    expect(permissions(big)).not.toBe(before);

    const next = heldIn(data);
    await next.restored;

    expect(permissions(big)).toBe(before);
    expect(await readdir(data)).toEqual([]);
  });

  it("is put back only on the same file, never on one that took its name since", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const hold = await holds.hold(work, [{ path: big, hold: "read-only" }]);

    // The person replaces the file while it is held.
    await rm(big);
    await writeFile(big, "the person's new data");
    const fresh = permissions(big);
    await hold.release();

    expect(permissions(big)).toBe(fresh);
  });
});

/** A drive letter no drive uses now. */
function freeLetter(): string {
  for (const letter of "QRSTUVWXYZ")
    if (!existsSync(`${letter}:\\`)) return letter;
  throw new Error("No drive letter is free for this test.");
}

/** A drive letter for `folder`, as `subst` makes one, that can be taken away. */
function substitute(letter: string, folder: string) {
  execFileSync("subst", [`${letter}:`, folder], { stdio: "ignore" });
  return () => execFileSync("subst", [`${letter}:`, "/d"], { stdio: "ignore" });
}

describe.runIf(process.platform === "win32")(
  "a path held on a drive that is not there at the next start",
  () => {
    it("keeps its journal entry, through later holds and lets go, until the drive is back and it gets its permissions back", async () => {
      const work = await workspace();
      const big = join(work, "data", "big.parquet");
      const other = join(work, "data", "beside.txt");
      await reach(work, [["read", big]]);
      const before = permissions(big);
      const data = await folders.make("zhiyin-held-data-");
      const letter = freeLetter();
      let remove = substitute(letter, work);
      const onDrive = `${letter}:\\data\\big.parquet`;
      try {
        // Held by its path on the drive, and never let go of: Zhiyin stopped.
        const first = await heldIn(data).hold(work, [
          { path: onDrive, hold: "read-only" },
        ]);
        expect(first.held).toEqual([onDrive]);
        remove();

        // The next start, with the drive gone; a hold made and let go of then.
        const next = heldIn(data);
        await next.restored;
        const later = await next.hold(work, [
          { path: other, hold: "read-only" },
        ]);
        await later.release();
        const kept = await readFile(
          join(data, "held-permissions.json"),
          "utf8",
        );

        remove = substitute(letter, work);
        await heldIn(data).restored;

        expect(kept).toContain("big.parquet");
        expect(permissions(big)).toBe(before);
        expect(await readdir(data)).toEqual([]);
      } finally {
        try {
          remove();
        } catch {
          // Already taken away.
        }
      }
    });
  },
);

describe.runIf(process.platform === "win32")("whether a path is held", () => {
  it("agrees with what a sealed-off program may write while it is held, and is nothing once the hold is let go", async () => {
    const work = await workspace();
    const big = join(work, "data", "big.parquet");
    const beside = join(work, "data", "beside.txt");
    const hooks = join(work, ".git", "hooks");
    const startup = join(work, "Startup");
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, "pre-commit.sample"), "sample");
    await mkdir(startup);
    const holds = heldIn(await folders.make("zhiyin-held-data-"));
    const hold = await holds.hold(work, [
      { path: big, hold: "read-only" },
      { path: hooks, hold: "read-only" },
      { path: startup, hold: "tree" },
    ]);
    const asked = [
      big,
      join(hooks, "pre-commit"),
      join(startup, "run.cmd"),
      join(startup, "deeper", "run.cmd"),
      join(hooks, "pre-commit.sample"),
      beside,
      join(work, "data", "new.txt"),
    ];

    const held = await Promise.all(asked.map((path) => holds.heldAt(path)));
    const results = await reach(work, [
      ["write", asked[0]],
      ["write", asked[1]],
      ["write", asked[2]],
      ["mkdir", join(startup, "deeper")],
      ["append", asked[4]],
      ["append", asked[5]],
      ["write", asked[6]],
    ]);
    await hold.release();
    const after = await Promise.all(asked.map((path) => holds.heldAt(path)));

    expect(held).toEqual([true, true, true, true, false, false, false]);
    expect(results).toEqual([
      "EPERM",
      "EPERM",
      "EPERM",
      "EPERM",
      "done",
      "done",
      "done",
    ]);
    expect(after).toEqual(asked.map(() => false));
  });
});
