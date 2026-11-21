import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  DownloadedToolchains,
  pinnedToolchains,
  type Download,
  type ToolchainSource,
  type ToolchainSpec,
} from "../src/index.js";

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-toolchains-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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

const fingerprint = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** A place `archive` is downloaded from, at `host`. */
function sourceFor(
  archive: Buffer,
  host = "example.test",
  overrides: Partial<ToolchainSource> = {},
): ToolchainSource {
  return {
    url: `https://${host}/typst.zip`,
    sha256: fingerprint(archive),
    bytes: archive.length,
    executable: "bin/typst.exe",
    hosts: [host],
    ...overrides,
  };
}

function specFor(
  archive: Buffer,
  overrides: Partial<ToolchainSource> & { version?: string } = {},
): ToolchainSpec {
  const { version = "1.2.3", ...source } = overrides;
  return {
    id: "typst",
    name: "Typst",
    version,
    sources: [sourceFor(archive, "example.test", source)],
  };
}

/** Serves each address its own archive, and records which were asked for. */
function servingEach(
  archives: Readonly<Record<string, Buffer>>,
): Download & { asked: string[] } {
  const download = Object.assign(
    async (url: string, signal: AbortSignal) => {
      download.asked.push(url);
      const archive = archives[url];
      if (!archive)
        throw new Error(
          "The download could not be reached. Check the internet connection.",
        );
      return serving(archive)(url, signal);
    },
    { asked: [] as string[] },
  );
  return download;
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
  it("downloads through the network it is handed, following its redirects, and never through Node's own fetch", async () => {
    const nodeFetch = vi.fn(async () => {
      throw new Error("Node's fetch was used.");
    });
    vi.stubGlobal("fetch", nodeFetch);
    const asked: { url: string; redirect: RequestInit["redirect"] }[] = [];
    try {
      const spec = specFor(program);
      const toolchains = new DownloadedToolchains({
        directory: await temporaryRoot(),
        specs: [spec],
        network: async (url, init) => {
          asked.push({ url, redirect: init.redirect });
          return new Response(new Uint8Array(program));
        },
      });

      await toolchains.install("typst");

      expect(await toolchains.state("typst")).toEqual({ status: "ready" });
      expect(asked).toEqual([
        { url: spec.sources[0]!.url, redirect: "follow" },
      ]);
      expect(nodeFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says why a download could not be made over Chromium's network, in words a person can act on", async () => {
    const causes: [string, string][] = [
      [
        "net::ERR_NAME_NOT_RESOLVED",
        "The download could not be reached. Check the internet connection.",
      ],
      [
        "net::ERR_CERT_AUTHORITY_INVALID",
        "The download site's certificate is not trusted on this computer.",
      ],
    ];
    for (const [failure, reason] of causes) {
      const toolchains = new DownloadedToolchains({
        directory: await temporaryRoot(),
        specs: [specFor(program)],
        network: async () => {
          throw new Error(failure);
        },
      });

      await toolchains.install("typst").catch(() => undefined);

      expect(await toolchains.state("typst")).toEqual({
        status: "failed",
        reason,
      });
    }
  });

  it("says a download that broke off partway was interrupted, not that its site could not be reached", async () => {
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [specFor(program)],
      // Chromium ends a body whose connection drops with an error named for it.
      network: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(program).subarray(0, 100));
              controller.error(new Error("net::ERR_CONNECTION_RESET"));
            },
          }),
        ),
    });

    await toolchains.install("typst").catch(() => undefined);

    expect(await toolchains.state("typst")).toEqual({
      status: "failed",
      reason:
        "The download was interrupted. Check the internet connection, then try again.",
    });
  });

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
          sources: ["example.test"],
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

  it("fails, and can be tried again, when the download cannot be written", async () => {
    const directory = await temporaryRoot();
    const spec = specFor(program);
    let refuse = true;
    const download: Download = async (url, signal) => {
      // A folder where the download is written stands in for a disk that
      // refuses the write.
      if (refuse) {
        const staging = join(directory, "toolchains", ".staging");
        for (const name of readdirSync(staging))
          mkdirSync(join(staging, name, "download.zip"));
      }
      return serving(program)(url, signal);
    };
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [spec],
      download,
    });

    await expect(toolchains.install("typst")).rejects.toThrow();
    expect((await toolchains.state("typst")).status).toBe("failed");

    refuse = false;
    await toolchains.install("typst");
    expect(await toolchains.state("typst")).toEqual({ status: "ready" });
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
    expect(await toolchains.state("typst")).toMatchObject({
      status: "installing",
    });
    await Promise.all([first, toolchains.install("typst")]);

    expect(download.calls).toBe(1);
  });

  it("says how much of the download has arrived while it installs", async () => {
    let release = () => {};
    const halfway = new Promise<void>((resolve) => (release = resolve));
    let arrived = () => {};
    const half = new Promise<void>((resolve) => (arrived = resolve));
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [specFor(program)],
      download: async () =>
        (async function* () {
          yield program.subarray(0, 100);
          arrived();
          await halfway;
          yield program.subarray(100);
        })(),
    });

    const running = toolchains.install("typst");
    await half;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await toolchains.state("typst")).toEqual({
      status: "installing",
      received: 100,
      bytes: program.length,
    });
    release();
    await running;

    expect(await toolchains.state("typst")).toEqual({ status: "ready" });
  });

  it("leaves nothing usable behind when installation is stopped, and offers it again", async () => {
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
    // Stopped on purpose, so nothing failed: it is offered as before.
    expect(await toolchains.state("typst")).toMatchObject({
      status: "missing",
    });
    expect(await readdir(join(directory, "toolchains", ".staging"))).toEqual(
      [],
    );
  });

  it("installs when asked again while a stopped install is still ending", async () => {
    const download = serving(program);
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [specFor(program)],
      download,
    });
    const stopping = new AbortController();

    const stopped = toolchains.install("typst", stopping.signal);
    stopping.abort();
    const again = toolchains.install("typst", new AbortController().signal);

    await expect(stopped).rejects.toThrow();
    await expect(again).resolves.toBeUndefined();
    expect(await toolchains.state("typst")).toEqual({ status: "ready" });
  });

  it("clears what an install cut short by Zhiyin closing left, the next time it installs", async () => {
    const directory = await temporaryRoot();
    const abandoned = join(directory, "toolchains", ".staging", "a1b2c3d4");
    mkdirSync(abandoned, { recursive: true });
    await writeFile(join(abandoned, "download.zip"), "half a download");
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(program)],
      download: serving(program),
    });

    await toolchains.install("typst");

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

  it("readies a program before it is in place, and installs what the readying made with it", async () => {
    const directory = await temporaryRoot();
    const during: unknown[] = [];
    let promised: string | undefined;
    const toolchains: DownloadedToolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(program)],
      download: serving(program),
      ready: {
        typst: async ({ executable, installed }) => {
          promised = installed;
          during.push({
            unpacked: await readFile(executable, "utf8"),
            inPlace: await toolchains.executable("typst"),
            state: (await toolchains.state("typst")).status,
          });
          await writeFile(join(dirname(executable), "made.bin"), "made once");
        },
      },
    });

    await toolchains.install("typst");
    await toolchains.install("typst");

    expect(during).toEqual([
      {
        unpacked: "not really a program",
        inPlace: undefined,
        state: "installing",
      },
    ]);
    const executable = await toolchains.executable("typst");
    expect(executable).toBe(promised);
    expect(await readFile(join(dirname(executable!), "made.bin"), "utf8")).toBe(
      "made once",
    );
  });

  it("installs a program whose readying failed: it works without", async () => {
    const directory = await temporaryRoot();
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(program)],
      download: serving(program),
      ready: {
        typst: async () => {
          throw new Error("Nothing could be made ready.");
        },
      },
    });

    await toolchains.install("typst");

    expect(await toolchains.state("typst")).toEqual({ status: "ready" });
  });

  it("leaves nothing usable behind when installation is stopped while a program is readied", async () => {
    const directory = await temporaryRoot();
    const stopping = new AbortController();
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [specFor(program)],
      download: serving(program),
      ready: {
        typst: async (_program, signal) => {
          stopping.abort();
          signal.throwIfAborted();
        },
      },
    });

    await expect(
      toolchains.install("typst", stopping.signal),
    ).rejects.toThrow();

    expect(await toolchains.executable("typst")).toBeUndefined();
    expect(await readdir(join(directory, "toolchains", ".staging"))).toEqual(
      [],
    );
  });
});

