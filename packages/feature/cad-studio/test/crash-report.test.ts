import { describe, expect, it } from "vitest";
import { crashReport } from "../src/crash-report.js";

const harness = "C:\\Zhiyin\\packages\\cad-studio\\src\\harness";

/** What Python's fault handler wrote when the geometry kernel crashed in a fillet. */
const roundingCrash = [
  "Windows fatal exception: access violation",
  "",
  "Current thread 0x00007aa8 (most recent call first):",
  '  File "C:\\cad\\Lib\\site-packages\\build123d\\topology\\three_d.py", line 367 in fillet',
  `  File "${harness}\\zhiyin_cad\\helpers.py", line 71 in _try_fillet`,
  `  File "${harness}\\zhiyin_cad\\helpers.py", line 159 in <lambda>`,
  `  File "${harness}\\zhiyin_cad\\helpers.py", line 210 in _largest`,
  `  File "${harness}\\zhiyin_cad\\helpers.py", line 159 in round_edges`,
  '  File "stand.py", line 136 in <module>',
  `  File "${harness}\\zhiyin_cad\\build.py", line 193 in run_script`,
  `  File "${harness}\\run.py", line 34 in <module>`,
].join("\r\n");

describe("a crash of the CAD studio's Python", () => {
  it("names the call that crashed and the script's line that made it", () => {
    expect(crashReport(roundingCrash, [])).toBe(
      "Python crashed in round_edges, called at stand.py line 136, and the build stopped there. A crash in a library, such as the geometry kernel, comes from what that step gave it: change that step.",
    );
  });

  it("names a module of the workspace by its place there, not the run's copy of it", () => {
    const copy = "C:\\Data\\cad-studio\\runs\\r1\\snapshot";
    const stack = [
      "Windows fatal exception: access violation",
      '  File "C:\\cad\\Lib\\site-packages\\build123d\\topology\\three_d.py", line 367 in fillet',
      `  File "${copy}\\parts\\shapes.py", line 12 in soften`,
      '  File "parts/stand.py", line 4 in <module>',
    ].join("\n");

    expect(crashReport(stack, [copy])).toContain(
      "Python crashed in fillet, called at parts/shapes.py line 12, in soften,",
    );
  });

  it("says a crash with no frame of the script's is the CAD studio's own", () => {
    const stack = [
      "Windows fatal exception: access violation",
      `  File "${harness}\\zhiyin_cad\\measure.py", line 40 in holes_in`,
    ].join("\n");

    expect(crashReport(stack, [])).toBe(
      "Python crashed in holes_in while the CAD studio measured the parts, and the build stopped there. This is the CAD studio's own failure, not the script's.",
    );
  });

  it("reports nothing for a run that did not crash", () => {
    expect(
      crashReport("Traceback (most recent call last):\nValueError", []),
    ).toBeUndefined();
  });
});
