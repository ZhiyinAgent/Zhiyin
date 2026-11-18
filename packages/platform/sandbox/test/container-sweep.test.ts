/**
 * The containers Zhiyin registered for homes that are gone are removed from
 * the person's profile, so they do not pile up there run after run.
 */

import { readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import koffi from "koffi";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  confine,
  forgetConfinement,
  removeUnusedContainers,
} from "../src/index.js";

/** Containers of this purpose belong to this file alone. */
const purpose = "test-sweep";
const folders = new TemporaryFolders();
const homes: string[] = [];
afterEach(async () => {
  for (const each of homes.splice(0)) forgetConfinement(purpose, each);
  await folders.removeAll();
});

const packages = join(
  process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
  "Packages",
);
const ours = async () =>
  (await readdir(packages)).filter((name) =>
    name.toLowerCase().startsWith(`zhiyin.${purpose}.`),
  );

async function confinedHome(): Promise<string> {
  const home = await folders.make("zhiyin-sweep-home-");
  homes.push(home);
  await confine({ purpose, home, read: [], write: [], hosts: [] });
  return home;
}

describe.runIf(process.platform === "win32")(
  "removing unused containers",
  () => {
    it("removes a container whose home is gone, and keeps one whose home is there", async () => {
      const before = await ours();
      const kept = await confinedHome();
      await confinedHome();
      const gone = homes.at(-1)!;
      const registered = (await ours()).filter(
        (name) => !before.includes(name),
      );
      await rm(gone, { recursive: true, force: true });

      await removeUnusedContainers([purpose]);

      const left = (await ours()).filter((name) => !before.includes(name));
      expect(registered).toHaveLength(2);
      expect(left).toHaveLength(1);
      forgetConfinement(purpose, kept);
      expect((await ours()).filter((name) => !before.includes(name))).toEqual(
        [],
      );
    });

    it("keeps a container whose display name records no home", async () => {
      const userenv = koffi.load("userenv.dll");
      const create = userenv.func(
        "int32 CreateAppContainerProfile(const char16_t*, const char16_t*, const char16_t*, void*, uint32, _Out_ void**)",
      );
      const remove = userenv.func(
        "int32 DeleteAppContainerProfile(const char16_t*)",
      );
      const name = `Zhiyin.${purpose}.0000000000000000`;
      create(
        name,
        `Zhiyin ${name}`,
        "A program Zhiyin runs on files and code it was given.",
        null,
        0,
        [null],
      );
      try {
        await removeUnusedContainers([purpose]);

        expect(await ours()).toContain(name.toLowerCase());
      } finally {
        remove(name);
      }
    });

    it("leaves the containers of other purposes when asked about some", async () => {
      const before = (await readdir(packages)).filter((name) =>
        name.toLowerCase().startsWith("zhiyin."),
      );

      await removeUnusedContainers([purpose]);

      const after = await readdir(packages);
      expect(
        before.filter(
          (name) =>
            !name.toLowerCase().startsWith(`zhiyin.${purpose}.`) &&
            !after.includes(name),
        ),
      ).toEqual([]);
    });
  },
);