describe("downloading from more than one place", () => {
  /** The same program, laid out otherwise, as a mirror publishes it. */
  const elsewhere = storedZip({
    "pkg/": "",
    "pkg/scripts/": "",
    "pkg/scripts/typst.exe": "not really a program",
  });
  const original = sourceFor(program, "original.test");
  const mirror = sourceFor(elsewhere, "mirror.test", {
    executable: "pkg/scripts/typst.exe",
  });
  const twoPlaces = (version = "1.2.3"): ToolchainSpec => ({
    id: "typst",
    name: "Typst",
    version,
    sources: [original, mirror],
  });

  it("offers every place the program may come from, and the largest download", async () => {
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [
        {
          ...twoPlaces(),
          sources: [
            { ...original, hosts: ["original.test", "assets.original.test"] },
            mirror,
          ],
        },
      ],
      download: servingEach({}),
    });

    expect(await toolchains.state("typst")).toEqual({
      status: "missing",
      downloads: [
        {
          name: "Typst",
          version: "1.2.3",
          bytes: Math.max(program.length, elsewhere.length),
          sources: ["original.test", "assets.original.test", "mirror.test"],
        },
      ],
    });
  });

  it("downloads from the original when it answers, and never asks the mirror", async () => {
    const download = servingEach({
      [original.url]: program,
      [mirror.url]: elsewhere,
    });
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [twoPlaces()],
      download,
    });

    await toolchains.install("typst");

    expect(download.asked).toEqual([original.url]);
  });

  it("tries the mirror when the original cannot be reached, and finds what it installed after a restart", async () => {
    const directory = await temporaryRoot();
    const download = servingEach({ [mirror.url]: elsewhere });
    await new DownloadedToolchains({
      directory,
      specs: [twoPlaces()],
      download,
    }).install("typst");

    expect(download.asked).toEqual([original.url, mirror.url]);
    const restarted = new DownloadedToolchains({
      directory,
      specs: [twoPlaces()],
    });
    expect(await restarted.state("typst")).toEqual({ status: "ready" });
    const executable = await restarted.executable("typst");
    expect(executable).toBe(
      join(
        directory,
        "toolchains",
        "typst",
        "1.2.3",
        "files",
        "pkg",
        "scripts",
        "typst.exe",
      ),
    );
    expect(await readFile(executable!, "utf8")).toBe("not really a program");
  });

  it("refuses a file from a mirror that is not the pinned one, and tries the next place", async () => {
    const tampered = storedZip({ "bin/typst.exe": "something else" });
    const third = sourceFor(program, "third.test");
    const download = servingEach({
      [mirror.url]: tampered,
      [third.url]: program,
    });
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [{ ...twoPlaces(), sources: [original, mirror, third] }],
      download,
    });

    await toolchains.install("typst");

    expect(download.asked).toEqual([original.url, mirror.url, third.url]);
    expect(
      await readFile((await toolchains.executable("typst"))!, "utf8"),
    ).toBe("not really a program");
  });

  it("moves on from a place that does not answer in time", async () => {
    const asked: string[] = [];
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [twoPlaces()],
      limits: { answerMs: 20, stallMs: 1_000 },
      download: async (url, signal) => {
        asked.push(url);
        if (url === original.url) return new Promise<never>(() => {});
        return serving(elsewhere)(url, signal);
      },
    });

    await toolchains.install("typst");

    expect(asked).toEqual([original.url, mirror.url]);
    expect(await toolchains.state("typst")).toEqual({ status: "ready" });
  });

  it("moves on from a download that stops arriving partway", async () => {
    const asked: string[] = [];
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [twoPlaces()],
      limits: { answerMs: 1_000, stallMs: 20 },
      download: async (url, signal) => {
        asked.push(url);
        if (url === original.url)
          return (async function* () {
            yield program.subarray(0, 50);
            await new Promise<never>(() => {});
          })();
        return serving(elsewhere)(url, signal);
      },
    });

    await toolchains.install("typst");

    expect(asked).toEqual([original.url, mirror.url]);
    expect(await toolchains.state("typst")).toEqual({ status: "ready" });
  });

  it("says what each place answered when none gave the program", async () => {
    const tampered = storedZip({ "bin/typst.exe": "something else" });
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [twoPlaces()],
      download: servingEach({ [mirror.url]: tampered }),
    });

    await expect(toolchains.install("typst")).rejects.toThrow();

    expect(await toolchains.state("typst")).toEqual({
      status: "failed",
      reason:
        "Typst could not be downloaded from any of the places it comes from. original.test: The download could not be reached. Check the internet connection. mirror.test: The download of Typst did not match its published fingerprint, so it was discarded.",
    });
    expect(await toolchains.executable("typst")).toBeUndefined();
  });

  it("tries no other place once the person stops the install", async () => {
    const stopping = new AbortController();
    const asked: string[] = [];
    const toolchains = new DownloadedToolchains({
      directory: await temporaryRoot(),
      specs: [twoPlaces()],
      download: async (url, signal) => {
        asked.push(url);
        stopping.abort();
        signal.throwIfAborted();
        return serving(program)(url, signal);
      },
    });

    await expect(
      toolchains.install("typst", stopping.signal),
    ).rejects.toThrow();

    expect(asked).toEqual([original.url]);
    expect((await toolchains.state("typst")).status).toBe("missing");
  });

  it("tries no other place when the download cannot be written", async () => {
    const directory = await temporaryRoot();
    const download = servingEach({
      [original.url]: program,
      [mirror.url]: elsewhere,
    });
    const toolchains = new DownloadedToolchains({
      directory,
      specs: [twoPlaces()],
      download: async (url, signal) => {
        const staging = join(directory, "toolchains", ".staging");
        for (const name of readdirSync(staging))
          mkdirSync(join(staging, name, "download.zip"));
        return download(url, signal);
      },
    });

    await expect(toolchains.install("typst")).rejects.toThrow();

    expect(download.asked).toEqual([original.url]);
  });
});

