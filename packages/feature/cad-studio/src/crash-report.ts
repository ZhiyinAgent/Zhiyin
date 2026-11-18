/**
 * What a run that crashed Python says about where: Python's fault handler
 * writes the stack of the crash to the run's error output, the most recent
 * call first. A frame of the model's own code has the name the harness gives
 * it, relative to the workspace, or the path of the run's copy of a module it
 * imports; a library's, the harness's included, has its absolute path.
 */

const FRAME = /^\s*File "(.+)", line (\d+) in (.+?)\s*$/;
const CRASH = /^(Windows fatal exception|Fatal Python error):/m;

type Frame = {
  readonly file: string;
  readonly line: number;
  readonly fn: string;
};

/**
 * A frame's file as the workspace names it, or nothing for a library's.
 * `own` holds the folders whose files are the model's, named from there.
 */
function ownName(file: string, own: readonly string[]): string | undefined {
  if (file.startsWith("<")) return undefined;
  if (!/^([A-Za-z]:[\\/]|[\\/])/.test(file)) return file;
  const plain = (path: string) => path.replaceAll("\\", "/").toLowerCase();
  for (const folder of own) {
    const base = plain(folder).replace(/\/?$/, "/");
    if (plain(file).startsWith(base))
      return file.slice(base.length).replaceAll("\\", "/");
  }
  return undefined;
}

/** The crash the error output reports, said for the model, or nothing when it reports none. */
export function crashReport(
  stderr: string,
  own: readonly string[],
): string | undefined {
  const last = [...stderr.matchAll(new RegExp(CRASH.source, "gm"))].at(-1);
  if (last?.index === undefined) return undefined;
  const frames: Frame[] = [];
  for (const line of stderr.slice(last.index).split(/\r?\n/)) {
    const found = FRAME.exec(line);
    if (found)
      frames.push({ file: found[1]!, line: Number(found[2]), fn: found[3]! });
  }
  const at = frames.findIndex((frame) => ownName(frame.file, own));
  if (at < 0) {
    const inner = frames[0];
    return `Python crashed${inner ? ` in ${inner.fn}` : ""} while the CAD studio measured the parts, and the build stopped there. This is the CAD studio's own failure, not the script's.`;
  }
  const frame = frames[at]!;
  const callee = at > 0 ? frames[at - 1]!.fn : undefined;
  return [
    `Python crashed${callee ? ` in ${callee}, called` : ""} at ${ownName(frame.file, own)} line ${frame.line}${frame.fn === "<module>" ? "" : `, in ${frame.fn}`}, and the build stopped there.`,
    "A crash in a library, such as the geometry kernel, comes from what that step gave it: change that step.",
  ].join(" ");
}
