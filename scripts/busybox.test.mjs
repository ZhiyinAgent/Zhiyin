import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { builtFiles, misplacedShell, placeSource } from "./busybox.mjs";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The repository's pins, with busybox-w32's source a small stand-in already downloaded. */
async function setting() {
  const pins = JSON.parse(
    await readFile(join(repository, "scripts", "busybox", "pins.json"), "utf8"),
  );
  const tarball = Buffer.from("busybox-w32 source");
  const downloads = await folders.make("zhiyin-busybox-downloads-");
  const output = await folders.make("zhiyin-busybox-output-");
  const stand = {
    ...pins,
    busybox: { ...pins.busybox, sha256: sha256(tarball) },
  };
  await writeFile(join(downloads, pins.busybox.file), tarball);
  for (const file of builtFiles) {
    await mkdir(dirname(join(output, file)), { recursive: true });
    await writeFile(join(output, file), "built");
  }
  stand.built = Object.fromEntries(
    builtFiles.map((file) => [file, sha256(Buffer.from("built"))]),
  );
  return { pins: stand, downloads, output };
}

describe("Zhiyin's shell as the installer carries it", () => {
  it("holds the source it was built from beside it: busybox-w32's as pinned, the patches, the hand-off program and the pins", async () => {
    const { pins, downloads, output } = await setting();

    await placeSource({ repository, pins, downloads, output });

    expect((await readdir(join(output, "source"))).sort()).toEqual(
      [
        pins.busybox.file,
        ...pins.busybox.patches,
        "git-handoff.c",
        "pins.json",
      ].sort(),
    );
    expect(await misplacedShell({ repository, pins, folder: output })).toEqual(
      [],
    );
  });

  it("is named as wrong when its source is missing or differs from the pinned one", async () => {
    const { pins, downloads, output } = await setting();
    await placeSource({ repository, pins, downloads, output });
    await writeFile(
      join(output, "source", pins.busybox.file),
      "another source",
    );

    expect(await misplacedShell({ repository, pins, folder: output })).toEqual([
      `source/${pins.busybox.file}`,
    ]);
  });
});
