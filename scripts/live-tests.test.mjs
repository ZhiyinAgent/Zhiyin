import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
 * Whether a file reads a provider key from the environment it was started in:
 * by the key's own name, in brackets, after a dot or taken apart from the
 * environment, or in brackets by a provider's key variable. Setting one, as a
 * test of how keys are passed on does, or deleting one, is not reading it. A
 * key read by a name made some other way is not recognised; the projects'
 * own file patterns keep live tests out first.
 */
function readsAProviderKey(text) {
  if (/\{[^}]*\b[A-Z0-9_]+_API_KEY\b[^}]*\}\s*=\s*process\.env\b/.test(text))
    return true;
  for (const found of text.matchAll(
    /process\.env(?:\[\s*(?:["'][A-Z0-9_]+_API_KEY["']|[^\]]*\bkeyVariable\b[^\]]*)\s*\]|\.[A-Z0-9_]+_API_KEY\b)/g,
  )) {
    const before = text.slice(0, found.index);
    const after = text.slice(found.index + found[0].length);
    if (/delete\s+$/.test(before) || /^\s*=(?!=)/.test(after)) continue;
    return true;
  }
  return false;
}

/** The files of the repository a file imports by a relative path. */
function importedBy(file, text) {
  const imported = [];
  for (const [, path] of text.matchAll(
    /(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    const named = resolve(dirname(file), path);
    const found = [named, named.replace(/\.js$/, ".ts"), `${named}.ts`].find(
      (candidate) => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate),
    );
    if (found) imported.push(found);
  }
  return imported;
}

/** Whether a file, or any file it imports however deep, reads a provider key. */
function reachesAProviderKey(file, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  return (
    readsAProviderKey(text) ||
    importedBy(file, text).some((next) => reachesAProviderKey(next, seen))
  );
}

describe("tests that spend credit", () => {
  it("are left out of every project the gate runs", () => {
    const spending = filesOf(gateProjects).filter((file) =>
      reachesAProviderKey(file),
    );

    expect(spending).toEqual([]);
  });

  it("are recognised by what they read, and not by setting a key", () => {
    const key = "ZHIYIN_EXAMPLE_API_KEY";

    expect(readsAProviderKey(`const key = process.env["${key}"];`)).toBe(true);
    expect(readsAProviderKey(`const key = process.env.${key};`)).toBe(true);
    expect(readsAProviderKey(`const { ${key} } = process.env;`)).toBe(true);
    expect(readsAProviderKey(`process.env["${key}"] = "fake";`)).toBe(false);
    expect(readsAProviderKey(`process.env.${key} = "fake";`)).toBe(false);
    expect(readsAProviderKey(`delete process.env["${key}"];`)).toBe(false);
    expect(readsAProviderKey(`delete process.env.${key};`)).toBe(false);
  });

  it("are recognised through a shared helper that reads the key", () => {
    const helper = resolve("packages/model-client/test/live-lab.ts");
    const test = resolve(
      "packages/model-client/src/providers/anthropic/test/live.test.ts",
    );

    expect(readsAProviderKey(readFileSync(test, "utf8"))).toBe(false);
    expect(reachesAProviderKey(helper)).toBe(true);
    expect(reachesAProviderKey(test)).toBe(true);
  });
});
