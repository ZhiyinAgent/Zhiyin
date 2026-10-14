/**
 * A browser's profile is removed when it closes, but not when Zhiyin is
 * killed first. Each profile folder carries the id of the Zhiyin process that
 * made it, so the next browser launch removes those whose process is gone.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { clearAbandonedProfiles } from "../src/abandoned-profiles.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

it("removes the profiles of Zhiyin processes that are gone, and only those", async () => {
  const directory = await folders.make("zhiyin-profiles-");
  const ended = spawnSync(process.execPath, ["-e", ""]).pid;
  for (const name of [
    `zhiyin-browser-${ended}-abc123`,
    `zhiyin-browser-${process.pid}-def456`,
    "zhiyin-browser-preview-ghi789",
    "someone-elses-folder",
  ])
    await mkdir(join(directory, name, "profile"), { recursive: true });

  await clearAbandonedProfiles(directory);

  expect((await readdir(directory)).sort()).toEqual([
    "someone-elses-folder",
    `zhiyin-browser-${process.pid}-def456`,
    "zhiyin-browser-preview-ghi789",
  ]);
});
