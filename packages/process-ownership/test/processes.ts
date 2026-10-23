/** What the tests ask the operating system about the processes they start. */

/** Polls rather than sleeps, so a slow machine waits and a fast one does not. */
export async function until<T>(
  attempt: () => Promise<T | undefined>,
  give_up_after = 15_000,
): Promise<T> {
  const deadline = Date.now() + give_up_after;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Asks the operating system, not our own bookkeeping, whether a pid is alive. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

export async function allGone(pids: readonly number[]): Promise<void> {
  await until(async () => {
    const surviving = pids.filter((pid) => alive(pid));
    if (surviving.length === 0) return true;
    return undefined;
  }, 20_000).catch(() => {
    throw new Error(
      `Processes survived containment: ${pids.filter((pid) => alive(pid)).join(", ")}`,
    );
  });
}
