/**
 * The sandbox against a real `uv`.
 *
 * The other tests replace the invocation, which proves the arguments and the
 * isolation but not that `uv` accepts them. This builds a real environment and
 * runs a real script. It is skipped unless `uv` is named in the environment,
 * because the gate installs nothing:
 *
 *   $env:ZHIYIN_UV = "…\uv.exe"; npx vitest run packages/python-sandbox
 *
 * It downloads a Python and one package, so it is slow the first time.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pythonSandbox } from "../src/index.js";

const uv = process.env["ZHIYIN_UV"];
const roots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `zhiyin-sandbox-live-${label}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.runIf(uv)("the real uv", () => {
  it("builds an environment apart from a project in the workspace, and runs a script in it", async () => {
    const workspace = await temporaryRoot("workspace");
    // A project in the workspace that would capture an ordinary uv command.
    await writeFile(
      join(workspace, "pyproject.toml"),
      '[project]\nname = "someone-elses"\nversion = "0.0.1"\nrequires-python = ">=3.13"\ndependencies = ["this-package-does-not-exist-anywhere"]\n',
    );
    const sandbox = pythonSandbox({
      workspaceRoot: () => workspace,
      directory: join(await temporaryRoot("data"), "python-sandbox"),
      uv: async () => uv,
      packages: ["numpy"],
    });

    const result = (await sandbox.callTool("run_python", {
      code: "import numpy, pathlib; print(numpy.arange(3).sum()); pathlib.Path('out.txt').write_text('done')",
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("3");
    // The script's working directory is the workspace, so its file landed there.
    expect(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(workspace, "out.txt"), "utf8"),
      ),
    ).toBe("done");
  }, 900_000);
});
