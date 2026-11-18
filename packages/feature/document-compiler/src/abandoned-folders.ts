import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** A folder a run made, this old, was left by a run that never finished. */
const abandonedAfterMs = 60 * 60_000;

/**
 * Removes the folders in `parent` that runs which never finished left: each
 * whose name `ours` picks and that has not changed for an hour. `removed`
 * hears each one taken away.
 */
export async function clearAbandoned(
  parent: string,
  ours: (name: string) => boolean,
  removed: (path: string) => void = () => {},
): Promise<void> {
  for (const entry of await readdir(parent).catch(() => [])) {
    if (!ours(entry)) continue;
    const path = join(parent, entry);
    const status = await stat(path).catch(() => undefined);
    if (
      status?.isDirectory() &&
      Date.now() - status.mtimeMs > abandonedAfterMs
    ) {
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
      removed(path);
    }
  }
}
