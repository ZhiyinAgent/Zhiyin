/**
 * A file of lines that only grows, one record a line.
 *
 * A write a crash cut off leaves a last line with no end. The next line is
 * started on a line of its own, so the cut line costs only itself: its reader
 * skips it as it skips any line it cannot read.
 */

import { appendFile, open } from "node:fs/promises";

const missing = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

/**
 * Whether the file's last line has no end, as when a write was cut off. A file
 * that is absent or empty has no line to end.
 */
async function endsInsideLine(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (!size) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

/**
 * Adds one line to the end of the file, creating the file if there is none.
 * `line` is given without its end. A last line a crash cut off is ended first.
 */
export async function appendLine(path: string, line: string): Promise<void> {
  const opening = (await endsInsideLine(path)) ? "\n" : "";
  await appendFile(path, `${opening}${line}\n`, "utf8");
}
