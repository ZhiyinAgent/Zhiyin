import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { alternateStreams } from "../src/index.js";

const folders = new TemporaryFolders();
afterAll(() => folders.removeAll());

describe.runIf(process.platform === "win32")(
  "a file's alternate data streams",
  () => {
    it("are named, the file's own contents not among them", async () => {
      const folder = await folders.make("zhiyin-streams-");
      const file = join(folder, "downloaded.txt");
      await writeFile(file, "contents");
      await writeFile(
        `${file}:Zone.Identifier`,
        "[ZoneTransfer]\r\nZoneId=3\r\n",
      );
      await writeFile(`${file}:notes`, "kept beside it");

      expect(alternateStreams(file).sort()).toEqual([
        "Zone.Identifier",
        "notes",
      ]);
      expect(alternateStreams(join(folder, "missing.txt"))).toEqual([]);
    });
  },
);
