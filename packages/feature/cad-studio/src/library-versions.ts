/**
 * The versions of build123d and bd_warehouse the CAD environment is made
 * with, as its lock pins them, and the ids of the reference pages read from
 * them (ADR 0024): `doc:build123d/0.13/<name>`, `doc:bd_warehouse/0.4/<name>`.
 */

import lock from "../cad-packages.json";

function pinned(name: string): string {
  const found = lock.locked.find((one) => one.name === name);
  if (!found) throw new Error(`The CAD environment's lock pins no ${name}.`);
  return found.version;
}

/** Major and minor, as a page names its version. */
const shortened = (version: string) => version.split(".").slice(0, 2).join(".");

export const libraries = {
  build123d: pinned("build123d"),
  bd_warehouse: pinned("bd-warehouse"),
} as const;

export type Library = keyof typeof libraries;

/** The id every page of a library's reference begins with. */
export const referenceOf = (library: Library) =>
  `doc:${library}/${shortened(libraries[library])}`;

/** A reference page's id, as `doc:build123d/0.13/Face`. */
export const pageOf = (library: Library, name: string) =>
  `${referenceOf(library)}/${name}`;

/** The library's name and version as a page says them, as `build123d 0.13`. */
export const versionWords = (library: Library) =>
  `${library} ${shortened(libraries[library])}`;