describe("the pinned releases", () => {
  it("name https downloads from the places they show, each with a size, a full SHA-256 digest and the program's path", () => {
    expect(pinnedToolchains.map((spec) => spec.id)).toEqual([
      "typst",
      "tectonic",
      "blender",
      "uv",
      "node",
    ]);
    for (const spec of pinnedToolchains) {
      expect(spec.sources.length).toBeGreaterThan(1);
      for (const source of spec.sources) {
        expect(source.url.startsWith(`https://${source.hosts[0]}/`)).toBe(true);
        expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(source.bytes).toBeGreaterThan(1_000_000);
        expect(source.executable).toMatch(/\.exe$/);
      }
    }
  });

  it("download each program first from its own project", () => {
    expect(pinnedToolchains.map((spec) => spec.sources[0]!.hosts[0])).toEqual([
      "github.com/typst/typst",
      "github.com/tectonic-typesetting/tectonic",
      "download.blender.org",
      "github.com/astral-sh/uv",
      "nodejs.org",
    ]);
  });

  it("keep Zhiyin's own copies byte for byte the same as the project's release", () => {
    for (const spec of pinnedToolchains) {
      const [first, ...fallbacks] = spec.sources;
      for (const copy of fallbacks.filter(
        (source) => source.hosts[0] === "media.zhiyinagent.app",
      )) {
        expect(copy.sha256).toBe(first!.sha256);
        expect(copy.bytes).toBe(first!.bytes);
        expect(copy.url).toBe(
          `https://media.zhiyinagent.app/toolchains/${spec.id}/${spec.version}/${decodeURIComponent(new URL(first!.url).pathname.split("/").at(-1)!)}`,
        );
      }
    }
  });
});
