/**
 * A build whose script fails, or warns, the way an old form of build123d does
 * is answered with the form that works in the version installed and the
 * pages to read. Python is a stand-in answering as the harness would; that
 * each old form gives these words in the real library is shown in the
 * system-boundary tests.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation, cadEnvironment, type CadPython } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const version = cadEnvironment.lock.locked
  .find((one) => one.name === "build123d")!
  .version.split(".")
  .slice(0, 2)
  .join(".");

/** What the script's run says next: the error it fails with, or none, and what it wrote to stderr. */
type Script = { failed?: string; stderr?: string };

async function studio() {
  const root = await folders.make("zhiyin-cad-changes-workspace-");
  const data = await folders.make("zhiyin-cad-changes-data-");
  const script: Script = {};
  const python: CadPython = {
    state: async () => "ready",
    run: async (request) => {
      const given = JSON.parse(
        await readFile(request.arguments.at(-1)!, "utf8"),
      ) as { phase?: string; output: string };
      if (given.phase === "script") {
        await writeFile(
          join(given.output, script.failed ? "answer.json" : "manifest.json"),
          script.failed ? JSON.stringify({ failed: script.failed }) : "{}",
        );
        return {
          ok: true,
          run: {
            exitCode: script.failed ? 2 : 0,
            stdout: "",
            stderr: script.stderr ?? "",
          },
        };
      }
      await writeFile(
        join(given.output, "answer.json"),
        JSON.stringify({
          parts: [
            {
              name: "Block",
              valid: true,
              solids: 1,
              size: [10, 10, 10],
              min: [-5, -5, -5],
              max: [5, 5, 5],
              volume: 1000,
              area: 600,
              centre: [0, 0, 0],
              faces: { plane: 6 },
              holes: [],
            },
          ],
          overlaps: [],
          exports: [],
          seconds: { total: 1 },
          picture: false,
        }),
      );
      return { ok: true, run: { exitCode: 0, stdout: "", stderr: "" } };
    },
  };
  const tools = cadAutomation(python, {
    workspaceRoot: () => root,
    harness: join(data, "harness", "run.py"),
    directory: join(data, "cad-studio"),
  });
  const build = async (said: Script) => {
    Object.assign(script, { failed: undefined, stderr: undefined }, said);
    const args = { code: 'show(Box(10, 10, 10), name="Block")' };
    const asked = await tools.inspect("cad_build", args);
    if (!asked.ok) throw new Error(asked.reason);
    return (await tools.callTool(
      "cad_build",
      args,
      undefined,
      asked.identity,
    )) as { isError?: boolean; content: { text?: string }[] };
  };
  return { build };
}

describe("a build that meets a known change in build123d", () => {
  it("fails with its error and the form that works, with the pages to read", async () => {
    const { build } = await studio();

    const answer = await build({
      failed:
        "The script failed:\n  File \"the script\", line 3, in <module>\n    print(p.to_tuple())\nAttributeError: 'Vector' object has no attribute 'to_tuple'",
    });

    expect(answer.isError).toBe(true);
    expect(answer.content[0]?.text).toBe(
      [
        "The script failed:",
        '  File "the script", line 3, in <module>',
        "    print(p.to_tuple())",
        "AttributeError: 'Vector' object has no attribute 'to_tuple'",
        `build123d ${version} changed this: write tuple(v), in place of v.to_tuple() of a Vector, Location, Color or Vertex. To read more, open doc:build123d/${version}/Vector or doc:build123d/${version}/Location.`,
      ].join("\n"),
    );
  });

  it("builds, and says the form that replaces what the script was warned of", async () => {
    const { build } = await studio();

    const answer = await build({
      stderr:
        "C:\\run\\script.py:4: DeprecationWarning: add() is deprecated; use insert() instead.\n  add(Box(1, 1, 1))",
    });

    expect(answer.isError).toBeUndefined();
    expect(answer.content[0]?.text).toContain(
      `build123d ${version} changed this: write insert(shape), in place of add(shape) in a builder. To read more, open doc:build123d/${version}/insert.`,
    );
  });

  it("names a warning seen before the script failed of something else", async () => {
    const { build } = await studio();

    const answer = await build({
      failed: "The script failed:\nValueError: no edges",
      stderr:
        "x.py:2: DeprecationWarning: Builder.new_edges is deprecated; use edges(Select.NEW) instead.",
    });

    expect(answer.content[0]?.text).toContain(
      "write builder.edges(Select.NEW), in place of builder.new_edges",
    );
  });

  it("adds nothing to an error or a build that shows no known change", async () => {
    const { build } = await studio();

    const failed = await build({
      failed: "The script failed:\nNameError: name 'Boks' is not defined",
    });
    const built = await build({ stderr: "" });

    expect(failed.content[0]?.text).toBe(
      "The script failed:\nNameError: name 'Boks' is not defined",
    );
    expect(built.content[0]?.text).not.toContain("changed this");
  });
});
