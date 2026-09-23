/**
 * What changed between two saves of one document, as the smallest edits that
 * turn the first into the second, and how those edits are applied back.
 *
 * The edits are made against what the document looks like written down —
 * a field left `undefined` is absent, as it is in a saved file — and applying
 * them to the saved form of the first document gives the saved form of the
 * second exactly, field order included. That exactness is a requirement, not a
 * nicety: a pending rewind recognises a conversation by its saved text.
 */

type Key = string | number;

/** One edit, at a path of field names and list positions. */
export type HistoryChange =
  /** The value there is now this. A list position one past the end appends. */
  | { readonly p: readonly Key[]; readonly set: unknown }
  /** The field is gone. */
  | { readonly p: readonly Key[]; readonly del: 1 }
  /** The list there is cut to this length. */
  | { readonly p: readonly Key[]; readonly len: number }
  /** The text there grew by this. */
  | { readonly p: readonly Key[]; readonly add: string };

type Written = Record<string, unknown>;

function isRecord(value: unknown): value is Written {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a field with this value is written at all. */
function written(value: unknown): boolean {
  return (
    value !== undefined &&
    typeof value !== "function" &&
    typeof value !== "symbol"
  );
}

/** A list entry is always written: one that has no value is written as null. */
function entry(value: unknown): unknown {
  return written(value) ? value : null;
}

function writtenKeys(record: Written): string[] {
  return Object.keys(record).filter((key) => written(record[key]));
}

/**
 * Whether the second record's fields are the first's, less some, plus some at
 * the end — the only reorderings that field-by-field edits reproduce exactly.
 */
function keepsOrder(before: string[], after: string[]): boolean {
  const staying = new Set(after);
  const kept = before.filter((key) => staying.has(key));
  const had = new Set(before);
  const added = after.filter((key) => !had.has(key));
  const expected = [...kept, ...added];
  return expected.every((key, index) => key === after[index]);
}

function collect(
  before: unknown,
  after: unknown,
  path: Key[],
  into: HistoryChange[],
): void {
  if (before === after) return;
  if (typeof before === "string" && typeof after === "string") {
    if (after.startsWith(before))
      into.push({ p: path, add: after.slice(before.length) });
    else into.push({ p: path, set: after });
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (after.length < before.length) into.push({ p: path, len: after.length });
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1)
      collect(
        entry(before[index]),
        entry(after[index]),
        [...path, index],
        into,
      );
    for (let index = before.length; index < after.length; index += 1)
      into.push({ p: [...path, index], set: entry(after[index]) });
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const had = writtenKeys(before);
    const has = writtenKeys(after);
    if (!keepsOrder(had, has)) {
      into.push({ p: path, set: after });
      return;
    }
    const staying = new Set(has);
    for (const key of had)
      if (!staying.has(key)) into.push({ p: [...path, key], del: 1 });
    const existed = new Set(had);
    for (const key of has)
      if (existed.has(key))
        collect(before[key], after[key], [...path, key], into);
    for (const key of has)
      if (!existed.has(key)) into.push({ p: [...path, key], set: after[key] });
    return;
  }
  if (Number.isNaN(before) && Number.isNaN(after)) return;
  into.push({ p: path, set: after });
}

/** The edits that turn the saved form of `before` into that of `after`. */
export function changesBetween(
  before: unknown,
  after: unknown,
): HistoryChange[] {
  const changes: HistoryChange[] = [];
  collect(before, after, [], changes);
  return changes;
}

function container(root: unknown, path: readonly Key[]): Written | unknown[] {
  let at: unknown = root;
  for (const key of path) at = (at as Written)[key as string];
  if (typeof at !== "object" || at === null)
    throw new Error("A saved change points at something that is not there.");
  return at as Written | unknown[];
}

/**
 * The document after these edits. `document` must be freshly read, as it is
 * changed in place.
 */
export function applyChanges(
  document: unknown,
  changes: readonly HistoryChange[],
): unknown {
  let root = document;
  for (const change of changes) {
    if ("len" in change) {
      const list = container(root, change.p);
      if (!Array.isArray(list))
        throw new Error(
          "A saved change shortens something that is not a list.",
        );
      list.length = change.len;
      continue;
    }
    if (!change.p.length) {
      if (!("set" in change))
        throw new Error("A saved change edits the whole document in place.");
      root = change.set;
      continue;
    }
    const parent = container(root, change.p.slice(0, -1)) as Written;
    const key = change.p.at(-1) as string;
    if ("set" in change) parent[key] = change.set;
    else if ("del" in change) delete parent[key];
    else if (typeof parent[key] === "string") parent[key] += change.add;
    else throw new Error("A saved change extends something that is not text.");
  }
  return root;
}
