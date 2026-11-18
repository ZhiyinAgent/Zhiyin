/**
 * What an install did to an environment, measured from the packages it holds
 * before and after, not from what pip says it did: a package pip says it
 * installed but that was already there is said to be already there.
 */

import type { Installed } from "./environments.js";

/** A package's name as pip compares names: case and `-`, `_`, `.` alike. */
function normalized(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** The name a requirement such as `numpy<2` or `pandas[excel]` asks for. */
function askedName(requirement: string): string {
  return normalized(
    /^[A-Za-z0-9._-]+/.exec(requirement.trim())?.[0] ?? requirement,
  );
}

const listed = (packages: readonly Installed[]) =>
  packages.map((found) => `${found.name} ${found.version}`).join(", ");

export type InstallReport = {
  /** One line per kind of change, then the asked packages already there. */
  readonly lines: readonly string[];
  /** Whether the environment holds anything other than before. */
  readonly changed: boolean;
};

export function installReport(
  environment: string,
  asked: readonly string[],
  before: readonly Installed[],
  after: readonly Installed[],
): InstallReport {
  const earlier = new Map(
    before.map((found) => [normalized(found.name), found]),
  );
  const now = new Map(after.map((found) => [normalized(found.name), found]));
  const wanted = new Set(asked.map(askedName));
  const added = after.filter((found) => !earlier.has(normalized(found.name)));
  const updated = after.filter((found) => {
    const was = earlier.get(normalized(found.name));
    return was !== undefined && was.version !== found.version;
  });
  const removed = before.filter((found) => !now.has(normalized(found.name)));
  const named = (found: Installed) => wanted.has(normalized(found.name));
  const present = [...wanted]
    .map((name) => now.get(name))
    .filter(
      (found): found is Installed =>
        found !== undefined &&
        earlier.get(normalized(found.name))?.version === found.version,
    );
  const missing = [...wanted].filter((name) => !now.has(name));
  const at = `“${environment}”`;
  const changed = added.length + updated.length + removed.length > 0;
  const lines = [
    added.some(named)
      ? `Installed into ${at}: ${listed(added.filter(named))}.`
      : undefined,
    added.some((found) => !named(found))
      ? `${added.some(named) ? "With them" : `Installed into ${at}`}: ${listed(added.filter((found) => !named(found)))}.`
      : undefined,
    updated.length
      ? `Changed in ${at}: ${updated
          .map(
            (found) =>
              `${found.name} ${earlier.get(normalized(found.name))!.version} → ${found.version}`,
          )
          .join(", ")}.`
      : undefined,
    removed.length ? `Removed from ${at}: ${listed(removed)}.` : undefined,
    present.length
      ? changed
        ? `Already in ${at}: ${listed(present)}.`
        : `Nothing was installed: ${listed(present)} ${present.length === 1 ? "was" : "were"} already in ${at}.`
      : undefined,
    missing.length
      ? `${at} holds no package named ${missing.join(", ")}.`
      : undefined,
  ].filter((line) => line !== undefined);
  return { lines, changed };
}
