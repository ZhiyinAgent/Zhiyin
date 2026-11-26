/**
 * The CAD environment's Python for tests that join the two studios, confined
 * as the kept environments run theirs: it reads its own environment, the
 * folder its base Python is in and the folders a run grants, writes only
 * those it is given, and has no network.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CadPython } from "@zhiyin/cad-studio";
import {
  forgetConfinement,
  openProcessContainer,
  runProcess,
} from "@zhiyin/sandbox";

/** `python` is the environment's own, as ZHIYIN_CAD_PYTHON names it; `purpose` names the confinement. */
export async function confinedCadPython(
  python: string,
  purpose: string,
): Promise<CadPython> {
  const environment = dirname(dirname(python));
  const configured = await readFile(join(environment, "pyvenv.cfg"), "utf8");
  const base = /^home\s*=\s*(.+)$/m.exec(configured)?.[1]?.trim();
  if (!base) throw new Error("The CAD environment names no base Python.");
  return {
    state: async () => "ready",
    async run(request) {
      const ran = await runProcess({
        executable: python,
        arguments: request.arguments,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        ...(request.signal ? { signal: request.signal } : {}),
        containment: { open: openProcessContainer },
        environment: {
          SystemRoot: process.env["SystemRoot"],
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
        },
        confinement: {
          purpose,
          home: request.home,
          // The folder of Zhiyin's Pythons, as the kept environments are
          // given it: the environment names its Python through a link there.
          read: [dirname(base), environment, ...request.read],
          write: [...request.write],
          hosts: [],
        },
      }).finally(() => {
        // As the sandbox does: a home that lasts one run goes with it.
        if (request.homeLastsOneRun) forgetConfinement(purpose, request.home);
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
          // Why it ended early, as the production adapter says, so a time-out reads as one.
          ...(ran.ending ? { ending: ran.ending } : {}),
        },
      };
    },
  };
}
