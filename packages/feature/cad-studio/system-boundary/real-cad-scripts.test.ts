/**
 * Running a script in the CAD studio against a real build123d: a workspace's
 * scripts and modules with their arguments, each run afresh; what a script
 * printed, the line it failed on or crashed Python at, and the parts and cuts
 * it showed that the studio cannot take. Skipped unless the CAD environment's
 * Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-scripts.test.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { python } from "./confined-cad-python.js";
import { type Call, type Result, openStudio } from "./real-cad-studio.js";

const folders = new TemporaryFolders();

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let build: Call;

  beforeAll(async () => {
    ({ root, build } = await openStudio(folders));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

  it("runs a workspace script with its arguments, importing the files beside it", async () => {
    await mkdir(join(root, "parts"));
    await writeFile(join(root, "parts", "sizes.py"), "WIDTH = 30\n");
    await writeFile(
      join(root, "parts", "block.py"),
      [
        "import sys",
        "from build123d import *",
        "from sizes import WIDTH",
        "height = float(sys.argv[1])",
        'show(Box(WIDTH, 10, height), name="Block")',
      ].join("\n"),
    );

    const result = await build({ file: "parts/block.py", arguments: ["12"] });

    expect(text(result)).toContain("Block: a valid solid, 30 × 10 × 12 mm");
  }, 120_000);

  it("shows the parts a workspace module makes, quotes its lines in an error, and runs a script that only prints", async () => {
    await mkdir(join(root, "modules"));
    await writeFile(
      join(root, "modules", "pieces.py"),
      [
        "from build123d import *",
        "def make(width):",
        '    show(Box(width, 5, 5), name="Piece")',
        "def broken():",
        "    return Bx(1, 1, 1)",
      ].join("\n"),
    );
    await writeFile(
      join(root, "modules", "assemble.py"),
      "from pieces import make\nmake(20)\n",
    );
    await writeFile(
      join(root, "modules", "fails.py"),
      "from pieces import broken\nbroken()\n",
    );

    const shown = await build({ file: "modules/assemble.py" });
    const failed = await build({ file: "modules/fails.py" });
    const printed = await build({ code: "print('lift', 2 * 3.5)\n" });

    expect(text(shown)).toContain("Piece: a valid solid, 20 × 5 × 5 mm");
    expect(failed.isError).toBe(true);
    expect(text(failed)).toContain(
      'File "modules/fails.py", line 2, in <module>',
    );
    expect(text(failed)).toContain(
      'File "modules/pieces.py", line 5, in broken\n    return Bx(1, 1, 1)',
    );
    expect(printed.isError).toBeUndefined();
    expect(text(printed)).toContain("showed no part");
    expect(text(printed)).toContain("What the script printed:\nlift 7.0");
    expect(text(printed)).not.toContain("views could not be drawn");
  }, 120_000);

  it("runs a workspace module afresh at each position and in the run that checks every cut, so the parts it shows are in each", async () => {
    await mkdir(join(root, "slide"));
    await writeFile(
      join(root, "slide", "slider.py"),
      [
        "import sys",
        "from build123d import *",
        'show(Pos(float(sys.argv[1]), 0, 0) * Box(10, 10, 10), name="Slider")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "slide", "main.py"),
      [
        "import slider",
        "from build123d import *",
        'show(Pos(30, 0, 0) * Box(10, 10, 10), name="Stop")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "slide", "crossed.py"),
      [
        "import slider",
        "from build123d import *",
        "block = Pos(0, 40, 0) * Box(20, 20, 4)",
        "block -= Pos(0, 40, 0) * extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5)",
        'print("hello from the script")',
        'show(block, name="Block")',
      ].join("\n"),
    );

    const positions = await build({
      file: "slide/main.py",
      positions: [["0"], ["30"]],
    });
    const rerun = await build({ file: "slide/crossed.py", arguments: ["0"] });

    expect(positions.isError, text(positions)).toBeUndefined();
    expect(text(positions)).toMatch(
      /At 30: Slider and Stop overlap by 1,000 mm³/,
    );
    expect(rerun.isError, text(rerun)).toBeUndefined();
    expect(text(rerun)).toContain("it would leave no valid solid");
    expect(text(rerun)).toContain("Slider: a valid solid, 10 × 10 × 10 mm");
    expect(text(rerun)).toContain("Block: a valid solid, 20 × 20 × 4 mm");
    // What the script printed, once, though it ran twice.
    expect(text(rerun).split("hello from the script")).toHaveLength(2);
  }, 120_000);

  it("tells a run that ended without an answer what it printed, and none of ezdxf's warnings about the system's fonts", async () => {
    const result = await build({
      code: [
        "import logging, os",
        "logging.getLogger('ezdxf').warning(\"cannot open font 'C:\\\\Windows\\\\Fonts\\\\broken.ttf'\")",
        "print('measured the lobes')",
        "os._exit(3)",
      ].join("\n"),
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("measured the lobes");
    expect(text(result)).not.toContain("cannot open font");
  }, 120_000);

  it("says where a script crashed the CAD studio's Python, and what it printed before", async () => {
    await mkdir(join(root, "crashing"), { recursive: true });
    // Reading memory at address 0 crashes Python itself, as the geometry
    // kernel does on a shape it cannot work; ctypes would catch it on Windows.
    await writeFile(
      join(root, "crashing", "kernel.py"),
      "import faulthandler\ndef soften(shape):\n    return faulthandler._read_null()\n",
    );
    await writeFile(
      join(root, "crashing", "stand.py"),
      [
        "from build123d import *",
        "from kernel import soften",
        "print('built the base')",
        "soften(Box(1, 1, 1))",
      ].join("\n"),
    );

    const result = await build({ file: "crashing/stand.py" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "Python crashed at crashing/kernel.py line 3, in soften, and the build stopped there.",
    );
    expect(text(result)).toContain("What the script printed:\nbuilt the base");
  }, 120_000);

  it("answers a script's error with the line it failed on", async () => {
    const result = await build({
      code: "from build123d import *\nshow(Bx(1, 2, 3))\n",
    });

    expect(result.isError).toBe(true);
    // Named as the model knows it, with the line that failed, never by the
    // copy Zhiyin runs in its own folder.
    expect(text(result)).toContain(
      'File "the script", line 2, in <module>\n    show(Bx(1, 2, 3))',
    );
    expect(text(result)).toContain("NameError: name 'Bx' is not defined");
    expect(text(result)).not.toContain("zhiyin_cad");
    expect(text(result)).not.toContain("runs");

    await mkdir(join(root, "parts"), { recursive: true });
    await writeFile(
      join(root, "parts", "broken.py"),
      "from build123d import *\nshow(Bx(1, 2, 3))\n",
    );
    const fromFile = await build({ file: "parts/broken.py" });
    expect(text(fromFile)).toContain(
      'File "parts/broken.py", line 2, in <module>\n    show(Bx(1, 2, 3))',
    );
  }, 120_000);

  it("refuses a part show() cannot take, naming which part it is and the line that showed it", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Box(10, 10, 10), name="Base")',
        'show([Box(5, 5, 5), Rectangle(4, 4)], name="Valve")',
      ].join("\n"),
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "At line 3 of the script, part 2 of the 2 shown as “Valve”: show() takes 3D parts, and this Rectangle has no solid. Extrude or revolve it first.",
    );
  }, 120_000);

  it("skips a cut that would break the part it cuts, saying where it is, what it cut and why", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "plate = Box(100, 60, 10)",
        "plate -= Cylinder(5, 20)",
        // A cutter turned inside out, which takes away all but itself.
        "plate -= Solid((Pos(30, 0, 0) * Cylinder(5, 20)).wrapped.Reversed())",
        "plate -= Box(200, 200, 200)",
        'show(plate, name="Plate")',
      ].join("\n"),
    });
    // A cutter whose faces cross: the cut leaves a broken solid, which a
    // second run, each cut checked, finds and skips.
    const crossed = await build({
      code: [
        "from build123d import *",
        "block = Box(20, 20, 4)",
        "bowtie = extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5)",
        "block -= bowtie",
        'show(block, name="Block")',
      ].join("\n"),
    });

    expect(crossed.isError, text(crossed)).toBeUndefined();
    expect(text(crossed)).toContain(
      "- At line 4 of the script: a cut of the part 20 × 20 × 4 mm about (0, 0, 0), its cutter 10 × 10 × 5 mm about (5, 5, -2.5): it would leave no valid solid, so the part was kept as it was before it.",
    );
    expect(text(crossed)).toContain("Block: a valid solid, 20 × 20 × 4 mm");
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      [
        "Cuts skipped, as each would break the part it cuts; change each in the script:",
        "- At line 4 of the script: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 10 × 10 × 20 mm about (30, 0, 0): its cutter is turned inside out, so it would take away all of the part but where the cutter is, so the part was kept as it was before it. Its cutter lies where Plate is shown.",
        "- At line 5 of the script: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 200 × 200 × 200 mm about (0, 0, 0): it would leave nothing of the part, so the part was kept as it was before it. Its cutter lies where Plate is shown.",
      ].join("\n"),
    );
    // The hole alone is cut.
    expect(text(result)).toContain("Volume 59,215 mm³");
  }, 120_000);

  it("explains an empty builder and a list shown under one name", async () => {
    const empty = await build({
      code: "from build123d import *\nwith BuildPart() as p:\n    pass\nshow(p)",
    });
    const listed = await build({
      code: "from build123d import *\nshow([Box(1, 1, 1), Pos(5, 0, 0) * Box(1, 1, 1)], name='Pair')",
    });

    expect(text(empty)).toContain("built nothing");
    expect(text(listed)).toContain("Pair 1");
    expect(text(listed)).toContain("Pair 2");
  }, 120_000);
});
