/**
 * Where an input sits in a call's arguments, written as the schema check
 * writes it: `path`, `edits[0].replacements[1].find`. A repair names the
 * inputs it changes this way, and a value is read or put back at one.
 */

type Step = string | number;

/** What could not be done at a path: a parent missing, or of another kind. */
export const unreachable: unique symbol = Symbol("unreachable");
/** Put at a path to take the input there out of the call. */
export const removed: unique symbol = Symbol("removed");

const part = /\.?([^.[\]]+)|\[(\d+)\]/y;

/** The steps of a path, or nothing when it cannot be read as one. */
export function stepsOf(path: string): readonly Step[] | undefined {
  const steps: Step[] = [];
  let at = 0;
  while (at < path.length) {
    part.lastIndex = at;
    const found = part.exec(path);
    if (!found) return undefined;
    steps.push(found[2] !== undefined ? Number(found[2]) : found[1]!);
    at = part.lastIndex;
  }
  return steps.length && typeof steps[0] === "string" ? steps : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value at a path, or `unreachable`. */
export function valueAt(root: unknown, path: string): unknown {
  const steps = stepsOf(path);
  if (!steps) return unreachable;
  let value = root;
  for (const step of steps) {
    if (typeof step === "number" ? !Array.isArray(value) : !isRecord(value))
      return unreachable;
    const container = value as Record<string | number, unknown>;
    if (!(step in container)) return unreachable;
    value = container[step];
  }
  return value;
}

/**
 * A copy of `root` with `value` at `path`, or with the input there taken out,
 * or `unreachable` when its parent is not there to hold it. Nothing else in
 * `root` changes. An item of a list is replaced in place, never added or
 * taken out, so every other path still points where it did.
 */
export function withValueAt(
  root: unknown,
  path: string,
  value: unknown,
): unknown {
  const steps = stepsOf(path);
  return steps ? put(root, steps, value) : unreachable;
}

function put(root: unknown, steps: readonly Step[], value: unknown): unknown {
  const [step, ...rest] = steps;
  if (typeof step === "number") {
    if (!Array.isArray(root) || step >= root.length) return unreachable;
    if (!rest.length && value === removed) return unreachable;
    const child = rest.length ? put(root[step], rest, value) : value;
    if (child === unreachable) return unreachable;
    return root.map((item, index) => (index === step ? child : item));
  }
  if (!isRecord(root) || step === undefined) return unreachable;
  if (!rest.length) {
    return value === removed
      ? Object.fromEntries(Object.entries(root).filter(([key]) => key !== step))
      : { ...root, [step]: value };
  }
  if (!(step in root)) return unreachable;
  const child = put(root[step], rest, value);
  return child === unreachable ? unreachable : { ...root, [step]: child };
}

/** Every key of an object held in a value, at any depth. */
export function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (isRecord(value))
    return Object.entries(value).flatMap(([key, item]) => [
      key,
      ...keysIn(item),
    ]);
  return [];
}

/** Every text, number and true-or-false held in a value, keys left out. */
export function scalarsIn(value: unknown): (string | number | boolean)[] {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return [value];
  if (Array.isArray(value)) return value.flatMap(scalarsIn);
  if (isRecord(value)) return Object.values(value).flatMap(scalarsIn);
  return [];
}
