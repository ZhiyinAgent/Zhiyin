import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  DownloadedToolchains,
  pinnedToolchains,
  type Download,
  type ToolchainSpec,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-toolchains-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** A zip archive with stored (uncompressed) entries, names taken verbatim. */
function storedZip(entries: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
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
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function specFor(archive: Buffer, overrides: Partial<ToolchainSpec> = {}) {
  return {
    id: "typst",
    name: "Typst",
    version: "1.2.3",
    url: "https://example.test/typst.zip",
    sha256: createHash("sha256").update(archive).digest("hex"),
    bytes: archive.length,
    source: "example.test",
    executable: "bin/typst.exe",
    ...overrides,
  } satisfies ToolchainSpec;
}

function serving(archive: Buffer): Download & { calls: number } {
  const download = Object.assign(
    async (_url: string, signal: AbortSignal) => {
      download.calls += 1;
      return (async function* () {
        for (let index = 0; index < archive.length; index += 7) {
          signal.throwIfAborted();
          await Promise.resolve();
          yield archive.subarray(index, index + 7);
        }
      })();
    },
    { calls: 0 },
  );
  return download;
}

const program = storedZip({
  "bin/": "",
  "bin/typst.exe": "not really a program",
});

describe("installing a pinned program", () => {
  it("installs a verified archive and finds the program after a restart", async () => {
    const directory = await temporaryRoot();
    const spec = specFor(program);
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [spec],
      download: serving(program),
    });
    expect(await toolchains.state("typst")).toEqual({
      status: "missing",
      downloads: [
        {
          name: "Typst",
          version: "1.2.3",
          bytes: program.length,
          source: "example.test",
        },
      ],
    });

    await toolchains.install("typst");

    const restarted = new DownloadedToolchains({ directory, specs: [spec] });
    expect(await restarted.state("typst")).toEqual({ status: "ready" });
    const executable = await restarted.executable("typst");
    expect(await readFile(executable!, "utf8")).toBe("not really a program");
  });

  it("discards a download that does not match its fingerprint", async () => {
    const directory = await temporaryRoot();
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(program, { sha256: "0".repeat(64) })],
      download: serving(program),
    });

    await expect(toolchains.install("typst")).rejects.toThrow(
      /did not match its published fingerprint/,
    );

    expect(await toolchains.state("typst")).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("fingerprint"),
    });
    expect(await toolchains.executable("typst")).toBeUndefined();
    expect(await readdir(join(directory, "toolchains", ".staging"))).toEqual(
      [],
    );
  });

  it("stops reading a download that grows past its published size", async () => {
    const directory = await temporaryRoot();
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(program, { bytes: 10 })],
      download: serving(program),
    });

    await expect(toolchains.install("typst")).rejects.toThrow(
      /larger than expected/,
    );
    expect(await toolchains.executable("typst")).toBeUndefined();
  });

  it("refuses an archive that does not contain the program", async () => {
    const empty = storedZip({ "README.md": "nothing here" });
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [specFor(empty)],
      download: serving(empty),
    });

    await expect(toolchains.install("typst")).rejects.toThrow(
      /does not contain Typst/,
    );
  });

  it("refuses an archive whose entries climb out of its folder", async () => {
    const directory = await temporaryRoot();
    const escaping = storedZip({
      "bin/typst.exe": "program",
      "../../escaped.txt": "outside",
    });
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(escaping)],
      download: serving(escaping),
    });

    await expect(toolchains.install("typst")).rejects.toThrow();

    expect(await toolchains.executable("typst")).toBeUndefined();
    await expect(
      readFile(join(directory, "toolchains", "escaped.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(directory, "escaped.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("downloads once when installation is asked for twice at the same time", async () => {
    const download = serving(program);
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [specFor(program)],
      download,
    });

    const first = toolchains.install("typst");
    expect(await toolchains.state("typst")).toEqual({ status: "installing" });
    await Promise.all([first, toolchains.install("typst")]);

    expect(download.calls).toBe(1);
  });

  it("leaves nothing usable behind when installation is stopped", async () => {
    const directory = await temporaryRoot();
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(program)],
      download: serving(program),
    });
    const controller = new AbortController();

    const running = toolchains.install("typst", controller.signal);
    controller.abort();

    await expect(running).rejects.toThrow();
    expect(await toolchains.state("typst")).toEqual({
      status: "failed",
      reason: "The installation was stopped.",
    });
    expect(await readdir(join(directory, "toolchains", ".staging"))).toEqual(
      [],
    );
  });

  it("replaces an older installed version with the pinned one", async () => {
    const directory = await temporaryRoot();
    const older = specFor(program, { version: "1.0.0" });
    await new DownloadedToolchains({
      directory,
      specs: [older],
      download: serving(program),
    }).install("typst");

    const current = new DownloadedToolchains({
      directory,
      specs: [specFor(program)],
      download: serving(program),
    });
    expect((await current.state("typst")).status).toBe("missing");
    await current.install("typst");

    expect(await readdir(join(directory, "toolchains", "typst"))).toEqual([
      "1.2.3",
    ]);
  });
});

describe("the pinned releases", () => {
  it("name an https GitHub release, a size, and a full SHA-256 digest", () => {
    expect(pinnedToolchains.map((spec) => spec.id)).toEqual([
      "typst",
      "tectonic",
      "uv",
    ]);
    for (const spec of pinnedToolchains) {
      expect(spec.url).toMatch(
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//,
      );
      expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.bytes).toBeGreaterThan(1_000_000);
      expect(spec.executable).toMatch(/\.exe$/);
    }
  });
});
