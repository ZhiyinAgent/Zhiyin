/**
 * Whether Windows marks a file as downloaded from the internet: the Mark of
 * the Web, a `Zone.Identifier` stream beside the file that names the zone it
 * came from. A file from the Internet zone (3) or the Restricted zone (4) was
 * written by someone other than the person.
 */

import { readFile, realpath } from "node:fs/promises";
import { errorCode } from "./workspace-path.js";

const outsideZones = new Set([3, 4]);

/**
 * A file with no such stream is not marked, nor is one that does not exist.
 * A stream that is there but cannot be read is taken as marked, since nothing
 * then shows the file is the person's own.
 */
export async function downloadedFromTheInternet(
  path: string,
): Promise<boolean> {
  const real = await realpath(path).catch(() => path);
  let bytes: Buffer;
  try {
    bytes = await readFile(`${real}:Zone.Identifier`);
  } catch (error) {
    const code = errorCode(error);
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
  const text =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString("utf16le")
      : bytes.toString("utf8");
  const zone = /^\s*ZoneId\s*=\s*(\d+)\s*$/im.exec(text);
  return zone !== null && outsideZones.has(Number(zone[1]));
}

/** Whether any of `paths` is marked, looked at a few at a time. */
export async function anyDownloaded(
  paths: readonly string[],
): Promise<boolean> {
  const atOnce = 32;
  for (let start = 0; start < paths.length; start += atOnce) {
    const marked = await Promise.all(
      paths.slice(start, start + atOnce).map(downloadedFromTheInternet),
    );
    if (marked.includes(true)) return true;
  }
  return false;
}
