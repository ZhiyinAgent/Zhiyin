import { execFileSync, spawn } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  confine,
  forgetConfinement,
  openProcessContainer,
  runProcess,
  type Confinement,
} from "../src/index.js";
import { folderGrants, windowsPermissions } from "../src/folder-grants.js";
import { allGone, alive, until } from "./processes.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const folders = new TemporaryFolders();
const kept = new TemporaryFolders();
/** Homes given this test, whose containers go with them. */
const homes: string[] = [];
afterEach(async () => {
  for (const each of homes.splice(0)) forgetConfinement(purpose, each);
  await folders.removeAll();
});
afterAll(() => kept.removeAll());

/**
 * Node, and the fixture it runs, copied to a folder of their own: the
 * container reads only what it is given, and the copy keeps the grant away
 * from the Node and the repository this test runs from.
 */
let programs = "";
beforeAll(async () => {
  programs = await kept.make("zhiyin-confined-programs-");
  await copyFile(process.execPath, join(programs, "node.exe"));
  await copyFile(join(fixtures, "reach.mjs"), join(programs, "reach.mjs"));
});

/**
 * Node looks at every folder above its script unless told not to, and a
 * container may not look at the drive's root.
 */
const node = ["--preserve-symlinks-main", "--preserve-symlinks"];

/** Runs of this purpose share a profile with no run of the app's. */
const purpose = "test";

/** A home of a run's own, which it is given in place of the person's folders. */
async function home(): Promise<string> {
  const made = await folders.make("zhiyin-confined-home-");
  homes.push(made);
  return made;
}

function given(
  confinement: Partial<Confinement> & { readonly home: string },
): Confinement {
  return {
    purpose,
    read: [],
    write: [],
    network: false,
    ...confinement,
  };
}

/** What a confined process could do of each operation, in order. */
async function reach(
  confinement: Partial<Confinement>,
  operations: readonly (readonly unknown[])[],
): Promise<unknown[]> {
  const asked = given({ home: await home(), ...confinement });
  const confined = await confine({ ...asked, read: [programs, ...asked.read] });
  const output = await folders.make("zhiyin-confined-output-");
  const container = openProcessContainer();
  try {
    const child = container.launch({
      executable: join(programs, "node.exe"),
      arguments: [
        ...node,
        join(programs, "reach.mjs"),
        JSON.stringify(operations),
      ],
      cwd: programs,
      stdout: join(output, "stdout.txt"),
      stderr: join(output, "stderr.txt"),
      confined,
    });
    const code = await child.wait();
    const printed = await readFile(join(output, "stdout.txt"), "utf8");
    if (code !== 0)
      throw new Error(
        `The confined process ended with ${code}: ${await readFile(join(output, "stderr.txt"), "utf8")}`,
      );
    return JSON.parse(printed) as unknown[];
  } finally {
    container.close();
  }
}

/** Part of a file's security as Windows writes it, or "" for none. */
function security(path: string, information: number): string {
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
  if (
    GetNamedSecurityInfoW(
      path,
      1,
      information,
      null,
      null,
      null,
      null,
      descriptor,
    ) !== 0
  )
    throw new Error(`The security of ${path} could not be read.`);
  const text: unknown[] = [null];
  ToText(descriptor[0], 1, information, text, null);
  const written = text[0]
    ? (koffi.decode(text[0], "char16_t", -1) as string)
    : "";
  LocalFree(text[0]);
  LocalFree(descriptor[0]);
  return written;
}

/** A folder's integrity label as Windows writes it, or "" for none. */
const label = (path: string) => security(path, 0x10);

/** A file's permissions as Windows writes them. */
const permissions = (path: string) => security(path, 0x4);

