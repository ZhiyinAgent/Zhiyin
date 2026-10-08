/**
 * Fetches the spelling dictionaries that ship with the app into
 * `apps/desktop/dictionaries`, where packaging and the built app take them.
 *
 * Each is the file Chromium itself would download, fetched by the same name
 * from the same server, and kept only if its SHA-256 is the one listed in
 * `packages/spelling/dictionaries.json`. That list was taken from Chromium's
 * dictionary repository at the commit the bundled Chromium pins, so a file
 * kept here is byte for byte that commit's. One already here and correct is
 * not fetched again. ADR 0023.
 *
 * With `--check <folder>`, fetches nothing and fails, naming each one, if the
 * folder lacks a listed dictionary or holds one that differs: the packaged
 * app's folder, before a release.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function present(path, expected) {
  try {
    return sha256(await readFile(path)) === expected;
  } catch {
    return false;
  }
}

/**
 * `download(url)` answers the file's bytes. A file whose SHA-256 is not the
 * one listed is refused and nothing is written for it.
 */
export async function fetchDictionaries({ manifest, folder, download }) {
  await mkdir(folder, { recursive: true });
  for (const dictionary of manifest.dictionaries) {
    const target = join(folder, dictionary.file);
    if (await present(target, dictionary.sha256)) continue;
    // Chromium asks the server for the name in lower case.
    const url = manifest.source.download + dictionary.file.toLowerCase();
    const bytes = await download(url);
    if (sha256(bytes) !== dictionary.sha256)
      throw new Error(
        `${dictionary.file} from ${url} is not the dictionary listed: its SHA-256 differs.`,
      );
    const written = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(written, bytes);
      await rename(written, target);
    } finally {
      await rm(written, { force: true });
    }
  }
}

/** Each listed dictionary the folder lacks, or holds with another SHA-256. */
export async function misplacedDictionaries({ manifest, folder }) {
  const misplaced = [];
  for (const dictionary of manifest.dictionaries)
    if (!(await present(join(folder, dictionary.file), dictionary.sha256)))
      misplaced.push(dictionary.file);
  return misplaced;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(
    await readFile(
      join(repository, "packages/spelling/dictionaries.json"),
      "utf8",
    ),
  );
  const checked = process.argv.indexOf("--check");
  if (checked !== -1) {
    const folder = process.argv[checked + 1];
    if (!folder) throw new Error("--check needs the folder to check.");
    const misplaced = await misplacedDictionaries({ manifest, folder });
    for (const file of misplaced)
      console.error(
        `${folder} lacks ${file}, or holds another file by its name.`,
      );
    if (misplaced.length) process.exit(1);
    console.log(
      `${folder} holds all ${manifest.dictionaries.length} dictionaries.`,
    );
    process.exit(0);
  }
  await fetchDictionaries({
    manifest,
    folder: join(repository, "apps/desktop/dictionaries"),
    download: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
      return Buffer.from(await response.arrayBuffer());
    },
  });
  console.log(`${manifest.dictionaries.length} dictionaries in place.`);
}
