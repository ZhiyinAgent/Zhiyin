/**
 * The script a build runs, as the person approves it: code given in the
 * call, or a workspace `.py` file read once and shown whole.
 */

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, sep } from "node:path";
import { locateInside } from "@zhiyin/workspace-containment";

/** The longest script read, as a workspace file or as code. */
export const largestScript = 1024 * 1024;

/** The longest script, as the model is told it. */
export const largestScriptWords = `${largestScript / 1024 / 1024} MB`;

const smaller =
  "Move parts of it into workspace modules it imports, or have it read its data from a workspace file.";

export type Script =
  | {
      readonly ok: true;
      readonly code: string;
      /** The workspace file it was read from, when it was. */
      readonly file?: { readonly relative: string; readonly absolute: string };
    }
  | { readonly ok: false; readonly reason: string; readonly outside?: true };

/**
 * Why a script cannot be shown as what runs, if it cannot. Python reads a
 * script in whatever encoding its first or second line declares, and in
 * another than UTF-8 text shown as a comment can be code.
 */
function declaredEncoding(source: string): string | undefined {
  for (const line of source.split(/\r\n|\r|\n/).slice(0, 2)) {
    const declared = /^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/.exec(line)?.[1];
    if (declared !== undefined && !/^utf[-_]?8$/i.test(declared))
      return `This script declares the ${declared} encoding, so Python would read it differently from what is shown. Remove that line, or declare utf-8.`;
  }
  return undefined;
}

export async function scriptOf(
  root: string,
  args: Readonly<Record<string, unknown>>,
): Promise<Script> {
  const code =
    typeof args["code"] === "string" && args["code"].trim()
      ? args["code"]
      : undefined;
  const path = args["file"];
  if (code !== undefined && path !== undefined)
    return { ok: false, reason: "Give code or a file, not both." };
  if (code !== undefined) {
    if (code.length > largestScript)
      return {
        ok: false,
        reason: `A script may be at most ${largestScriptWords}. ${smaller}`,
      };
    const refused = declaredEncoding(code);
    return refused ? { ok: false, reason: refused } : { ok: true, code };
  }
  if (typeof path !== "string" || !path.trim())
    return {
      ok: false,
      reason: "Give the script as code, or as a .py file in the workspace.",
    };
  if (extname(path).toLowerCase() !== ".py")
    return { ok: false, reason: `${path} is not a .py file.` };
  const located = await locateInside(root, path);
  if (located.kind === "outside")
    return {
      ok: false,
      reason: `${path} is outside the workspace.`,
      outside: true,
    };
  if (located.kind !== "found")
    return {
      ok: false,
      reason:
        located.kind === "missing"
          ? `${path} does not exist in the workspace.`
          : `${path} could not be read.`,
    };
  if ((await stat(located.path)).size > largestScript)
    return {
      ok: false,
      reason: `${path} is over ${largestScriptWords}, the most a script may be. ${smaller}`,
    };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(located.path),
    );
  } catch {
    return { ok: false, reason: `${path} is not UTF-8 text.` };
  }
  const refused = declaredEncoding(text);
  if (refused) return { ok: false, reason: refused };
  const realRoot = await realpath(root);
  return {
    ok: true,
    code: text,
    file: {
      relative: relative(realRoot, located.path).split(sep).join("/"),
      absolute: located.path,
    },
  };
}

/** A script's fingerprint, for binding an approval to the code it showed. */
export const fingerprint = (code: string) =>
  createHash("sha256").update(code, "utf8").digest("hex");
