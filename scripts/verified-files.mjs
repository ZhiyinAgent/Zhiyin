/**
 * Fetches files the app ships into a folder, each kept only if its SHA-256 is
 * the one listed, and one already there and correct is not fetched again.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function present(path, expected) {
  try {
    return sha256(await readFile(path)) === expected;
  } catch {
    return false;
  }
}

/** How many times one file is asked for before the fetch gives up. */
const attempts = 4;

/**
 * `files` lists each file's name, address and SHA-256; `download(url)`
 * answers its bytes. One that fails is asked for again, after a wait that
 * doubles from a second: a server answers busy now and then, and a build
 * should not fail for it. A file whose SHA-256 is not the one listed is
 * refused and nothing is written for it.
 */
export async function fetchVerified({
  files,
  folder,
  download,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  await mkdir(folder, { recursive: true });
  for (const { file, url, sha256: expected } of files) {
    const target = join(folder, file);
    if (await present(target, expected)) continue;
    let bytes;
    for (let attempt = 1; bytes === undefined; attempt += 1) {
      try {
        bytes = await download(url);
      } catch (error) {
        if (attempt === attempts) throw error;
        await wait(1_000 * 2 ** (attempt - 1));
      }
    }
    if (sha256(bytes) !== expected)
      throw new Error(
        `${file} from ${url} is not the file listed: its SHA-256 differs.`,
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

/** Each listed file the folder lacks, or holds with another SHA-256. */
export async function misplacedFiles({ files, folder }) {
  const misplaced = [];
  for (const { file, sha256: expected } of files)
    if (!(await present(join(folder, file), expected))) misplaced.push(file);
  return misplaced;
}

/** Downloads with a minute's limit, so a stalled server fails the build. */
export async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}
