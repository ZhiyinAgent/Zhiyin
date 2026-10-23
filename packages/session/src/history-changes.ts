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

/**
 * A step in a path: a field name, a list position, or — in a list whose
 * entries all have distinct ids — the entry with that id, so a saved line says
 * which entry changed and stays true when others are added or removed.
 */
type Key = string | number | { readonly id: string };

/** Where an entry goes in a list with ids: after this one, or first. */
type After = string | null;

/** One edit, at a path. */
export type HistoryChange =
  /** The value there is now this. A list position one past the end appends. */
  | { readonly p: readonly Key[]; readonly set: unknown }
  /** The field is gone. */
  | { readonly p: readonly Key[]; readonly del: 1 }
  /** The list there is cut to this length. */
  | { readonly p: readonly Key[]; readonly len: number }
  /** The text there grew by this. */
  | { readonly p: readonly Key[]; readonly add: string }
  /** This entry is added to the list there. */
  | { readonly p: readonly Key[]; readonly put: unknown; readonly after: After }
  /** The entry with this id is removed from the list there. */
  | { readonly p: readonly Key[]; readonly drop: string }
  /** The entry with this id moves within the list there. */
  | {
      readonly p: readonly Key[];
      readonly move: string;
      readonly after: After;
    };

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

/** The ids of a list whose entries are all records with distinct ids. */
function idsOf(list: readonly unknown[]): string[] | undefined {
  const ids: string[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== "string") return undefined;
    ids.push(item.id);
  }
  return new Set(ids).size === ids.length ? ids : undefined;
}

/** Which of these positions lie on a longest increasing run. */
function longestRun(positions: readonly number[]): Set<number> {
  const ends: number[] = [];
  const previous: number[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    let low = 0;
    let high = ends.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (positions[ends[middle]!]! < positions[index]!) low = middle + 1;
      else high = middle;
    }
    previous[index] = low ? ends[low - 1]! : -1;
    ends[low] = index;
  }
  const run = new Set<number>();
  for (let at = ends.at(-1) ?? -1; at >= 0; at = previous[at]!)
    run.add(positions[at]!);
  return run;
}

/**
 * The edits between two lists whose entries have ids. Entries that keep their
 * order stay put; each other entry is added, removed or moved by id, placed
 * after the entry before it, so a change costs the entries it touches.
 */
function collectById(
  before: readonly Written[],
  after: readonly Written[],
  path: Key[],
  into: HistoryChange[],
): void {
  const had = new Map(before.map((item) => [item.id as string, item]));
  const has = new Map(after.map((item, index) => [item.id as string, index]));
  for (const id of had.keys())
    if (!has.has(id)) into.push({ p: path, drop: id });
  const kept = [...had.keys()].flatMap((id) => {
    const index = has.get(id);
    return index === undefined ? [] : [index];
  });
  const staying = longestRun(kept);
  after.forEach((item, index) => {
    const id = item.id as string;
    const placed = index ? (after[index - 1]!.id as string) : null;
    if (!had.has(id)) into.push({ p: path, put: item, after: placed });
    else if (!staying.has(index))
      into.push({ p: path, move: id, after: placed });
  });
  for (const item of after) {
    const id = item.id as string;
    const old = had.get(id);
    if (old) collect(old, item, [...path, { id }], into);
  }
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
    if (idsOf(before) && idsOf(after)) {
      collectById(before as Written[], after as Written[], path, into);
      return;
    }
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

function missing(): never {
  throw new Error("A saved change points at something that is not there.");
}

/** Where the entry with this id is in a list, which must hold it. */
function indexOf(list: unknown, id: string): number {
  if (!Array.isArray(list)) missing();
  const index = list.findIndex((item) => isRecord(item) && item.id === id);
  return index < 0 ? missing() : index;
}

/** The field name or list position a step of a path stands for. */
function step(parent: unknown, key: Key): string | number {
  return typeof key === "object" ? indexOf(parent, key.id) : key;
}

function container(root: unknown, path: readonly Key[]): Written | unknown[] {
  let at: unknown = root;
  for (const key of path) at = (at as Written)[step(at, key)];
  if (typeof at !== "object" || at === null) missing();
  return at as Written | unknown[];
}

/** Puts an entry into a list with ids, after the one named. */
function place(list: unknown[], entry: unknown, after: After): void {
  list.splice(after === null ? 0 : indexOf(list, after) + 1, 0, entry);
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
    if ("put" in change || "drop" in change || "move" in change) {
      const list = container(root, change.p);
      if (!Array.isArray(list))
        throw new Error(
          "A saved change edits an entry of something that is not a list.",
        );
      if ("put" in change) place(list, change.put, change.after);
      else if ("drop" in change) list.splice(indexOf(list, change.drop), 1);
      else {
        const [moved] = list.splice(indexOf(list, change.move), 1);
        place(list, moved, change.after);
      }
      continue;
    }
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
    const key = step(parent, change.p.at(-1)!) as string;
    if ("set" in change) parent[key] = change.set;
    else if ("del" in change) delete parent[key];
    else if (typeof parent[key] === "string") parent[key] += change.add;
    else throw new Error("A saved change extends something that is not text.");
  }
  return root;
}
