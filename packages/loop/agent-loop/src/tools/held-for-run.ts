/**
 * What the model is told of the files a sealed-off program could only read
 * for its run (ADR 0012). Windows refuses the program a write to one with a
 * plain "access denied", which says nothing of why; this says which files,
 * why, and what to do. Said only when it may matter: the run failed, or what
 * it answered names a held file or a refused write. A file in the workspace
 * is named by its path there, one in a folder outside it by its whole path.
 */

import type { ToolInvocationResult } from "@zhiyin/contract";

/** Files named in the note at most; the rest are counted. */
const named = 12;

const refusal =
  /permission ?error|permission denied|access is denied|access denied|eperm|eacces|errno 13|may only be read for this run/i;

/** Why a path was held: not copied, Git's, or a Startup folder. */
type Held = {
  readonly path: string;
  readonly reason: string;
  readonly kind?: "uncopied" | "git" | "startup";
};

const inGit = (path: string) => /(^|[\\/])\.git([\\/]|$)/i.test(path);

/** Why it was held, from what it says, or from its path when it does not. */
const kindOf = (held: Held) =>
  held.kind ?? (inGit(held.path) ? "git" : "uncopied");

export function heldForRun(
  held: readonly Held[],
  result: ToolInvocationResult,
  unheldBy: string | undefined,
): string | undefined {
  if (!held.length) return undefined;
  const answered = JSON.stringify(result);
  const mentioned = held.filter(({ path }) =>
    answered.includes(path.split(/[\\/]/).at(-1) ?? path),
  );
  if (result.ok && !mentioned.length && !refusal.test(answered))
    return undefined;
  const shown = (mentioned.length ? mentioned : held).slice(0, named);
  const more = (mentioned.length ? mentioned : held).length - shown.length;
  const lines = shown.map(({ path, reason }) => `${path}: ${reason}`);
  const kinds = new Set(held.map(kindOf));
  return [
    "For this run these files could only be read; Windows refused any change to them as access denied.",
    ...lines,
    ...(more > 0 ? [`and ${more} more`] : []),
    ...(kinds.has("uncopied") && unheldBy
      ? [
          `If the script must change one of the files Zhiyin could not copy, call it again naming that file in \`${unheldBy}\`, as it is named here: the person is asked, since that change cannot be undone.`,
        ]
      : []),
    ...(kinds.has("git") ? ["Git's folder can only be read by a script."] : []),
    ...(kinds.has("startup")
      ? [
          "A Startup folder can only be read by a script: what is put there runs whenever someone signs in.",
        ]
      : []),
  ].join("\n");
}
