/**
 * Which lines two versions of a file share, in order, at a cost that follows
 * the size of the change rather than the size of the file.
 *
 * Myers' method finds the shortest list of lines to remove and add. Its cost
 * grows with the length of the file times the number of lines that differ, so
 * a long file edited in a few places is quick to compare and a long file
 * rewritten throughout is not. Once a comparison has spent its share of the
 * work, the lines that appear exactly once in each version are taken as fixed
 * points where they keep their order, and the stretches between them are
 * compared on their own. A stretch with no such line, as in a file of a few
 * repeated lines, is compared line by line when it is short enough to afford
 * it, and otherwise reported as replaced.
 */

export type LineStep =
  | { readonly kind: "same"; readonly before: number; readonly after: number }
  | { readonly kind: "removed"; readonly before: number }
  | { readonly kind: "added"; readonly after: number };

/**
 * Work one whole comparison may spend on shortest lists, counted in diagonal
 * steps. Tens of milliseconds, whatever the files.
 */
const shortestListWork = 4_000_000;

/** Work it may spend finding fixed points, counted in lines looked at. */
const fixedPointWork = 4_000_000;

/** What any one shortest list may spend however little is left: a short stretch is always compared. */
const leastWork = 1_000;

/** The longest stretch, both versions together, compared line by line. */
const tableLines = 4_000;

/** Cells one whole comparison may fill comparing stretches line by line. */
const tableWork = 16_000_000;

type Budget = { shortest: number; fixed: number; table: number };

/** Lines as whole numbers, so comparing two lines is comparing two numbers. */
function numbered(before: readonly string[], after: readonly string[]) {
  const ids = new Map<string, number>();
  const id = (line: string) => {
    let known = ids.get(line);
    if (known === undefined) {
      known = ids.size;
      ids.set(line, known);
    }
    return known;
  };
  return { a: Int32Array.from(before, id), b: Int32Array.from(after, id) };
}

export function lineSteps(
  before: readonly string[],
  after: readonly string[],
): LineStep[] {
  const { a, b } = numbered(before, after);
  const steps: LineStep[] = [];
  const budget = {
    shortest: shortestListWork,
    fixed: fixedPointWork,
    table: tableWork,
  };
  compare({ a, b, budget, steps }, 0, a.length, 0, b.length);
  return steps;
}

type Comparison = {
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly budget: Budget;
  readonly steps: LineStep[];
};

/** The lines both stretches open and close with are the same lines. */
function compare(
  c: Comparison,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): void {
  const { a, b, steps } = c;
  while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
    steps.push({ kind: "same", before: aStart, after: bStart });
    aStart += 1;
    bStart += 1;
  }
  let shared = 0;
  while (
    aEnd - shared > aStart &&
    bEnd - shared > bStart &&
    a[aEnd - 1 - shared] === b[bEnd - 1 - shared]
  )
    shared += 1;
  between(c, aStart, aEnd - shared, bStart, bEnd - shared);
  for (let k = shared; k > 0; k -= 1)
    steps.push({ kind: "same", before: aEnd - k, after: bEnd - k });
}

function between(
  c: Comparison,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): void {
  const { steps } = c;
  if (aStart === aEnd || bStart === bEnd) {
    replaced(steps, aStart, aEnd, bStart, bEnd);
    return;
  }
  const shortest = shortestList(c, aStart, aEnd, bStart, bEnd);
  if (shortest) {
    for (const step of shortest) steps.push(step);
    return;
  }
  const fixed = fixedPoints(c, aStart, aEnd, bStart, bEnd);
  if (!fixed.length) {
    if (!lineByLine(c, aStart, aEnd, bStart, bEnd))
      replaced(steps, aStart, aEnd, bStart, bEnd);
    return;
  }
  let i = aStart;
  let j = bStart;
  for (const [x, y] of fixed) {
    compare(c, i, x, j, y);
    steps.push({ kind: "same", before: x, after: y });
    i = x + 1;
    j = y + 1;
  }
  compare(c, i, aEnd, j, bEnd);
}

