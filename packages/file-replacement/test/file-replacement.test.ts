/**
 * Replacing a file whole: whoever reads it finds the old contents or the new,
 * never part of either, and a replacement that fails leaves nothing behind.
 */

import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import koffi from "koffi";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { replaceFile } from "../src/index.js";
import {
  replacingWith,
  type ReplacementFiles,
} from "../src/file-replacement.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const kernel32 = koffi.load("kernel32.dll");
const CreateFileW = kernel32.func(
  "void* __stdcall CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
);
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(void*)");

/**
 * Opens a file for reading the way a program that forbids its replacement
 * does: sharing reading only, as Office and many editors do.
 */
function holdWithoutSharing(path: string): () => void {
  const genericRead = 0x80000000;
  const shareRead = 0x1;
  const openExisting = 3;
  const handle = CreateFileW(
    path,
    genericRead,
    shareRead,
    null,
    openExisting,
    0,
    null,
  );
  if (koffi.address(handle) === BigInt.asUintN(64, -1n))
    throw new Error(`${path} could not be held.`);
  return () => void CloseHandle(handle);
}

describe("replacing a file whole", () => {
  it("is read as the old contents or the new while it is replaced, never part of either", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const file = join(folder, "settings.json");
    const before = "a".repeat(8 * 1024 * 1024);
    const after = "b".repeat(16 * 1024 * 1024);
    await writeFile(file, before);

    let done = false;
    const seen = new Set<string>();
    const reading = (async () => {
      while (!done) {
        const text = await readFile(file, "utf8").catch(() => "missing");
        seen.add(
          text === before ? "before" : text === after ? "after" : "partial",
        );
      }
    })();
    await replaceFile(file, after);
    done = true;
    await reading;

    expect(seen.has("partial")).toBe(false);
    expect(seen.has("missing")).toBe(false);
    expect(await readFile(file, "utf8")).toBe(after);
  });

  it("replaces a file another program is reading, which goes on reading what it opened", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const file = join(folder, "settings.json");
    await writeFile(file, "old contents");
    const reader = await open(file, "r");

    try {
      const started = Date.now();
      await replaceFile(file, "new contents");

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(await readFile(file, "utf8")).toBe("new contents");
      expect(
        (await reader.read(Buffer.alloc(12), 0, 12, 0)).buffer.toString(),
      ).toBe("old contents");
    } finally {
      await reader.close();
    }
    expect(await readdir(folder)).toEqual(["settings.json"]);
  });

  it("waits for a program that will not let the file be replaced to let go of it", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const file = join(folder, "settings.json");
    await writeFile(file, "old contents");
    const release = holdWithoutSharing(file);
    setTimeout(release, 300);

    const started = Date.now();
    await replaceFile(file, "new contents");

    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(await readFile(file, "utf8")).toBe("new contents");
    expect(await readdir(folder)).toEqual(["settings.json"]);
  });

  it("gives up after two seconds, leaving the old file and nothing else", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const file = join(folder, "settings.json");
    await writeFile(file, "old contents");
    const release = holdWithoutSharing(file);

    const started = Date.now();
    try {
      await expect(replaceFile(file, "new contents")).rejects.toMatchObject({
        code: "EBUSY",
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      release();
    }

    expect(await readFile(file, "utf8")).toBe("old contents");
    expect(await readdir(folder)).toEqual(["settings.json"]);
  });

  it("replaces a file another program is reading in a folder whose path is longer than Windows' old limit", async () => {
    let folder = await folders.make("zhiyin-replace-");
    while (folder.length < 280) folder = join(folder, "d".repeat(40));
    await mkdir(folder, { recursive: true });
    const file = join(folder, "settings.json");
    await writeFile(file, "old contents");
    const reader = await open(file, "r");

    try {
      const started = Date.now();
      await replaceFile(file, "new contents");

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(await readFile(file, "utf8")).toBe("new contents");
    } finally {
      await reader.close();
    }
    expect(await readdir(folder)).toEqual(["settings.json"]);
  });

  it("stops waiting for a program that holds the file when asked, leaving the old file and nothing else", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const file = join(folder, "settings.json");
    await writeFile(file, "old contents");
    const release = holdWithoutSharing(file);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const started = Date.now();
    try {
      await expect(
        replaceFile(file, "new contents", { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      release();
    }

    expect(await readFile(file, "utf8")).toBe("old contents");
    expect(await readdir(folder)).toEqual(["settings.json"]);
  });

  it("replaces a file whose name is as long as a name may be", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const file = join(folder, `${"n".repeat(250)}.txt`);
    await writeFile(file, "old");

    await replaceFile(file, "new");

    expect(await readFile(file, "utf8")).toBe("new");
    expect(await readdir(folder)).toHaveLength(1);
  });

  it("takes the new file's place only once a check of it passes", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const file = join(folder, "conversation.jsonl");
    await writeFile(file, "old");
    const checked: string[] = [];

    await expect(
      replaceFile(file, "new", {
        check: async (written) => {
          checked.push(await readFile(written, "utf8"));
          throw new Error("It did not read back as made.");
        },
      }),
    ).rejects.toThrow("It did not read back as made.");
    expect(await readFile(file, "utf8")).toBe("old");
    await replaceFile(file, "newer", {
      check: async (written) => {
        checked.push(await readFile(written, "utf8"));
      },
    });

    expect(checked).toEqual(["new", "newer"]);
    expect(await readFile(file, "utf8")).toBe("newer");
    expect(await readdir(folder)).toEqual(["conversation.jsonl"]);
  });

  it("writes text, bytes, or a copy of another file", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const source = join(folder, "made.pdf");
    await writeFile(source, Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2]));

    await replaceFile(join(folder, "a.txt"), "Grüße\n");
    await replaceFile(join(folder, "b.bin"), new Uint8Array([0, 255, 7]));
    await replaceFile(join(folder, "c.pdf"), { copyOf: source });

    expect(await readFile(join(folder, "a.txt"), "utf8")).toBe("Grüße\n");
    expect([...(await readFile(join(folder, "b.bin")))]).toEqual([0, 255, 7]);
    expect(await readFile(join(folder, "c.pdf"))).toEqual(
      await readFile(source),
    );
    expect((await readdir(folder)).sort()).toEqual([
      "a.txt",
      "b.bin",
      "c.pdf",
      "made.pdf",
    ]);
  });

  it("leaves the old file and nothing else when the new one cannot take its place", async () => {
    const folder = await folders.make("zhiyin-replace-");
    // A folder holding a file cannot be replaced by a file.
    const target = join(folder, "taken");
    await mkdir(target);
    await writeFile(join(target, "inside.txt"), "kept");

    await expect(replaceFile(target, "new")).rejects.toThrow();

    expect(await readdir(folder)).toEqual(["taken"]);
    expect(await readFile(join(target, "inside.txt"), "utf8")).toBe("kept");
  });

  it("leaves nothing behind when a copy cannot be read", async () => {
    const folder = await folders.make("zhiyin-replace-");

    await expect(
      replaceFile(join(folder, "out.pdf"), {
        copyOf: join(folder, "missing.pdf"),
      }),
    ).rejects.toThrow();

    expect(await readdir(folder)).toEqual([]);
  });

  it("stops when asked, leaving nothing behind", async () => {
    const folder = await folders.make("zhiyin-replace-");
    const controller = new AbortController();
    controller.abort();

    await expect(
      replaceFile(join(folder, "a.txt"), "text", {
        signal: controller.signal,
      }),
    ).rejects.toThrow();

    expect(await readdir(folder)).toEqual([]);
  });

  it("has the new contents on disk before they take the old file's place", async () => {
    const steps: string[] = [];
    const files: ReplacementFiles = {
      open: async (path) => {
        steps.push(`open ${path.endsWith(".tmp") ? "temporary" : path}`);
        return {
          write: async () => void steps.push("write"),
          sync: async () => void steps.push("sync"),
          close: async () => void steps.push("close"),
        };
      },
      rename: async () => void steps.push("rename"),
      remove: async () => void steps.push("remove"),
    };

    await replacingWith(files)("C:\\data\\settings.json", "{}");

    expect(steps).toEqual([
      "open temporary",
      "write",
      "sync",
      "close",
      "rename",
    ]);
  });

  it("names its temporary file beside the file it replaces, a new name each time", async () => {
    const opened: string[] = [];
    const files: ReplacementFiles = {
      open: async (path) => {
        opened.push(path);
        return {
          write: async () => {},
          sync: async () => {},
          close: async () => {},
        };
      },
      rename: async () => {},
      remove: async () => {},
    };
    const replace = replacingWith(files);

    await replace(join("C:\\data", "settings.json"), "{}");
    await replace(join("C:\\data", "settings.json"), "{}");

    expect(opened).toHaveLength(2);
    expect(new Set(opened).size).toBe(2);
    for (const path of opened)
      expect(path.startsWith(join("C:\\data", "."))).toBe(true);
  });
});
