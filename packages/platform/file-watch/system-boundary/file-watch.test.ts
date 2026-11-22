import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  FileWatch,
  journalChanges,
  journalPoint,
  sourceWatchThread,
  type SavedFile,
} from "../src/index.js";
import { Contained } from "@zhiyin/sandbox/testing";

const folders = new TemporaryFolders();
const contained = new Contained(folders);
const watches: FileWatch[] = [];

afterEach(async () => {
  for (const watch of watches.splice(0)) await watch.close();
});
afterAll(async () => {
  contained.forget();
  await folders.removeAll();
});

const digest = (path: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (data) => hash.update(data))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

/** A watch whose saves are kept, each with when it was reported. */
async function watching() {
  const saved: (SavedFile & { at: number })[] = [];
  const unsaved: string[] = [];
  const watch = new FileWatch(
    sourceWatchThread,
    await folders.make("zhiyin-watch-staging-"),
    {
      saved: (file) => saved.push({ ...file, at: Date.now() }),
      unsaved: (_root, path) => unsaved.push(path),
    },
  );
  watches.push(watch);
  return { watch, saved, unsaved };
}

async function bigFile(path: string, mib: number) {
  await mkdir(dirname(path), { recursive: true });
  const parts: Buffer[] = [];
  for (let at = 0; at < mib; at += 16) parts.push(randomBytes(16 << 20));
  await writeFile(path, Buffer.concat(parts));
}

describe.runIf(process.platform === "win32")(
  "a watched file, changed by a program in an app container",
  { timeout: 180_000 },
  () => {
    const cases: [string, (big: string) => string[][]][] = [
      ["written", (big) => [["write", big]]],
      ["renamed", (big) => [["rename", big, `${big}.moved`]]],
      ["deleted", (big) => [["delete", big]]],
      [
        "moved with the folder above it",
        (big) => [["rename", dirname(big), join(dirname(big), "..", "moved")]],
      ],
    ];
    for (const [label, ops] of cases)
      it(`waits until it is saved, then is ${label}`, async () => {
        const work = await folders.make("zhiyin-watch-work-");
        const big = join(work, "data", "big.bin");
        await bigFile(big, 64);
        const before = await digest(big);
        const confined = await contained.grant(work);
        const { watch, saved } = await watching();

        expect(await watch.watch(work, [big])).toEqual(new Map());
        const [done] = await contained.run(confined, ops(big));

        expect(done!.result).toBe("done");
        expect(saved).toHaveLength(1);
        expect(saved[0]!.path).toBe(big);
        expect(await digest(saved[0]!.staged)).toBe(before);
        // The program's operation ended after the save was on disk.
        expect(done!.end).toBeGreaterThanOrEqual(saved[0]!.at - 50);
        expect(saved[0]!.waitedMs).toBeGreaterThanOrEqual(0);
        expect(watch.count).toBe(0);
      });

    it("lets it be read without waiting or saving it", async () => {
      const work = await folders.make("zhiyin-watch-work-");
      const big = join(work, "big.bin");
      await bigFile(big, 64);
      const confined = await contained.grant(work);
      const { watch, saved } = await watching();
      await watch.watch(work, [big]);

      const [read] = await contained.run(confined, [["read", big]]);

      expect(read!.result).toBe(64 << 20);
      expect(saved).toEqual([]);
      expect(watch.watches(big)).toBe(true);
    });

    it("is never held through a junction, nor when it is one: what the link leads to is not saved", async () => {
      const work = await folders.make("zhiyin-watch-work-");
      const outside = await folders.make("zhiyin-watch-outside-");
      const secret = join(outside, "secret.txt");
      await writeFile(secret, "the person's key");
      await symlink(outside, join(work, "elsewhere"), "junction");
      await symlink(outside, join(work, "door"), "junction");
      const { watch, saved } = await watching();

      const failures = await watch.watch(work, [
        join(work, "elsewhere", "secret.txt"),
        join(work, "door"),
      ]);
      // What the junction leads to is changed; nothing waits for it.
      await writeFile(secret, "changed outside");

      expect([...failures.keys()]).toEqual([
        join(work, "elsewhere", "secret.txt"),
        join(work, "door"),
      ]);
      for (const reason of failures.values())
        expect(reason).toMatch(/link is never followed/);
      expect(watch.count).toBe(0);
      expect(saved).toEqual([]);
    });

    it("goes through at once, unsaved, while its folder is not being saved", async () => {
      const work = await folders.make("zhiyin-watch-work-");
      const file = join(work, "notes.txt");
      await writeFile(file, "as it was");
      const confined = await contained.grant(work);
      const { watch, saved, unsaved } = await watching();
      await watch.watch(work, [file]);
      watch.saving(work, false);

      const [write] = await contained.run(confined, [["write", file]]);

      expect(write!.result).toBe("done");
      expect(saved).toEqual([]);
      expect(unsaved).toEqual([file]);
    });
  },
);

