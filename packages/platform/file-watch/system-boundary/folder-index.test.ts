/**
 * A folder's listing kept up to date from the real NTFS change journal, over
 * real files: listed whole once, then only where the journal says something
 * changed, and always the same as a listing made whole now.
 */

import {
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { FolderIndex, type FolderPart, type ListFolder } from "../src/index.js";

const folders = new TemporaryFolders();
afterAll(() => folders.removeAll());

type File = {
  readonly size: number;
  readonly id: string;
  readonly link?: string;
};

/**
 * Lists a folder as the app's listing does, entry by entry and never through
 * a link, and says each time whether it was asked for the whole folder or
 * which part.
 */
function lister() {
  const asked: (FolderPart | "whole")[] = [];
  const entry = async (full: string) => {
    const info = await lstat(full, { bigint: true }).catch(() => undefined);
    if (!info) return undefined;
    if (info.isSymbolicLink())
      return {
        file: {
          size: Number(info.size),
          id: String(info.ino),
          link: `link ${await readlink(full)}`,
        },
      };
    if (info.isDirectory()) return { folder: String(info.ino) };
    return { file: { size: Number(info.size), id: String(info.ino) } };
  };
  const list: ListFolder<File> = async (root, part) => {
    asked.push(part ?? "whole");
    const files = new Map<string, File>();
    const found = new Map<string, string>();
    const named = (folder: string, name: string) =>
      folder ? `${folder}/${name}` : name;
    const read = async (folder: string, whole: boolean) => {
      for (const name of await readdir(join(root, folder))) {
        const path = named(folder, name);
        const one = await entry(join(root, path));
        if (one && "file" in one) files.set(path, one.file);
        else if (one) {
          found.set(path, one.folder);
          if (whole) await read(path, true);
        }
      }
    };
    if (!part) {
      found.set("", (await entry(root))!.folder!);
      await read("", true);
    } else {
      for (const path of part.entries) {
        const one = await entry(join(root, path));
        if (one && "file" in one) files.set(path, one.file);
      }
      for (const folder of part.entriesOf) await read(folder, false);
      for (const folder of part.wholeOf) {
        found.set(folder, (await entry(join(root, folder)))!.folder!);
        await read(folder, true);
      }
    }
    return { ok: true, files, folders: found };
  };
  return { list, asked };
}

/** A listing's files, each with its size and what it links to, in order. */
const shapeOf = (files: ReadonlyMap<string, File>) =>
  [...files]
    .map(([path, file]) => [path, file.size, file.link ?? ""] as const)
    .sort(([a], [b]) => a.localeCompare(b));

async function filledFolder() {
  const root = await folders.make("zhiyin-index-");
  for (let part = 0; part < 4; part++) {
    await mkdir(join(root, `part-${part}`));
    await Promise.all(
      Array.from({ length: 500 }, (_, at) =>
        writeFile(join(root, `part-${part}`, `${at}.txt`), `note ${at}\n`),
      ),
    );
  }
  return root;
}

describe.runIf(process.platform === "win32")(
  "a folder's listing kept from the change journal",
  { timeout: 120_000 },
  () => {
    it("is listed whole once, then not again while nothing in it changes", async () => {
      const root = await filledFolder();
      const { list, asked } = lister();
      const index = new FolderIndex(list);

      const first = await index.listing(root);
      const second = await index.listing(root);

      expect(asked).toEqual(["whole"]);
      expect(first.ok && first.files.size).toBe(2000);
      expect(second.ok && shapeOf(second.files)).toEqual(
        first.ok && shapeOf(first.files),
      );
    });

    it("reads again only where files were written, made, deleted or renamed, a folder renamed or made, and matches a listing made whole", async () => {
      const root = await filledFolder();
      const outside = await folders.make("zhiyin-index-outside-");
      await writeFile(join(outside, "secret.txt"), "the person's key");
      const { list, asked } = lister();
      const index = new FolderIndex(list);
      await index.listing(root);

      await writeFile(join(root, "part-0", "1.txt"), "written again, longer");
      await writeFile(join(root, "part-0", "new.txt"), "made");
      await rm(join(root, "part-1", "2.txt"));
      await rename(
        join(root, "part-1", "3.txt"),
        join(root, "part-2", "moved.txt"),
      );
      await rename(join(root, "part-3"), join(root, "renamed"));
      await mkdir(join(root, "fresh", "deeper"), { recursive: true });
      await writeFile(join(root, "fresh", "deeper", "a.txt"), "a");
      await symlink(outside, join(root, "fresh", "elsewhere"), "junction");
      const updated = await index.listing(root);
      const whole = await lister().list(root);

      expect(asked[0]).toBe("whole");
      expect(asked.length).toBeGreaterThan(1);
      expect(asked.slice(1).every((part) => part !== "whole")).toBe(true);
      if (!updated.ok || !whole.ok) throw new Error("not listed");
      expect(shapeOf(updated.files)).toEqual(shapeOf(whole.files));
      expect(updated.files.has("fresh/elsewhere/secret.txt")).toBe(false);
      expect(updated.files.get("fresh/elsewhere")?.link).toBe(
        `link ${outside}`,
      );
    });

    it("keeps the folder's links: one made, then one replacing a folder, then both gone", async () => {
      const root = await filledFolder();
      const outside = await folders.make("zhiyin-index-outside-");
      const { list } = lister();
      const index = new FolderIndex(list);
      const links = async () => {
        const found = await index.links(root);
        if (!found.ok) throw new Error(found.reason);
        return Object.fromEntries(found.links);
      };
      expect(await links()).toEqual({});

      await symlink(outside, join(root, "door"), "junction");
      expect(await links()).toEqual({ door: `link ${outside}` });

      await rm(join(root, "part-2"), { recursive: true });
      await symlink(outside, join(root, "part-2"), "junction");
      expect(await links()).toEqual({
        door: `link ${outside}`,
        "part-2": `link ${outside}`,
      });

      await rm(join(root, "door"));
      await rm(join(root, "part-2"));
      expect(await links()).toEqual({});
    });

    it("is listed whole each time on a drive whose journal cannot answer", async () => {
      const root = await filledFolder();
      const { list, asked } = lister();
      const index = new FolderIndex(list, {
        point: () => undefined,
        changes: () => ({ ok: false, reason: "unavailable" }),
      });

      await index.listing(root);
      await index.listing(root);

      expect(asked).toEqual(["whole", "whole"]);
    });
  },
);
