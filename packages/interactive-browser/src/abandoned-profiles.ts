/**
 * Profile folders a browser of Zhiyin's left behind when Zhiyin was killed
 * before it could remove them. Each name carries the id of the Zhiyin process
 * that made it, so one whose process is gone is removed; one whose process
 * still runs, this Zhiyin or another, is kept.
 */

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Running, but owned by someone this process may not signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function clearAbandonedProfiles(directory: string): Promise<void> {
  const names = await readdir(directory).catch(() => [] as string[]);
  await Promise.all(
    names.map(async (name) => {
      const owner = /^zhiyin-browser-(\d+)-/.exec(name)?.[1];
      if (!owner || running(Number(owner))) return;
      await rm(join(directory, name), { recursive: true, force: true }).catch(
        () => {},
      );
    }),
  );
}
