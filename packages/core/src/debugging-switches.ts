/**
 * Chromium's own debugging switches open the window to whatever program speaks
 * its debugging protocol: through the page it can call every command the
 * window can, answer approvals included. A build run from source keeps them for
 * whoever is working on it. The installed app refuses to start with either, so
 * no program on a person's computer can drive Zhiyin by starting it this way.
 */

const DEBUGGING_SWITCHES = [
  "remote-debugging-port",
  "remote-debugging-pipe",
] as const;

/**
 * Why the app must not start with the switches it was given, or undefined to
 * go on. `hasSwitch` answers for Chromium's command line, without the dashes.
 */
export function debuggingRefusal(
  hasSwitch: (name: string) => boolean,
  packaged: boolean,
): string | undefined {
  if (!packaged) return undefined;
  const given = DEBUGGING_SWITCHES.filter((name) => hasSwitch(name));
  if (!given.length) return undefined;
  return `Zhiyin did not start: it was started with ${given
    .map((name) => `--${name}`)
    .join(
      " and ",
    )}, which would let another program drive its window, approvals included.`;
}
