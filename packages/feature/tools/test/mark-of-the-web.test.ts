/**
 * Windows marks a file downloaded from the internet with a `Zone.Identifier`
 * stream beside it. These files are marked here the way a browser marks them,
 * by writing that stream.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { downloadedFromTheInternet } from "../src/shared/mark-of-the-web.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function fileMarked(zone: string | undefined): Promise<string> {
  const path = join(await folders.make("zhiyin-motw-"), "file.txt");
  await writeFile(path, "contents");
  if (zone !== undefined)
    await writeFile(
      `${path}:Zone.Identifier`,
      `[ZoneTransfer]\r\nZoneId=${zone}\r\nHostUrl=https://example.com/file.txt\r\n`,
    );
  return path;
}

describe("the Mark of the Web", () => {
  it("is absent from a file nobody marked", async () => {
    expect(await downloadedFromTheInternet(await fileMarked(undefined))).toBe(
      false,
    );
  });

  it("marks a file from the Internet zone or the Restricted zone", async () => {
    expect(await downloadedFromTheInternet(await fileMarked("3"))).toBe(true);
    expect(await downloadedFromTheInternet(await fileMarked("4"))).toBe(true);
  });

  it("does not mark a file from this computer, the local network or a trusted site", async () => {
    expect(await downloadedFromTheInternet(await fileMarked("0"))).toBe(false);
    expect(await downloadedFromTheInternet(await fileMarked("1"))).toBe(false);
    expect(await downloadedFromTheInternet(await fileMarked("2"))).toBe(false);
  });

  it("is read from a stream written as UTF-16, as some programs write it", async () => {
    const path = await fileMarked(undefined);
    await writeFile(
      `${path}:Zone.Identifier`,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("[ZoneTransfer]\r\nZoneId=3\r\n", "utf16le"),
      ]),
    );

    expect(await downloadedFromTheInternet(path)).toBe(true);
  });

  it("is absent from a file that does not exist and from a folder", async () => {
    const folder = await folders.make("zhiyin-motw-");
    await mkdir(join(folder, "inner"));

    expect(await downloadedFromTheInternet(join(folder, "missing.txt"))).toBe(
      false,
    );
    expect(await downloadedFromTheInternet(join(folder, "inner"))).toBe(false);
  });
});
