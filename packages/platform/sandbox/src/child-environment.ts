/**
 * What a process Zhiyin starts is given: the environment it was handed, or
 * Zhiyin's own, never with a model key Zhiyin itself was given. In an
 * automated run such keys arrive as `ZHIYIN_<PROVIDER>_API_KEY` variables, and
 * a command, a script or a program Zhiyin starts has no use for them.
 */

const ownKey = /^ZHIYIN_\w*API_KEY$/i;

export function childEnvironment(
  given: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(given).filter(([name]) => !ownKey.test(name)),
  );
}
