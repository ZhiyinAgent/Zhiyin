/**
 * Before anything is read, a path is held to its folder by its name alone.
 * That answer is the one Windows' own path rules give, in every spelling.
 */

import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { holds, staysBelow, staysInside } from "../src/index.js";

const paths = [
  "C:\\Work",
  "C:\\Work\\",
  "c:/work/notes.md",
  "C:\\WORK\\Notes.md",
  "C:\\Work\\..\\Work\\notes.md",
  "C:\\Work\\.\\Drafts\\\\one.md",
  "C:\\Work\\Drafts\\..\\..\\secrets.txt",
  "C:\\Workshop\\notes.md",
  "C:\\Work\\..notes",
  "C:\\",
  "D:\\Work\\notes.md",
  "\\\\server\\share\\Team\\plan.md",
  "\\\\server\\share",
  "\\\\server\\shared\\plan.md",
];

/** Whether Windows' path rules keep `path` in `folder`. */
function windowsKeeps(folder: string, path: string): boolean {
  const between = win32.relative(folder, path);
  return (
    between !== ".." &&
    !between.startsWith("..\\") &&
    !win32.isAbsolute(between)
  );
}

describe("a path held to its folder by its name", () => {
  it("stays inside exactly where Windows' path rules keep it", () => {
    for (const folder of paths)
      for (const path of paths) {
        const kept = windowsKeeps(folder, path);
        expect(staysInside(folder, path), `${folder} holding ${path}`).toBe(
          kept,
        );
        expect(holds(folder, path), `${folder} holding ${path}`).toBe(kept);
        expect(staysBelow(folder, path), `${path} below ${folder}`).toBe(
          kept && win32.relative(folder, path) !== "",
        );
      }
  });
});
