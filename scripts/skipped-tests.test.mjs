import { describe, expect, it } from "vitest";
import { skippedByFile, unexpectedSkips } from "./skipped-tests.mjs";

const ran = (state) => ({ result: () => ({ state }) });
const file = (moduleId, ...states) => ({
  moduleId,
  children: { allTests: () => states.map(ran) },
});

const realBlender =
  "packages/blender-studio/system-boundary/real-blender.test.ts";

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

  it("are expected on a machine that lacks what they need", () => {
    expect(unexpectedSkips([[realBlender, 87]], {})).toEqual([]);
  });

  it("fail the run when what they need is there", () => {
    expect(
      unexpectedSkips([[realBlender, 87]], {
        ZHIYIN_BLENDER: "C:\\zb\\blender.exe",
      }),
    ).toEqual([expect.stringContaining(realBlender)]);
  });

  it("fail the run in CI, which installs the programs they need", () => {
    const realUv = "packages/python-sandbox/test/real-uv.test.ts";
    expect(unexpectedSkips([[realUv, 3]], { CI: "true" })).toEqual([
      expect.stringContaining(realUv),
    ]);
  });

  it("are expected in CI for a Blender that runs scenes, which needs the graphics card CI lacks", () => {
    expect(unexpectedSkips([[realBlender, 87]], { CI: "true" })).toEqual([]);
  });

  it("fail the run in a file that is never expected to skip", () => {
    expect(unexpectedSkips([["apps/desktop/src/a.test.ts", 1]], {})).toEqual([
      expect.stringContaining("apps/desktop/src/a.test.ts"),
    ]);
  });

  it("are expected in CI only where CI cannot provide what they need", () => {
    expect(
      unexpectedSkips([["packages/tools/test/delete-file.test.ts", 1]], {
        CI: "true",
      }),
    ).toEqual([]);
    expect(
      unexpectedSkips([["packages/tools/test/delete-file.test.ts", 1]], {}),
    ).toEqual([expect.stringContaining("delete-file.test.ts")]);
  });
});
