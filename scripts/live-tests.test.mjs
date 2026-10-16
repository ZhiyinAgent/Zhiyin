import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every project a gate run starts: `pnpm test` and `pnpm test:installed`. */
const gateProjects = [
  "packages",
  "desktop",
  "repository",
  "system-boundary",
  "installed",
];

/** The test files a project runs, as Vitest itself lists them. */
function filesOf(projects) {
  const listed = execFileSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "list",
      "--filesOnly",
      "--json",
      ...projects.flatMap((project) => ["--project", project]),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(listed).map(({ file }) => file);
}

/**
 * Whether a file reads a provider key from the environment it was started in.
 * Setting one, as a test of how keys are passed on does, or deleting one, is
 * not reading it.
 */
function readsAProviderKey(text) {
  for (const found of text.matchAll(
    /process\.env\[\s*["'][A-Z0-9_]+_API_KEY["']\s*\]/g,
  )) {
    const before = text.slice(0, found.index);
    const after = text.slice(found.index + found[0].length);
    if (/delete\s+$/.test(before) || /^\s*=(?!=)/.test(after)) continue;
    return true;
  }
  return false;
}

describe("tests that spend credit", () => {
  it("are left out of every project the gate runs", () => {
    const spending = filesOf(gateProjects).filter((file) =>
      readsAProviderKey(readFileSync(file, "utf8")),
    );

    expect(spending).toEqual([]);
  });

  it("are recognised by what they read, and not by setting a key", () => {
    const key = "ZHIYIN_EXAMPLE_API_KEY";

    expect(readsAProviderKey(`const key = process.env["${key}"];`)).toBe(true);
    expect(readsAProviderKey(`process.env["${key}"] = "fake";`)).toBe(false);
    expect(readsAProviderKey(`delete process.env["${key}"];`)).toBe(false);
  });
});
