/**
 * Checks the packaged executable, after `pnpm package`, for the Electron fuses
 * that decide whose code can run as Zhiyin.
 *
 * With `ELECTRON_RUN_AS_NODE` honoured, the executable runs any script it is
 * given as a plain Node.js runtime; with `NODE_OPTIONS` honoured, it loads any
 * module that variable names; with the inspect options honoured, a debugger
 * can attach to the main process and run code there. Each runs that
 * code under Zhiyin's executable and, once it is signed, its signature. And
 * unless the app is loaded from its archive alone, and the archive is checked
 * against the hash built into the executable, code put in the install folder
 * runs in Zhiyin's place. The fuses are bits in the executable, read here as
 * Electron reads them, so the check needs no launch and touches no one's saved
 * data.
 */

import { join } from "node:path";
import fuses from "@electron/fuses";

// The package is CommonJS, so its names come off the default export.
const { FuseV1Options, getCurrentFuseWire } = fuses;
// A fuse holds the character "0" when off and "1" when on; the package
// declares the states but does not export them from its entry point.
const disabled = "0".charCodeAt(0);
const enabled = "1".charCodeAt(0);

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
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]:
    "loading code named by NODE_OPTIONS",
};
const mustBeOn = {
  [FuseV1Options.OnlyLoadAppFromAsar]: "loading the app from its archive only",
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
    "checking the archive against the hash in the executable",
};

const wire = await getCurrentFuseWire(executable);
const allowed = Object.entries(mustBeOff).filter(
  ([fuse]) => wire[fuse] !== disabled,
);
const missing = Object.entries(mustBeOn).filter(
  ([fuse]) => wire[fuse] !== enabled,
);
for (const [, what] of allowed)
  console.error(`${executable} still allows ${what}.`);
for (const [, what] of missing) console.error(`${executable} is not ${what}.`);
if (allowed.length || missing.length) process.exit(1);
console.log(
  `${executable} allows neither ${Object.values(mustBeOff).join(" nor ")}, and is ${Object.values(mustBeOn).join(" and ")}.`,
);
