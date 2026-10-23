/**
 * Fetches the spelling dictionaries that ship with the app into
 * `apps/desktop/dictionaries`, where packaging and the built app take them.
 *
 * Each is the file Chromium itself would download, fetched by the same name
 * from the same server, and kept only if its SHA-256 is the one listed in
 * `packages/spelling/dictionaries.json`. That list was taken from Chromium's
 * dictionary repository at the commit the bundled Chromium pins, so a file
 * kept here is byte for byte that commit's. One already here and correct is
 * not fetched again. ADR 0030.
 *
 * With `--check <folder>`, fetches nothing and fails, naming each one, if the
 * folder lacks a listed dictionary or holds one that differs: the packaged
 * app's folder, before a release.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { download, fetchVerified, misplacedFiles } from "./verified-files.mjs";

/** Each dictionary, at the address Chromium asks for: its name in lower case. */
const listed = (manifest) =>
  manifest.dictionaries.map(({ file, sha256 }) => ({
    file,
    sha256,
    url: manifest.source.download + file.toLowerCase(),
  }));

/**
 * `download(url)` answers the file's bytes. One that fails is asked for
 * again, after a wait that doubles from a second. A file whose SHA-256 is not
 * the one listed is refused and nothing is written for it.
 */
export function fetchDictionaries({ manifest, folder, download, wait }) {
  return fetchVerified({ files: listed(manifest), folder, download, wait });
}

/** Each listed dictionary the folder lacks, or holds with another SHA-256. */
export function misplacedDictionaries({ manifest, folder }) {
  return misplacedFiles({ files: listed(manifest), folder });
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
    download,
  });
  console.log(`${manifest.dictionaries.length} dictionaries in place.`);
}