describe.runIf(process.platform === "win32")("a confined process", () => {
  it("reads the folders it may read, and changes nothing in them", async () => {
    const shared = await folders.make("zhiyin-confined-read-");
    const file = join(shared, "kept.txt");
    await writeFile(file, "the person's own");

    const results = await reach({ read: [shared] }, [
      ["read", file],
      ["write", join(shared, "new.txt")],
      ["append", file],
      ["delete", file],
    ]);

    expect(results).toEqual(["the person's own", "EPERM", "EPERM", "EPERM"]);
    expect(await readFile(file, "utf8")).toBe("the person's own");
    expect(await readdir(shared)).toEqual(["kept.txt"]);
  });

  it("changes the folders it may change: new files, what they held, and what is added to them later", async () => {
    const work = await folders.make("zhiyin-confined-write-");
    await mkdir(join(work, "held before"));
    await writeFile(join(work, "held before", "old.txt"), "the person's own");
    await writeFile(join(work, "to remove.txt"), "the person's own");
    await confine(
      given({ home: await home(), read: [programs], write: [work] }),
    );
    await mkdir(join(work, "added later"));

    const results = await reach({ write: [work] }, [
      ["write", join(work, "new.txt")],
      ["append", join(work, "held before", "old.txt")],
      ["write", join(work, "held before", "new.txt")],
      ["write", join(work, "added later", "new.txt")],
      ["mkdir", join(work, "made")],
      ["rename", join(work, "new.txt"), join(work, "made", "renamed.txt")],
      ["delete", join(work, "to remove.txt")],
    ]);

    expect(results).toEqual(Array(7).fill("done"));
    expect(await readFile(join(work, "held before", "old.txt"), "utf8")).toBe(
      "the person's own and appended",
    );
    expect(await readFile(join(work, "made", "renamed.txt"), "utf8")).toBe(
      "written confined",
    );
    expect((await readdir(work)).sort()).toEqual(
      ["added later", "held before", "made"].sort(),
    );
  });

  it("reaches a folder removed and made again at the same path, as a reset environment is", async () => {
    const parent = await folders.make("zhiyin-confined-remade-");
    const work = join(parent, "environment");
    await mkdir(work);
    await writeFile(join(work, "kept.txt"), "first");
    const first = await reach({ write: [work] }, [
      ["read", join(work, "kept.txt")],
    ]);

    await rm(work, { recursive: true });
    await mkdir(work);
    await writeFile(join(work, "kept.txt"), "second");
    const second = await reach({ write: [work] }, [
      ["read", join(work, "kept.txt")],
      ["write", join(work, "new.txt")],
    ]);

    expect(first).toEqual(["first"]);
    expect(second).toEqual(["second", "done"]);
  });

  it("reaches nothing else the person keeps, nor what a junction in its folder leads to", async () => {
    const parent = await folders.make("zhiyin-confined-beside-");
    const work = join(parent, "work");
    const beside = join(parent, "beside");
    await mkdir(work);
    await mkdir(beside);
    await writeFile(join(beside, "secret.txt"), "the person's secret");
    await symlink(beside, join(work, "linked"), "junction");

    const results = await reach({ write: [work] }, [
      ["read", join(beside, "secret.txt")],
      ["write", join(beside, "new.txt")],
      ["read", join(work, "linked", "secret.txt")],
      ["write", join(work, "linked", "new.txt")],
      ["list", parent],
      ["list", homedir()],
    ]);

    expect(results).toEqual(Array(6).fill("EPERM"));
    expect(await readdir(beside)).toEqual(["secret.txt"]);
  });

  it("leaves the integrity label of the folders it is given as it was", async () => {
    const work = await folders.make("zhiyin-confined-label-");
    const shared = await folders.make("zhiyin-confined-label-read-");
    const before = [label(work), label(shared)];

    const results = await reach({ read: [shared], write: [work] }, [
      ["write", join(work, "new.txt")],
    ]);

    expect(results).toEqual(["done"]);
    expect([label(work), label(shared)]).toEqual(before);
  });

  it("starts what it starts confined the same way", async () => {
    const parent = await folders.make("zhiyin-confined-child-");
    const work = join(parent, "work");
    await mkdir(work);
    await writeFile(join(parent, "secret.txt"), "the person's secret");

    const results = await reach({ write: [work] }, [
      [
        "child",
        [
          ["read", join(parent, "secret.txt")],
          ["write", join(parent, "new.txt")],
          ["write", join(work, "from the child.txt")],
        ],
      ],
    ]);

    expect(results).toEqual([["EPERM", "EPERM", "done"]]);
  });

  it(
    "reaches the internet only when it is asked to",
    { timeout: 60_000 },
    async () => {
      const without = await reach({ network: false }, [
        ["connect", "1.1.1.1", 443],
      ]);
      const withNetwork = await reach({ network: true }, [
        ["connect", "1.1.1.1", 443],
      ]);

      expect(without).not.toEqual(["connected"]);
      expect(withNetwork).toEqual(["connected"]);
    },
  );

  it("keeps its user folder, application data and temporary files in the home it is given", async () => {
    const own = await home();

    const left = await reach({ home: own }, [
      ["leave", "USERPROFILE", "home.txt"],
      ["leave", "APPDATA", "roaming.txt"],
      ["leave", "LOCALAPPDATA", "local.txt"],
      ["temporary"],
    ]);

    // Each is where it wrote a file, inside its home.
    expect(left).toHaveLength(4);
    for (const path of left) {
      expect(String(path)).toMatch(/^[A-Za-z]:\\/);
      expect(
        String(path).toLowerCase().startsWith(`${own.toLowerCase()}\\`),
      ).toBe(true);
    }
  });

  it("finds what it left in its home on its next run, and a run given another home cannot reach it", async () => {
    const own = await home();
    const [left] = await reach({ home: own }, [
      ["leave", "APPDATA", "settings.txt"],
    ]);

    const again = await reach({ home: own }, [["read", left]]);
    const another = await reach({ home: await home() }, [["read", left]]);

    expect(again).toEqual(["left in APPDATA"]);
    expect(another).toEqual(["EPERM"]);
  });

  /**
   * Windows gives every container a folder of its own in the person's
   * profile, which it may change. A run given another home runs in another
   * container, so nothing one run leaves there reaches it, with the internet
   * or without.
   */
  it("leaves nothing in Windows' own folder for its container that a run given another home can read", async () => {
    const packages = join(
      process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
      "Packages",
    );
    const first = await home();
    await reach({ home: first }, [["env", "USERPROFILE"]]);
    const theirs = (await readdir(packages))
      .filter((name) => name.toLowerCase().startsWith(`zhiyin.${purpose}`))
      .map((name) => join(packages, name, "AC", "left.txt"));
    const wrote = await reach(
      { home: first },
      theirs.map((path) => ["write", path]),
    );
    const left = theirs.filter((_, index) => wrote[index] === "done");

    const another = await reach(
      { home: await home(), network: true },
      left.map((path) => ["read", path]),
    );

    expect(left).toHaveLength(1);
    expect(another).toEqual(["EPERM"]);
  });

  it("keeps no container in the person's profile for a home that is forgotten", async () => {
    const packages = join(
      process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
      "Packages",
    );
    const ours = async () =>
      (await readdir(packages)).filter((name) =>
        name.toLowerCase().startsWith(`zhiyin.${purpose}.`),
      );
    const own = await home();
    const before = await ours();
    await reach({ home: own }, [["env", "USERPROFILE"]]);
    const during = await ours();

    forgetConfinement(purpose, own);

    expect(during.filter((name) => !before.includes(name))).toHaveLength(1);
    expect(await ours()).toEqual(before);
  });

  it("reaches the folders its own run is given, not those given to another run of its purpose", async () => {
    const first = await folders.make("zhiyin-confined-first-");
    const second = await folders.make("zhiyin-confined-second-");
    await writeFile(join(first, "kept.txt"), "the first folder's");
    await writeFile(join(second, "kept.txt"), "the second folder's");

    const firstRun = await reach({ write: [first] }, [
      ["read", join(first, "kept.txt")],
    ]);
    const secondRun = await reach({ write: [second] }, [
      ["read", join(first, "kept.txt")],
      ["write", join(first, "new.txt")],
      ["read", join(second, "kept.txt")],
    ]);

    expect(firstRun).toEqual(["the first folder's"]);
    expect(secondRun).toEqual(["EPERM", "EPERM", "the second folder's"]);
  });

  it.each([
    {
      from: "a folder that hands its permissions on to what it holds",
      handsOn: true,
      write: (folder: string) =>
        execFileSync("icacls", [
          folder,
          "/grant",
          "*S-1-5-32-545:(OI)(CI)(RX)",
        ]),
    },
    {
      // Windows then reads the moved file's permissions as its own, apart
      // from its new folder's, and hands that folder's grant on past it.
      from: "a folder whose permissions an older program wrote",
      handsOn: false,
      write: (folder: string) =>
        execFileSync("cacls", [
          folder,
          "/E",
          "/G",
          `${process.env["USERNAME"] ?? ""}:F`,
        ]),
    },
  ])(
    "reaches a file moved into its folder from $from, once a later session of the app gives it the folder",
    { timeout: 60_000 },
    async ({ handsOn, write }) => {
      const parent = await folders.make("zhiyin-confined-moved-");
      const work = join(parent, "work");
      const elsewhere = join(parent, "elsewhere");
      await mkdir(work);
      await mkdir(elsewhere);
      write(elsewhere);
      expect(permissions(elsewhere).startsWith("D:AI")).toBe(handsOn);
      await confine(
        given({ home: await home(), read: [programs], write: [work] }),
      );
      await writeFile(join(parent, "elsewhere", "moved.txt"), "moved in");
      // A move on one drive keeps the permissions the file had.
      await rename(
        join(parent, "elsewhere", "moved.txt"),
        join(work, "moved.txt"),
      );

      const sessionHome = await home();
      const reported = await new Promise<string>((resolve, reject) => {
        const session = spawn(
          process.execPath,
          [
            "--experimental-strip-types",
            "--no-warnings",
            join(fixtures, "session.mts"),
            purpose,
            sessionHome,
            work,
            programs,
            JSON.stringify([["read", join(work, "moved.txt")]]),
            JSON.stringify(["moved in"]),
          ],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "";
        let err = "";
        session.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        session.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
        session.on("error", reject);
        session.on("close", () => resolve(out || err));
      });

      expect(reported).toBe(JSON.stringify(["moved in"]));
    },
  );

  it("reaches a file and a folder in its folder whose permissions are kept apart from the folder's, and keeps them apart", async () => {
    const work = await folders.make("zhiyin-confined-apart-");
    await writeFile(join(work, "apart.txt"), "kept apart");
    await mkdir(join(work, "apart"));
    await writeFile(join(work, "apart", "inside.txt"), "inside");
    // Copies what they had from the folder as their own, and take no more.
    execFileSync("icacls", [join(work, "apart.txt"), "/inheritance:d"]);
    execFileSync("icacls", [join(work, "apart"), "/inheritance:d"]);

    const results = await reach({ write: [work] }, [
      ["read", join(work, "apart.txt")],
      ["read", join(work, "apart", "inside.txt")],
      ["write", join(work, "apart", "new.txt")],
    ]);

    expect(results).toEqual(["kept apart", "inside", "done"]);
    expect(permissions(join(work, "apart.txt"))).toMatch(/^D:PAI/);
  });

  it("gives nothing through a junction that takes an entry's place while its folder is granted", async () => {
    const parent = await folders.make("zhiyin-confined-swapped-");
    const work = join(parent, "work");
    const beside = join(parent, "beside");
    await mkdir(join(work, "apart"), { recursive: true });
    await mkdir(beside);
    await writeFile(join(beside, "secret.txt"), "the person's secret");
    execFileSync("icacls", [join(work, "apart"), "/inheritance:d"]);
    const windows = windowsPermissions();
    // The folder kept apart becomes a junction to another folder just as the
    // grant comes to give it the entry directly.
    const swapping: typeof windows = {
      ...windows,
      reach(path, sid, mask, within) {
        if (path === join(work, "apart")) {
          rmSync(path, { recursive: true });
          symlinkSync(beside, path, "junction");
        }
        return windows.reach(path, sid, mask, within);
      },
    };
    await folderGrants(() => swapping).grantAll([
      { folder: work, access: "write" },
    ]);

    const results = await reach({ write: [work] }, [
      ["read", join(beside, "secret.txt")],
      ["read", join(work, "apart", "secret.txt")],
    ]);

    expect(results).toEqual(["EPERM", "EPERM"]);
  });

  it("ends with everything it started when its container closes", async () => {
    const work = await folders.make("zhiyin-confined-ends-");
    const confined = await confine(
      given({ home: await home(), read: [programs], write: [work] }),
    );
    const container = openProcessContainer();
    container.launch({
      executable: join(programs, "node.exe"),
      arguments: [
        ...node,
        join(programs, "reach.mjs"),
        JSON.stringify([
          ["pid", join(work, "parent.pid")],
          [
            "child",
            [
              ["pid", join(work, "child.pid")],
              ["sleep", 60_000],
            ],
          ],
        ]),
      ],
      cwd: programs,
      stdout: join(work, "stdout.txt"),
      stderr: join(work, "stderr.txt"),
      confined,
    });
    const pids = await until(async () => {
      const read = await Promise.all(
        ["parent.pid", "child.pid"].map((name) =>
          readFile(join(work, name), "utf8").then(Number, () => undefined),
        ),
      );
      return read.every((pid) => pid !== undefined && Number.isInteger(pid))
        ? (read as number[])
        : undefined;
    });
    expect(pids.every(alive)).toBe(true);

    container.close();

    await allGone(pids);
  });

  it("refuses a whole drive, a folder that holds the person's user folder, a folder that is not there and a purpose it cannot name, saying why", async () => {
    const missing = join(
      await folders.make("zhiyin-confined-missing-"),
      "not there",
    );

    await expect(
      confine(given({ home: await home(), read: [parse(tmpdir()).root] })),
    ).rejects.toThrow(/whole drive/);
    await expect(
      confine(given({ home: await home(), write: [homedir()] })),
    ).rejects.toThrow(/user folder/);
    await expect(
      confine(given({ home: await home(), read: [dirname(homedir())] })),
    ).rejects.toThrow(/user folder/);
    await expect(
      confine(given({ home: await home(), write: [missing] })),
    ).rejects.toThrow(/not there/);
    await expect(
      confine(given({ home: await home(), purpose: "A purpose!" })),
    ).rejects.toThrow(/purpose/);
  });
});

describe.runIf(process.platform === "win32")(
  "a confined run on the shared path",
  () => {
    it("runs the program confined", async () => {
      const parent = await folders.make("zhiyin-confined-run-");
      const work = join(parent, "work");
      await mkdir(work);
      await writeFile(join(parent, "secret.txt"), "the person's secret");

      const run = await runProcess({
        executable: join(programs, "node.exe"),
        arguments: [
          ...node,
          join(programs, "reach.mjs"),
          JSON.stringify([
            ["read", join(parent, "secret.txt")],
            ["write", join(work, "new.txt")],
          ]),
        ],
        cwd: programs,
        timeoutMs: 30_000,
        containment: { open: openProcessContainer },
        confinement: given({
          home: await home(),
          read: [programs],
          write: [work],
        }),
      });

      expect(JSON.parse(run.stdout)).toEqual(["EPERM", "done"]);
    });

    it("is refused without containment, and nothing runs", async () => {
      const work = await folders.make("zhiyin-confined-uncontained-");

      const run = await runProcess({
        executable: join(programs, "node.exe"),
        arguments: [
          ...node,
          join(programs, "reach.mjs"),
          JSON.stringify([["write", join(work, "new.txt")]]),
        ],
        cwd: programs,
        timeoutMs: 30_000,
        confinement: given({
          home: await home(),
          read: [programs],
          write: [work],
        }),
      });

      expect(run).toMatchObject({ exitCode: null, failure: "containment" });
      expect(await readdir(work)).toEqual([]);
    });

    it("says why when a folder cannot be given, and nothing runs", async () => {
      const work = await folders.make("zhiyin-confined-refused-");

      const run = await runProcess({
        executable: join(programs, "node.exe"),
        arguments: [
          ...node,
          join(programs, "reach.mjs"),
          JSON.stringify([["write", join(work, "new.txt")]]),
        ],
        cwd: programs,
        timeoutMs: 30_000,
        containment: { open: openProcessContainer },
        confinement: given({
          home: await home(),
          read: [programs, parse(tmpdir()).root],
          write: [work],
        }),
      });

      expect(run).toMatchObject({
        exitCode: null,
        failure: "confinement",
        reason: expect.stringMatching(/whole drive/),
      });
      expect(await readdir(work)).toEqual([]);
    });
  },
);
