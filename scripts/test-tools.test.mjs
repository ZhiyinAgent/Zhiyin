/**
 * The programs some tests need, installed into a kept folder before the run.
 * An archive kept from an earlier run that the install refuses, such as one an
 * older pin left under the same name, is fetched again, once.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { prepareTestTools } from "./test-tools.mjs";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** A zip archive of one stored file. */
function storedZip(name, text) {
  const nameBytes = Buffer.from(name, "utf8");
  const data = Buffer.from(text, "utf8");
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(local.length + nameBytes.length + data.length, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

const archive = storedZip("bin/typst.exe", "the pinned Typst");
const spec = {
  id: "typst",
  name: "Typst",
  version: "1.2.3",
  url: "https://example.test/typst.zip",
  sha256: createHash("sha256").update(archive).digest("hex"),
  bytes: archive.length,
  source: "example.test",
  executable: "bin/typst.exe",
};

/** The pinned archive, served as often as it is asked for. */
function serving() {
  const fetch = async () => {
    fetch.calls += 1;
    return (async function* () {
      yield archive;
    })();
  };
  fetch.calls = 0;
  return fetch;
}

describe("the programs tests need", () => {
  it("fetches again, once, an archive kept from an earlier run that the install refuses", async () => {
    const folder = await folders.make("zhiyin-test-tools-");
    await mkdir(join(folder, "archives"));
    // What an older pin left under the same name.
    await writeFile(join(folder, "archives", "typst.zip"), "an older Typst");
    const fetch = serving();
    const env = {};

    await prepareTestTools({ folder, specs: [spec], fetch, env });

    expect(fetch.calls).toBe(1);
    expect(await readFile(env.ZHIYIN_TYPST, "utf8")).toBe("the pinned Typst");
    expect(await readFile(join(folder, "archives", "typst.zip"))).toEqual(
      archive,
    );
  });

  it("installs from the archive it kept, fetching nothing", async () => {
    const folder = await folders.make("zhiyin-test-tools-");
    await mkdir(join(folder, "archives"));
    await writeFile(join(folder, "archives", "typst.zip"), archive);
    const fetch = serving();
    const env = {};

    await prepareTestTools({ folder, specs: [spec], fetch, env });

    expect(fetch.calls).toBe(0);
    expect(await readFile(env.ZHIYIN_TYPST, "utf8")).toBe("the pinned Typst");
  });

  it("leaves a program a variable already names as it is", async () => {
    const folder = await folders.make("zhiyin-test-tools-");
    const fetch = serving();
    const env = { ZHIYIN_TYPST: "C:\\mine\\typst.exe" };

    await prepareTestTools({ folder, specs: [spec], fetch, env });

    expect(fetch.calls).toBe(0);
    expect(env.ZHIYIN_TYPST).toBe("C:\\mine\\typst.exe");
  });
});
