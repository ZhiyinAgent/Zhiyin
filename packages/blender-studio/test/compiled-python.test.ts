import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunProcess } from "@zhiyin/process-ownership";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { compiledBlenderPython } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** A folder laid out as an unpacked Blender is, with nothing that runs. */
async function unpackedBlender(python = true): Promise<string> {
  const root = await folders.make("zhiyin-compiled-");
  const home = join(root, "staged", "blender-9.9.9-windows-x64");
  await mkdir(join(home, "9.9", "scripts"), { recursive: true });
  await mkdir(join(home, "9.9", "python", "lib"), { recursive: true });
  await mkdir(join(home, "9.9", "python", "bin"), { recursive: true });
  await mkdir(join(home, "datafiles"), { recursive: true });
  await writeFile(join(home, "blender.exe"), "");
  if (python)
    await writeFile(join(home, "9.9", "python", "bin", "python.exe"), "");
  return home;
}

type Asked = Parameters<RunProcess>[0];

function running(result: Awaited<ReturnType<RunProcess>>) {
  const asked: Asked[] = [];
  const run: RunProcess = async (options) => {
    asked.push(options);
    return result;
  };
  return { asked, run };
}

const done = { exitCode: 0, stdout: "", stderr: "" };

describe("compiling a Blender's Python when it is installed", () => {
  it("has that Blender's own Python compile its scripts and its library, recorded as where they will be", async () => {
    const home = await unpackedBlender();
    const installed = join("C:\\data", "blender-9.9.9-windows-x64");
    const { asked, run } = running(done);
    const stopping = new AbortController();
    const containment = { open: () => ({}) as never };

    await compiledBlenderPython({ run, containment })(
      {
        executable: join(home, "blender.exe"),
        installed: join(installed, "blender.exe"),
      },
      stopping.signal,
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      executable: join(home, "9.9", "python", "bin", "python.exe"),
      // Alone, whatever Python the person has set up for themselves.
      arguments: [
        "-I",
        "-m",
        "compileall",
        "-q",
        "-j",
        "0",
        "-s",
        home,
        "-p",
        installed,
        join(home, "9.9", "scripts"),
        join(home, "9.9", "python", "lib"),
      ],
      signal: stopping.signal,
      containment,
    });
  });

  it("says so when Python could not compile them, or ran out of time", async () => {
    const home = await unpackedBlender();
    const program = {
      executable: join(home, "blender.exe"),
      installed: join("C:\\data", "blender.exe"),
    };
    const signal = new AbortController().signal;

    await expect(
      compiledBlenderPython({
        run: running({ exitCode: 1, stdout: "", stderr: "" }).run,
      })(program, signal),
    ).rejects.toThrow("Blender's Python was not compiled.");
    await expect(
      compiledBlenderPython({
        run: running({ ...done, exitCode: null, ending: "timeout" }).run,
      })(program, signal),
    ).rejects.toThrow("Blender's Python was not compiled.");
  });

  it("runs nothing for a Blender that carries no Python of its own", async () => {
    const home = await unpackedBlender(false);
    const { asked, run } = running(done);

    await expect(
      compiledBlenderPython({ run })(
        {
          executable: join(home, "blender.exe"),
          installed: join("C:\\data", "blender.exe"),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Blender's Python was not compiled.");

    expect(asked).toEqual([]);
  });
});
