/**
 * The made CAD environment's Python, confined as the kept environments run
 * theirs, for the tests that run the real harness. Named by
 * ZHIYIN_CAD_PYTHON; the tests are skipped without it.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  forgetConfinement,
  openProcessContainer,
  runProcess,
} from "@zhiyin/sandbox";
import type { CadPython } from "../src/index.js";

export const python = process.env["ZHIYIN_CAD_PYTHON"];
export const harness = fileURLToPath(
  new URL("../src/harness/run.py", import.meta.url),
);

export async function confinedPython(): Promise<CadPython> {
  const environment = dirname(dirname(python!));
  const configured = await readFile(join(environment, "pyvenv.cfg"), "utf8");
  const base = /^home\s*=\s*(.+)$/m.exec(configured)?.[1]?.trim();
  if (!base) throw new Error("The CAD environment names no base Python.");
  return {
    state: async () => "ready",
    async run(request) {
      const ran = await runProcess({
        executable: python!,
        arguments: request.arguments,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        ...(request.maximumOutputBytes
          ? { maximumOutputBytes: request.maximumOutputBytes }
          : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        containment: { open: openProcessContainer },
        environment: {
          SystemRoot: process.env["SystemRoot"],
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
        },
        confinement: {
          purpose: "python-cad-test",
          home: request.home,
          read: [base, environment, ...request.read],
          write: [...request.write],
          hosts: [],
        },
      }).finally(() => {
        // As the sandbox does: a home that lasts one run goes with it.
        if (request.homeLastsOneRun)
          forgetConfinement("python-cad-test", request.home);
      });
      if (ran.failure)
        return {
          ok: false,
          reason: ran.reason ?? `It failed: ${ran.failure}.`,
        };
      return {
        ok: true,
        run: {
          exitCode: ran.exitCode,
          stdout: ran.stdout,
          stderr: ran.stderr,
          ...(ran.ending ? { ending: ran.ending } : {}),
        },
      };
    },
  };
}
