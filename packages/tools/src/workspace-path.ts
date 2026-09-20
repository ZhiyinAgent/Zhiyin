/**
 * The containment rule every workspace tool depends on, in one place.
 *
 * Each tool applies it twice: once while inspecting, so a request that could
 * escape the workspace is never presented for approval, and again after
 * resolving links, so a path that becomes an escape between those two moments
 * still does not run.
 */

import { isAbsolute, relative, sep } from "node:path";

/** Tools speak workspace-relative, forward-slashed paths, on every platform. */
export function toForwardSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

/**
 * The same, for a path a model supplied. Surrounding whitespace is stripped
 * here and nowhere else: a name discovered on disk may legitimately begin with
 * a space, and trimming it would report a file that does not exist.
 */
export function normalizePath(value: string): string {
  return toForwardSlashes(value.trim());
}

/**
 * Where a resolved path sits relative to the folder the person selected.
 *
 * Reaching outside that folder is permitted, but it is a different action with
 * a different consequence, so it is named rather than silently allowed. The
 * answer is computed here and carried to the permission engine; nothing
 * downstream re-derives it from the displayed target.
 */
export type PathScope = "workspace" | "outside";

export function scopeOf(root: string, target: string): PathScope {
  return staysInside(root, target) ? "workspace" : "outside";
}

export function staysInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** A size a person can read, for permission requests about existing files. */
export function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Arguments as shown to the person approving them. Long text is shortened
 * because the request is read, not replayed; the shortening is deterministic so
 * the same call always inspects to the same request.
 */
export function describeCommand(name: string, args: unknown): string {
  const shortened = JSON.stringify(args, (_key, value: unknown) =>
    typeof value === "string" && value.length > 200
      ? `${value.slice(0, 200)}…`
      : value,
  );
  return `${name}(${shortened})`;
}
