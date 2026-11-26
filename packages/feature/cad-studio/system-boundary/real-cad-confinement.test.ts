/**
 * What a script cannot do from inside the CAD studio's confinement, against a
 * real build123d: change what the studio says of its parts, import a file the
 * approval did not see, reach the data folder through its answer, keep
 * anything between builds, leave a container behind, write to the workspace or
 * reach the internet. Skipped unless the CAD environment's Python is named, as
 * the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-confinement.test.ts
 */

import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { python } from "./confined-cad-python.js";
import { type Call, type Result, openStudio } from "./real-cad-studio.js";

const folders = new TemporaryFolders();

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let data: string;
  let build: Call;

  beforeAll(async () => {
    ({ root, data, build } = await openStudio(folders));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

  it("imports only the files the approval saw, not a compiled copy left beside them", async () => {
    const folder = join(root, "cached");
    await mkdir(folder, { recursive: true });
    const sizes = join(folder, "sizes.py");
    // A compiled sizes.py that says 90, left where Python looks first, then
    // the source changed to 80 with its time kept, so Python takes the copy.
    await writeFile(sizes, "WIDTH = 90\n");
    const { mtime } = await stat(sizes);
    await promisify(execFile)(python!, [
      "-I",
      "-c",
      "import py_compile, sys; py_compile.compile(sys.argv[1], doraise=True)",
      sizes,
    ]);
    await writeFile(sizes, "WIDTH = 80\n");
    await utimes(sizes, mtime, mtime);
    const { stdout } = await promisify(execFile)(python!, [
      "-I",
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); import sizes; print(sizes.WIDTH)",
      folder,
    ]);
    expect(stdout.trim()).toBe("90");
    await writeFile(
      join(folder, "bar.py"),
      'from build123d import *\nfrom sizes import WIDTH\nshow(Box(WIDTH, 10, 10), name="Bar")\n',
    );

    const built = await build({ file: "cached/bar.py" });

    expect(text(built)).toContain("Bar: a valid solid, 80 × 10 × 10 mm");
  }, 120_000);

  describe("a script that tries to change what the studio says of its parts", () => {
    /** A 400 mm plate, which a 256 mm bed does not take, built after `tamper` runs. */
    const plate = (tamper: string[]) =>
      [
        "from build123d import *",
        ...tamper,
        'show(Box(400, 100, 5), name="Plate")',
      ].join("\n");
    const tampered = async (name: string, tamper: string[]) => {
      await mkdir(join(root, "tamper"), { recursive: true });
      await writeFile(
        join(root, "tamper", "requirements.json"),
        JSON.stringify({
          requirements: [{ id: "R1", check: "fits", box: [256, 256, 256] }],
        }),
      );
      await writeFile(join(root, "tamper", `${name}.py`), plate(tamper));
      return build({
        file: `tamper/${name}.py`,
        exports: [{ path: `tamper/${name}.step` }],
      });
    };
    /** What the studio must say of the plate, whatever the script did. */
    const truthful = (result: Result) => {
      expect(result.isError, text(result)).toBeUndefined();
      expect(text(result)).toContain("Plate: a valid solid, 400 × 100 × 5 mm");
      expect(text(result)).toMatch(/- R1 fails: /);
      expect(text(result)).not.toMatch(/- R1 holds/);
    };

    it("still finds the requirement unmet when the script replaces the checker", async () => {
      truthful(
        await tampered("checker", [
          "import sys, zhiyin_cad.requirements as checking",
          "def holds(parts, asked, *rest, **named):",
          "    return [{'id': one['id'], 'holds': True, 'margin': 1, 'said': one['id'] + ' holds'} for one in asked]",
          "checking.checked = holds",
          "sys.modules['zhiyin_cad.requirements'].checked = holds",
        ]),
      );
    }, 120_000);

    it("still says the true size when the script wraps the measuring", async () => {
      truthful(
        await tampered("measuring", [
          "import zhiyin_cad.measure as measuring",
          "real = measuring.measured",
          "def smaller(*given, **named):",
          "    said = real(*given, **named)",
          "    said['size'] = [100, 100, 5]",
          "    return said",
          "measuring.measured = smaller",
        ]),
      );
    }, 120_000);

    it("still answers from the measuring when the script writes an answer of its own", async () => {
      const answered = await tampered("answer", [
        "import json, os, sys",
        "said = {'parts': [{'name': 'Plate', 'valid': True, 'solids': 1, 'size': [100, 100, 5], 'min': [0, 0, 0], 'max': [100, 100, 5], 'volume': 50000, 'area': 1, 'centre': [0, 0, 0], 'faces': {}, 'holes': []}], 'overlaps': [], 'exports': [], 'seconds': {'total': 1}, 'picture': None, 'requirements': [{'id': 'R1', 'holds': True}]}",
        // The harness's own folder, found in its frames, and where the run after it might write.
        "frame = sys._getframe()",
        "while frame is not None:",
        "    folder = frame.f_locals.get('folder')",
        "    if isinstance(folder, str):",
        "        for place in (folder, os.path.join(os.path.dirname(folder), 'out')):",
        "            try:",
        "                os.makedirs(place, exist_ok=True)",
        "                with open(os.path.join(place, 'answer.json'), 'w') as out:",
        "                    json.dump(said, out)",
        "                print('wrote', os.path.basename(place))",
        "            except OSError:",
        "                print('refused', os.path.basename(place))",
        "    frame = frame.f_back",
      ]);

      truthful(answered);
      // It wrote an answer in its own folder, and could not reach the measuring run's.
      expect(text(answered)).toContain("wrote script");
      expect(text(answered)).toContain("refused out");
      expect(text(answered)).not.toContain("wrote out");
    }, 120_000);

    it("writes exports of the size the answer gives, from a build that wrapped the measuring", async () => {
      await tampered("measuring", [
        "import zhiyin_cad.measure as measuring",
        "real = measuring.measured",
        "measuring.measured = lambda *given, **named: {**real(*given, **named), 'size': [100, 100, 5]}",
      ]);
      const readBack = await build({
        code: 'from build123d import *\nshow(import_step("tamper/measuring.step"), name="Plate")\n',
      });

      expect(text(readBack)).toContain(
        "Plate: a valid solid, 400 × 100 × 5 mm",
      );
    }, 180_000);
  });

  it("copies nothing a script names in its own answer, whatever it points at", async () => {
    const secret = join(data, "secret.txt");
    await writeFile(secret, "TOP SECRET CONTENT");

    const result = await build({
      code: [
        "import json, os",
        "request = json.load(open(os.path.join(os.path.dirname(__file__), 'request.json')))",
        "out = request['output']",
        `target = os.path.relpath(r'${secret}', out)`,
        "json.dump({'parts': [], 'overlaps': [], 'exports': [{'file': target, 'bytes': 1, 'parts': ['Box']}],",
        "           'seconds': {'total': 1}, 'picture': target}, open(os.path.join(out, 'answer.json'), 'w'))",
        "os._exit(0)",
      ].join("\n"),
      exports: [{ path: "loot.step" }],
    });

    expect(JSON.stringify(result)).not.toContain(
      Buffer.from("TOP SECRET CONTENT").toString("base64"),
    );
    expect(await readdir(root)).not.toContain("loot.step");
    expect(result.isError).toBe(true);
  }, 120_000);

  it("keeps nothing between builds but the files they write", async () => {
    await build({
      code: [
        "import pathlib",
        "(pathlib.Path.home() / 'left.txt').write_text('from build one')",
        "from build123d import *",
        "show(Box(1, 1, 1))",
      ].join("\n"),
    });

    const second = await build({
      code: [
        "import pathlib",
        "left = pathlib.Path.home() / 'left.txt'",
        "print(left.read_text() if left.exists() else 'nothing left')",
        "from build123d import *",
        "show(Box(1, 1, 1))",
      ].join("\n"),
    });

    expect(text(second)).toContain("What the script printed:\nnothing left");
  }, 120_000);

  it("leaves no container in the person's profile once a build ends", async () => {
    const packages = join(process.env["LOCALAPPDATA"]!, "Packages");
    const containers = async () =>
      (await readdir(packages)).filter((name) =>
        name.toLowerCase().startsWith("zhiyin.python-cad-test."),
      );
    const before = await containers();

    await build({
      code: "from build123d import *\nshow(Box(1, 1, 1), name='Cube')",
    });

    expect(await containers()).toEqual(before);
  }, 120_000);

  it("cannot change the workspace or reach the internet from the script", async () => {
    await writeFile(join(root, "kept.txt"), "the person's");

    const result = await build({
      code: [
        "import socket, pathlib",
        "outcomes = []",
        "try:",
        "    pathlib.Path('kept.txt').write_text('changed')",
        "    outcomes.append('wrote')",
        "except OSError:",
        "    outcomes.append('no write')",
        "try:",
        "    socket.create_connection(('pypi.org', 443), timeout=5)",
        "    outcomes.append('online')",
        "except OSError:",
        "    outcomes.append('offline')",
        "print(' '.join(outcomes))",
        "from build123d import *",
        "show(Box(1, 1, 1))",
      ].join("\n"),
    });

    expect(text(result)).toContain(
      "What the script printed:\nno write offline",
    );
    expect(await readFile(join(root, "kept.txt"), "utf8")).toBe("the person's");
  }, 120_000);
});
