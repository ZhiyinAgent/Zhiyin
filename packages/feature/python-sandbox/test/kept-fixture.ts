/**
 * An environment another feature keeps in the sandbox, as that feature hands
 * one in: a lock of two packages asked for and two they need, made by the
 * feature's connector.
 */

import {
  defaultLock,
  type KeptEnvironment,
  type PackageLock,
} from "../src/index.js";

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

export const partsLock: PackageLock = {
  python: defaultLock.python,
  publishedBy: "2026-10-18T00:00:00Z",
  pythonBuild: { version: "3.13.15", bytes: 21_936_514 },
  asked: ["solids", "std_fasteners"],
  locked: [
    {
      name: "kernel-bindings",
      version: "7.8.1",
      bytes: 70_000_000,
      hashes: [hash("1")],
    },
    { name: "solids", version: "0.13.0", bytes: 500_000, hashes: [hash("2")] },
    {
      name: "std-fasteners",
      version: "0.4.0",
      bytes: 300_000,
      hashes: [hash("3"), hash("4")],
    },
    { name: "vectors", version: "2.1.0", bytes: 40_000, hashes: [hash("5")] },
  ],
};

export const parts: KeptEnvironment = {
  name: "parts",
  lock: partsLock,
  installedBy: { connector: "Parts studio connector", plugin: "Workshop" },
  takesNoPackages:
    "“parts” is the parts studio's environment, pinned to the versions it is tested with, so it takes no other package.",
};
