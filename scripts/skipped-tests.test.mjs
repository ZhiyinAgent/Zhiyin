import { describe, expect, it } from "vitest";
import { skippedByFile } from "./skipped-tests.mjs";

const ran = (state) => ({ result: () => ({ state }) });
const file = (moduleId, ...states) => ({
  moduleId,
  children: { allTests: () => states.map(ran) },
});

describe("the tests that did not run", () => {
  it("are counted by file, every file named once and in order", () => {
    expect(
      skippedByFile(
        [
          file("C:/repo/packages/b.test.ts", "passed", "skipped", "skipped"),
          file("C:/repo/apps/a.test.ts", "skipped"),
          file("C:/repo/packages/c.test.ts", "passed", "failed"),
        ],
        "C:/repo",
      ),
    ).toEqual([
      ["apps/a.test.ts", 1],
      ["packages/b.test.ts", 2],
    ]);
  });
});
