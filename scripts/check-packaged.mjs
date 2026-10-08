/**
 * Checks the packaged executable, after `pnpm package`, for the Electron fuses
 * that let another program run its own code as Zhiyin.
 *
 * With `ELECTRON_RUN_AS_NODE` honoured, the executable runs any script it is
 * given as a plain Node.js runtime; with the inspect options honoured, a
 * debugger can attach to the main process and run code there. Either runs that
 * code under Zhiyin's executable and, once it is signed, its signature. The
 * fuses are bits in the executable, read here as Electron reads them, so the
 * check needs no launch and touches no one's saved data.
 */

import { join } from "node:path";
import fuses from "@electron/fuses";

// The package is CommonJS, so its names come off the default export.
const { FuseV1Options, getCurrentFuseWire } = fuses;
// A fuse turned off holds the character "0"; the package declares the states
// but does not export them from its entry point.
const disabled = "0".charCodeAt(0);

const executable = join(
  "apps",
  "desktop",
  "release",
  "win-unpacked",
  "Zhiyin.exe",
);

const mustBeOff = {
  [FuseV1Options.RunAsNode]: "running as Node.js with ELECTRON_RUN_AS_NODE",
  [FuseV1Options.EnableNodeCliInspectArguments]:
    "attaching a debugger with --inspect",
};

const wire = await getCurrentFuseWire(executable);
const allowed = Object.entries(mustBeOff).filter(
  ([fuse]) => wire[fuse] !== disabled,
);
for (const [, what] of allowed)
  console.error(`${executable} still allows ${what}.`);
if (allowed.length) process.exit(1);
console.log(
  `${executable} allows neither ${Object.values(mustBeOff).join(" nor ")}.`,
);