function replaced(
  steps: LineStep[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): void {
  for (let i = aStart; i < aEnd; i += 1)
    steps.push({ kind: "removed", before: i });
  for (let j = bStart; j < bEnd; j += 1)
    steps.push({ kind: "added", after: j });
}

/**
 * The longest run of lines both stretches share, from the usual table, when
 * the stretch is short enough and the budget allows. Says whether it ran.
 */
function lineByLine(
  c: Comparison,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  const { a, b, budget, steps } = c;
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  if (n + m > tableLines || n * m > budget.table) return false;
  budget.table -= n * m;
  // Shared lengths fit in 16 bits: neither stretch is longer than the limit.
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = table[i]!;
    const next = table[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1)
      row[j] =
        a[aStart + i] === b[bStart + j]
          ? next[j + 1]! + 1
          : Math.max(next[j]!, row[j + 1]!);
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[aStart + i] === b[bStart + j]) {
      steps.push({ kind: "same", before: aStart + i, after: bStart + j });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      steps.push({ kind: "removed", before: aStart + i });
      i += 1;
    } else {
      steps.push({ kind: "added", after: bStart + j });
      j += 1;
    }
  }
  replaced(steps, aStart + i, aEnd, bStart + j, bEnd);
  return true;
}

/**
 * Myers' greedy method, keeping the furthest point reached on each diagonal
 * after every round so the path can be walked back. Gives up, spending what
 * it used, once a round ends past its share of the budget.
 */
function shortestList(
  c: Comparison,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): LineStep[] | undefined {
  const { a, b, budget } = c;
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  const most = n + m;
  const limit = Math.max(budget.shortest / 2, leastWork);
  const offset = most + 1;
  const reach = new Int32Array(2 * most + 3);
  const rounds: Int32Array[] = [];
  let work = 0;
  for (let d = 0; d <= most; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && reach[offset + k - 1]! < reach[offset + k + 1]!)
          ? reach[offset + k + 1]!
          : reach[offset + k - 1]! + 1;
      let y = x - k;
      const from = x;
      while (x < n && y < m && a[aStart + x] === b[bStart + y]) {
        x += 1;
        y += 1;
      }
      work += 1 + x - from;
      reach[offset + k] = x;
      if (x >= n && y >= m) {
        budget.shortest -= work;
        return walkBack(rounds, d, n, m, aStart, bStart);
      }
    }
    rounds.push(reach.slice(offset - d, offset + d + 1));
    if (work > limit) {
      budget.shortest -= work;
      return undefined;
    }
  }
  return undefined;
}

function walkBack(
  rounds: readonly Int32Array[],
  last: number,
  n: number,
  m: number,
  aStart: number,
  bStart: number,
): LineStep[] {
  const steps: LineStep[] = [];
  let x = n;
  let y = m;
  for (let d = last; d > 0; d -= 1) {
    const previous = rounds[d - 1]!;
    const at = (k: number) => previous[k + d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const fromK = down ? k + 1 : k - 1;
    const fromX = at(fromK);
    const fromY = fromX - fromK;
    while (x > fromX && y > fromY) {
      x -= 1;
      y -= 1;
      steps.push({ kind: "same", before: aStart + x, after: bStart + y });
    }
    if (down) {
      y -= 1;
      steps.push({ kind: "added", after: bStart + y });
    } else {
      x -= 1;
      steps.push({ kind: "removed", before: aStart + x });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    steps.push({ kind: "same", before: aStart + x, after: bStart + y });
  }
  return steps.reverse();
}

/**
 * Lines found exactly once in each stretch, as many as keep their order in
 * both: the longest increasing run of their places, found by patience sorting.
 */
function fixedPoints(
  c: Comparison,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): (readonly [number, number])[] {
  const { a, b, budget } = c;
  budget.fixed -= aEnd - aStart + (bEnd - bStart);
  if (budget.fixed < 0) return [];
  const inA = new Map<number, number>();
  for (let i = aStart; i < aEnd; i += 1)
    inA.set(a[i]!, inA.has(a[i]!) ? -1 : i);
  const inB = new Map<number, number>();
  for (let j = bStart; j < bEnd; j += 1)
    inB.set(b[j]!, inB.has(b[j]!) ? -1 : j);
  const pairs: (readonly [number, number])[] = [];
  for (let i = aStart; i < aEnd; i += 1) {
    const j = inB.get(a[i]!);
    if (inA.get(a[i]!) === i && j !== undefined && j >= 0) pairs.push([i, j]);
  }
  const tops: number[] = [];
  const below = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([, j], index) => {
    let low = 0;
    let high = tops.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pairs[tops[middle]!]![1] < j) low = middle + 1;
      else high = middle;
    }
    if (low > 0) below[index] = tops[low - 1]!;
    tops[low] = index;
  });
  const run: (readonly [number, number])[] = [];
  for (let index = tops.at(-1) ?? -1; index >= 0; index = below[index]!)
    run.push(pairs[index]!);
  return run.reverse();
}
