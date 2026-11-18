/**
 * Where the sandbox's downloads come from, as its approvals name them, and
 * running a step that downloads again from mirrors when its own sites cannot
 * be reached (ADR 0027).
 */

import type { ProcessRun as ProgramRun } from "@zhiyin/sandbox";

/**
 * Where a call is sent, as an approval names it: the package names it lists
 * go to the Python Package Index, or its mirror. Nothing of a call goes to
 * where Python itself comes from; that download is said as what making an
 * environment does.
 */
const packageIndex = "pypi.org";
/**
 * Where the same downloads come from when their own sites cannot be reached,
 * as from many networks in mainland China (ADR 0027): Tsinghua University's
 * copy of the package index, and npmmirror's of python-build-standalone. uv
 * checks each Python against the fingerprint it keeps, and the lock each
 * pinned package's, whichever site gave them.
 */
const packageMirror = "pypi.tuna.tsinghua.edu.cn";
export const packageMirrorIndex = `https://${packageMirror}/simple`;
export const pythonMirror =
  "https://registry.npmmirror.com/-/binary/python-build-standalone";
/** Where a call's package names may go: the index, then its mirror. */
export const packageIndexes = [packageIndex, packageMirror];
/**
 * What making an environment can download: uv fetches Python from Astral's
 * mirror of python-build-standalone, or from its GitHub releases, when no
 * Python of that version is found, and pip from the Python Package Index;
 * and each from a mirror when those cannot be reached.
 */
export const makingDownloads =
  "Making it can download Python from releases.astral.sh, or from github.com through release-assets.githubusercontent.com, and pip from pypi.org through files.pythonhosted.org. When those cannot be reached, it downloads Python from registry.npmmirror.com through cdn.npmmirror.com, and pip from pypi.tuna.tsinghua.edu.cn.";

/**
 * The same places, as hosts in the order they are tried, for an install that
 * lists what it downloads: Python, then the packages and pip.
 */
export const pythonHosts = [
  "releases.astral.sh",
  "github.com",
  "release-assets.githubusercontent.com",
  "registry.npmmirror.com",
  "cdn.npmmirror.com",
];
export const packageHosts = [
  "pypi.org",
  "files.pythonhosted.org",
  packageMirror,
];

/**
 * Whether a step failed because what it downloads from did not answer, as uv
 * and pip say it, or ran out of time, as a download that crawls does.
 */
function unreachable(ran: ProgramRun): boolean {
  if (ran.exitCode === 0 || ran.failure || ran.ending === "stopped")
    return false;
  return (
    ran.ending === "timeout" ||
    /Failed to (?:download|fetch)|error sending request|Retrying \(Retry\(|Max retries exceeded/.test(
      `${ran.stdout}\n${ran.stderr}`,
    )
  );
}

/**
 * Runs a step that downloads, and once more from the mirrors when what it
 * downloads from could not be reached.
 */
export async function reaching(
  step: (mirrors: boolean) => Promise<ProgramRun>,
  signal?: AbortSignal,
): Promise<ProgramRun> {
  const ran = await step(false);
  return unreachable(ran) && !signal?.aborted ? step(true) : ran;
}
