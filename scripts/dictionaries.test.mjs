import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchDictionaries, misplacedDictionaries } from "./dictionaries.mjs";

const folders = [];

afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const french = Buffer.from("French dictionary");
const german = Buffer.from("German dictionary");

const manifest = {
  source: { download: "https://dictionaries.example/" },
  dictionaries: [
    {
      language: "fr",
      file: "fr-FR-3-0.bdic",
      sha256: sha256(french),
      bytes: french.length,
    },
    {
      language: "de",
      file: "de-DE-3-0.bdic",
      sha256: sha256(german),
      bytes: german.length,
    },
  ],
};

async function folder() {
  const made = await mkdtemp(join(tmpdir(), "zhiyin-dictionaries-"));
  folders.push(made);
  return made;
}

describe("the dictionaries bundled with the app", () => {
  it("are fetched by the name Chromium asks for and kept only as listed, and one already there is not fetched again", async () => {
    const target = await folder();
    await writeFile(join(target, "fr-FR-3-0.bdic"), french);
    const asked = [];

    await fetchDictionaries({
      manifest,
      folder: target,
      download: async (url) => {
        asked.push(url);
        return german;
      },
    });

    expect(asked).toEqual(["https://dictionaries.example/de-de-3-0.bdic"]);
    expect(await readFile(join(target, "de-DE-3-0.bdic"))).toEqual(german);
    expect((await readdir(target)).sort()).toEqual([
      "de-DE-3-0.bdic",
      "fr-FR-3-0.bdic",
    ]);
  });

  it("refuses a download that is not the dictionary listed, and writes nothing for it", async () => {
    const target = await folder();

    await expect(
      fetchDictionaries({
        manifest,
        folder: target,
        download: async () => Buffer.from("something else"),
      }),
    ).rejects.toThrow(/fr-FR-3-0\.bdic.*SHA-256/);
    expect(await readdir(target)).toEqual([]);
  });

  it("are each named when a folder lacks one or holds it damaged, and none are when all are there", async () => {
    const target = await folder();
    await writeFile(join(target, "fr-FR-3-0.bdic"), Buffer.from("damaged"));

    expect(await misplacedDictionaries({ manifest, folder: target })).toEqual([
      "fr-FR-3-0.bdic",
      "de-DE-3-0.bdic",
    ]);

    await writeFile(join(target, "fr-FR-3-0.bdic"), french);
    await writeFile(join(target, "de-DE-3-0.bdic"), german);
    expect(await misplacedDictionaries({ manifest, folder: target })).toEqual(
      [],
    );
  });
});