describe.runIf(process.platform === "win32")(
  "Zhiyin's own work on a watched file",
  { timeout: 180_000 },
  () => {
    it("never waits on its own watch: giving the folder to a container saves the file and goes on", async () => {
      const work = await folders.make("zhiyin-watch-work-");
      const file = join(work, "inside", "held.bin");
      await bigFile(file, 16);
      const before = await digest(file);
      const { watch, saved } = await watching();
      await watch.watch(work, [file]);

      // Granting writes an entry into the permissions of every file below,
      // the watched one included, from this thread and from Windows' own.
      const confined = await contained.grant(work);
      const [write] = await contained.run(confined, [["write", file]]);

      expect(write!.result).toBe("done");
      expect(saved.map((file) => file.path)).toEqual([file]);
      expect(await digest(saved[0]!.staged)).toBe(before);
    });

    it("is saved and let go first when Zhiyin settles it", async () => {
      const work = await folders.make("zhiyin-watch-work-");
      const file = join(work, "held.txt");
      await writeFile(file, "as the turn found it");
      const { watch, saved } = await watching();
      await watch.watch(work, [file]);

      await watch.settle([work]);
      await writeFile(file, "changed by Zhiyin");

      expect(saved).toHaveLength(1);
      expect(await readFile(saved[0]!.staged, "utf8")).toBe(
        "as the turn found it",
      );
      expect(watch.count).toBe(0);
    });
  },
);

describe.runIf(process.platform === "win32")(
  "watching many files",
  { timeout: 300_000 },
  () => {
    it("holds 20,000 files in under 100 MB of the kernel's non-paged memory", async () => {
      const work = await folders.make("zhiyin-watch-many-");
      const paths: string[] = [];
      for (let folder = 0; folder < 20; folder++) {
        await mkdir(join(work, `d${folder}`));
        const names = Array.from({ length: 1000 }, (_, index) =>
          join(work, `d${folder}`, `f${index}.bin`),
        );
        await Promise.all(
          names.map((path) => writeFile(path, "x".repeat(1024))),
        );
        paths.push(...names);
      }
      const nonPaged = () =>
        Number(
          execFileSync("powershell", [
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_PerfRawData_PerfOS_Memory).PoolNonpagedBytes",
          ])
            .toString()
            .trim(),
        );
      const { watch } = await watching();
      const before = nonPaged();

      const failures = await watch.watch(work, paths);
      const during = nonPaged();
      await watch.release([work]);

      expect(failures.size).toBe(0);
      expect(watch.count).toBe(0);
      const megabytes = (during - before) / 1e6;
      console.info(
        `20,000 watched files: ${megabytes.toFixed(1)} MB non-paged`,
      );
      expect(megabytes).toBeLessThan(100);
    });
  },
);

describe.runIf(process.platform === "win32")(
  "the change journal",
  { timeout: 120_000 },
  () => {
    it("names a file a program changed and put its old time back on, by its identity", async () => {
      const work = await folders.make("zhiyin-watch-journal-");
      const file = join(work, "same-time.bin");
      const other = join(work, "untouched.bin");
      await writeFile(file, randomBytes(1 << 20));
      await writeFile(other, randomBytes(1 << 10));
      // A whole second, so the program's time, kept in milliseconds, is
      // put back exactly.
      const second = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
      await utimes(file, second, second);
      const before = await stat(file, { bigint: true });
      const identity = String((await stat(file, { bigint: true })).ino);
      const untouched = String((await stat(other, { bigint: true })).ino);
      const confined = await contained.grant(work);
      const point = journalPoint(work);
      expect(point).toBeDefined();

      const [kept] = await contained.run(confined, [["keep-time", file]]);
      const after = await stat(file, { bigint: true });
      const changes = journalChanges(
        work,
        point!,
        new Set([identity, untouched]),
      );

      expect(kept!.result).toBe("done");
      expect(after.size).toBe(before.size);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(changes.ok).toBe(true);
      if (!changes.ok) return;
      // Written: overwritten, extended or truncated.
      expect((changes.changed.get(identity) ?? 0) & 0x7).not.toBe(0);
      expect(changes.changed.has(untouched)).toBe(false);
    });

    it("says it cannot answer for a point from a journal that is not this one", () => {
      const answer = journalChanges(
        process.cwd(),
        { journal: "1", next: "0" },
        new Set(),
      );
      expect(answer).toEqual({ ok: false, reason: "reset" });
    });
  },
);
