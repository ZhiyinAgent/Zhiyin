import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Plugin } from "vite";

const foldersIn = (folder: string) =>
  readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(folder, entry.name));

/**
 * The file each workspace package publishes as `@zhiyin/<name>/testing`, by
 * its full path (ADR 0002). Each package sits in the folder of its layer.
 */
export function testingEntriesIn(packagesFolder: string): readonly string[] {
  return foldersIn(packagesFolder)
    .flatMap(foldersIn)
    .flatMap((folder) => {
      let manifest: { exports?: Record<string, unknown> };
      try {
        manifest = JSON.parse(
          readFileSync(resolve(folder, "package.json"), "utf8"),
        ) as typeof manifest;
      } catch {
        return [];
      }
      const testing = manifest.exports?.["./testing"];
      return typeof testing === "string" ? [resolve(folder, testing)] : [];
    });
}

/**
 * Whether a bundled module is test code as lint defines it (ADR 0002): a test
 * file, a file under a `test` or `system-boundary` folder, or the installed
 * app's tests; or a package's testing entry. Only the repository's own files
 * are read so; a library's are its own business.
 */
function isTestCode(
  id: string,
  root: string,
  testingEntries: readonly string[],
): boolean {
  const path = id.split("?")[0]!;
  if (path.startsWith("\0") || !isAbsolute(path)) return false;
  const within = relative(root, path);
  if (within.startsWith("..") || isAbsolute(within)) return false;
  const parts = within.split(/[\\/]/);
  if (parts.includes("node_modules")) return false;
  return (
    parts
      .slice(0, -1)
      .some((part) => part === "test" || part === "system-boundary") ||
    /\.test\.[cm]?[jt]sx?$/.test(parts.at(-1) ?? "") ||
    parts.slice(0, 3).join("/") === "apps/desktop/installed" ||
    testingEntries.some((entry) => relative(entry, path) === "")
  );
}

/**
 * Fails a build that bundles test code, a package's fakes included, naming
 * each file (ADR 0002). Lint keeps the app's code from importing test code;
 * this holds the app as built.
 */
export function refuseTestCode(options: {
  /** The repository, which the test folders are read inside. */
  readonly root: string;
  readonly testingEntries: readonly string[];
}): Plugin {
  return {
    name: "zhiyin-no-test-code",
    generateBundle(_output, bundle) {
      const found = new Set<string>();
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const id of Object.keys(output.modules))
            if (isTestCode(id, options.root, options.testingEntries))
              found.add(
                relative(options.root, id.split("?")[0]!).replaceAll("\\", "/"),
              );
      if (found.size)
        this.error(
          `The app as built carries test code, which only tests may import (ADR 0002): ${[...found].sort().join(", ")}.`,
        );
    },
  };
}
