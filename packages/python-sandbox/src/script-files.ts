/**
 * A script in the workspace, run by its path, is shown and run as the code it
 * held when it was looked at for approval.
 *
 * Its code is read when the call is inspected, shown on the approval, and
 * bound to that approval by its digest. Before running, the file is read once
 * more: the code runs from a copy of what was read, and only when it is the
 * code that approval showed. A file changed after it was approved, by another
 * conversation or a script still running, does not run.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { locateInside } from "@zhiyin/workspace-containment";

/** A script past this many bytes is not read; its code is given instead. */
const maximumScriptBytes = 1024 * 1024;

export type ScriptFile =
  | { readonly ok: true; readonly file: string; readonly code: string }
  | { readonly ok: false; readonly reason: string };

/** A workspace script's code as it stands, or why it cannot be run. */
export async function readScript(
  root: string,
  path: string,
): Promise<ScriptFile> {
  if (!path.toLowerCase().endsWith(".py"))
    return { ok: false, reason: "Only .py files can be run." };
  const located = await locateInside(root, path);
  if (located.kind === "outside")
    return { ok: false, reason: "Only a script in the workspace can be run." };
  if (located.kind !== "found")
    return {
      ok: false,
      reason:
        located.kind === "missing"
          ? `There is no ${path} in the workspace.`
          : `${path} could not be read.`,
    };
  let bytes: Buffer;
  try {
    bytes = await readFile(located.path);
  } catch {
    return { ok: false, reason: `${path} could not be read.` };
  }
  if (bytes.length > maximumScriptBytes)
    return {
      ok: false,
      reason: `${path} is over 1 MB, too long to show for approval. Give the code to run instead.`,
    };
  try {
    return {
      ok: true,
      file: located.path,
      code: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { ok: false, reason: `${path} is not UTF-8 text.` };
  }
}

const digest = (code: string) =>
  createHash("sha256").update(code, "utf8").digest("hex");

/** What an approval of a workspace script is bound to: the file and its code. */
export const scriptIdentity = (file: string, code: string): string =>
  JSON.stringify({ script: file, code: digest(code) });

/**
 * Why this code may not run as the file's, given the identity of the approval
 * it runs under, or nothing when it may.
 */
export function bindingRefusal(
  binding: string | undefined,
  file: string,
  code: string,
): string | undefined {
  if (binding === undefined)
    return "The script was not shown for approval, so it did not run.";
  return binding === scriptIdentity(file, code)
    ? undefined
    : "The script changed after it was approved, so it did not run.";
}

/**
 * Python's arguments to run an approved copy as the workspace file itself:
 * its own folder first on the import path, its path as `__file__` and
 * `sys.argv[0]`, and a `__main__` holding nothing else, so its neighbours
 * import and a pool's workers find it, while the code run is the copy's.
 */
export function asTheFile(
  copy: string,
  file: string,
  scriptArguments: readonly string[],
): string[] {
  const bootstrap = [
    "(lambda sys, os, main, builtins, given: (",
    "sys.argv.__setitem__(slice(None), given[1:]),",
    "sys.path.__setitem__(slice(0, 1 if sys.path[:1] == [''] else 0), [os.path.dirname(given[1])]),",
    "main.__dict__.clear(),",
    "main.__dict__.update(__name__='__main__', __file__=given[1], __builtins__=builtins, __doc__=None, __package__=None, __spec__=None, __loader__=None, __cached__=None),",
    "builtins.exec(builtins.compile(builtins.open(given[0], 'rb').read(), given[1], 'exec'), main.__dict__),",
    "))(__import__('sys'), __import__('os'), __import__('__main__'), __import__('builtins'), __import__('sys').argv[1:])",
  ].join("");
  return ["-c", bootstrap, copy, file, ...scriptArguments];
}

export type ScriptSource =
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "neither"; readonly reason: string };

/** What a call asks to run: code it gives, or a workspace script. Blank code is none. */
export function scriptSource(
  args: Readonly<Record<string, unknown>>,
): ScriptSource {
  const code = args["code"];
  const path = args["path"];
  const hasCode = typeof code === "string" && code.trim() !== "";
  const hasPath = typeof path === "string" && path.trim() !== "";
  if (hasCode && hasPath)
    return {
      kind: "neither",
      reason: "Give code to run or a script path, not both.",
    };
  if (hasCode) return { kind: "code", code: code as string };
  if (hasPath) return { kind: "file", path: path as string };
  return { kind: "neither", reason: "Give code to run or a script path." };
}
