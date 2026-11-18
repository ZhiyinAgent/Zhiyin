import { createHash } from "node:crypto";
import lock from "../default-packages.json";

/**
 * Packages pinned to one version each, with the SHA-256 of every file that
 * version publishes, so an install takes those files or none.
 */
export type PackageLock = {
  /** The Python the versions were chosen for, by minor version. */
  readonly python: string;
  /** The moment the versions were chosen as published by. */
  readonly publishedBy: string;
  /** The Python build the pinned uv downloads for `python`, and its size. */
  readonly pythonBuild: { readonly version: string; readonly bytes: number };
  /** What is asked for by name; `locked` adds what those need. */
  readonly asked: readonly string[];
  readonly locked: readonly {
    readonly name: string;
    readonly version: string;
    /** The size of the file uv installs of it here, as its index publishes it. */
    readonly bytes: number;
    readonly hashes: readonly string[];
  }[];
};

/**
 * The default environment's packages, as a script beside this package
 * regenerates them by hand with a release. pandas reads and writes Excel
 * workbooks through openpyxl, which it does not install itself, so openpyxl
 * is asked for too.
 */
export const defaultLock: PackageLock = lock;

/** What a data-science sandbox is expected to have on hand. */
export const defaultPackages = defaultLock.asked;

/**
 * The default packages are the versions published by this moment, moved
 * forward deliberately with a release, and every environment's pip is too.
 */
export const defaultPackagesPublishedBy = defaultLock.publishedBy;

/** One mark for everything an environment made from the lock gets from it. */
export function lockMark(lock: PackageLock): string {
  return createHash("sha256")
    .update(
      `${lock.python}
${lock.publishedBy}
${requirements(lock)}`,
    )
    .digest("hex");
}

/** The lock as a requirements file, one package a line with each of its hashes. */
export function requirements(lock: PackageLock): string {
  return lock.locked
    .map(
      ({ name, version, hashes }) =>
        `${name}==${version}${hashes.map((hash) => ` --hash=${hash}`).join("")}\n`,
    )
    .join("");
}
