/**
 * Closing what the app holds open, without waiting on it for ever.
 *
 * Something that never finishes closing would otherwise keep the app alive,
 * invisibly, holding the data folder, so the next launch is told another copy
 * is running. Each owner is closed in turn, all against one deadline.
 */

/** How long quitting waits for what is still closing. */
const closeWithinMs = 5_000;

/** Whether `closing` settled, either way, before `deadline`. */
function finishedBy(closing: Promise<unknown>, deadline: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    closing.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(
        () => resolve(false),
        Math.max(0, deadline - Date.now()),
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Closes each owner in order; answers the names of those not finished in time. */
export async function closeInTurn(
  owners: readonly (readonly [string, () => Promise<void>])[],
): Promise<readonly string[]> {
  const deadline = Date.now() + closeWithinMs;
  const unfinished: string[] = [];
  for (const [owner, close] of owners)
    if (!(await finishedBy(close(), deadline))) unfinished.push(owner);
  return unfinished;
}
