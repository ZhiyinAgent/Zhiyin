/**
 * A sweep between a build's positions: each move from one listed position
 * to the next cut into even steps, every argument that differs between the
 * two stepped from one number to the other, so a mechanism is checked
 * between the positions it was given as well as at them.
 */

/** The most runs a sweep makes, the listed positions with the steps between them. */
const mostSweepRuns = 48;

/** A number as an argument is written: to six decimals, no trailing zeros. */
const written = (value: number) => String(Number(value.toFixed(6)));

/** An argument as a number, or nothing when it is not one. */
function numberOf(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The positions a build runs at for a sweep of `steps` between each two
 * listed, the listed ones among them, or why they cannot be stepped.
 */
export function steppedPositions(
  positions: readonly (readonly string[])[],
  steps: number,
):
  | { readonly ok: true; readonly positions: readonly (readonly string[])[] }
  | { readonly ok: false; readonly reason: string } {
  if (positions.length < 2)
    return {
      ok: false,
      reason:
        "steps cuts the moves between positions into steps; give two positions or more.",
    };
  const runs = (positions.length - 1) * steps + 1;
  if (runs > mostSweepRuns)
    return {
      ok: false,
      reason: `${positions.length} positions with ${steps} steps between each two make ${runs} runs; at most ${mostSweepRuns}: give fewer steps or positions.`,
    };
  const out: (readonly string[])[] = [positions[0] as readonly string[]];
  for (let k = 1; k < positions.length; k += 1) {
    const from = positions[k - 1] as readonly string[];
    const to = positions[k] as readonly string[];
    if (from.length !== to.length)
      return {
        ok: false,
        reason: `positions ${k} and ${k + 1} have ${from.length} and ${to.length} arguments; steps go between positions of as many.`,
      };
    const ends = from.map((text, i) => {
      const other = to[i] as string;
      if (text === other) return undefined;
      const a = numberOf(text);
      const b = numberOf(other);
      return a === undefined || b === undefined ? null : ([a, b] as const);
    });
    const stuck = ends.findIndex((one) => one === null);
    if (stuck >= 0)
      return {
        ok: false,
        reason: `positions ${k} and ${k + 1} differ in argument ${stuck + 1} ("${from[stuck]}" and "${to[stuck]}"), which is not a number; steps go between numbers.`,
      };
    for (let s = 1; s < steps; s += 1)
      out.push(
        from.map((text, i) => {
          const pair = ends[i];
          return pair
            ? written(pair[0] + ((pair[1] - pair[0]) * s) / steps)
            : text;
        }),
      );
    out.push(to);
  }
  return { ok: true, positions: out };
}
