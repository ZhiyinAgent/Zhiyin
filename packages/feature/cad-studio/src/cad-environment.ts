/**
 * The Python environment the studio builds in, for whoever keeps it to make
 * and run (ADR 0023): build123d, the OpenCASCADE kernel it builds solids
 * with, and bd_warehouse's ready-made parts, each pinned to one version with
 * the SHA-256 of every file, in the lock beside this package. The Python
 * environment's lock script writes that lock with `--out`. It is made as the
 * CAD studio connector is installed, never by a call (ADR 0023), and the
 * studio's code needs exactly these versions, so it takes no other package.
 */

import lock from "../cad-packages.json";

/**
 * The programs the CAD studio needs installed before it can run, by toolchain
 * id: uv, which makes its environment as it is installed.
 */
export const cadPrograms = ["uv"] as const;

export const cadEnvironment = {
  name: "cad",
  lock,
  installedBy: { connector: "CAD studio connector", plugin: "3D & Rendering" },
  takesNoPackages:
    "“cad” is the CAD studio's environment, pinned to the versions it is tested with, so it takes no other package: a package could change the kernel's versions. Add it to the default environment or one of your own.",
};
