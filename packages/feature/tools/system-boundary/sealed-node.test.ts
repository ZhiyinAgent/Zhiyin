/**
 * Zhiyin's own Node in the sealed-off shell, on a real app container (ADR
 * 0029, ADR 0027): first on the shell's PATH, with npm and npx, and npm
 * installing from the registry through Zhiyin's proxy.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { forgetConfinement, openProcessContainer } from "@zhiyin/sandbox";
import { WorkspaceTools, type SealedToolchain } from "../src/index.js";

/** Zhiyin's shell as the gate builds it, and its Node as the tests install it. */
const built = process.env["ZHIYIN_BUSYBOX"] ?? "";
const node = process.env["ZHIYIN_NODE"] ?? "";
const folders = new TemporaryFolders();
const homes = new TemporaryFolders();
let homesFolder = "";

afterEach(() => folders.removeAll());
afterAll(async () => {
  for (const name of ["start-check", "chat"])
    forgetConfinement("shell", join(homesFolder, name));
  await homes.removeAll();
});

/** The tests' Node as a toolchain installed on first use: there once installed. */
function installedOnFirstUse() {
  let installed = false;
  return {
    executable: async () => (installed ? node : undefined),
    install: async () => {
      installed = true;
    },
  };
}

async function tools(
  registries: boolean,
  toolchain: SealedToolchain = installedOnFirstUse(),
) {
  homesFolder ||= await homes.make("zhiyin-node-homes-");
  const root = await folders.make("zhiyin-sealed-node-");
  const workspace = new WorkspaceTools(undefined, {
    containment: { open: openProcessContainer },
    // Each call answers with what it printed, however slow a loaded machine
    // makes it, rather than becoming a job.
    promoteCommandsAfterMs: 240_000,
    sealedShell: {
      busybox: join(built, "busybox.exe"),
      handoff: join(built, "git"),
      homes: homesFolder,
      node: toolchain,
    },
    reach: () => ({ hosts: [], read: [], change: [], registries }),
  });
  await workspace.enterFolder("chat", root);
  const run = async (command: string) => {
    const result = await workspace.execute(
      "bash",
      { command, purpose: "Use Node." },
      undefined,
      "chat",
    );
    return (result as { value: Record<string, unknown> }).value;
  };
  return { root, run };
}

describe.runIf(process.platform === "win32" && built !== "" && node !== "")(
  "Zhiyin's Node, sealed off",
  { timeout: 300_000 },
  () => {
    it("is the node, npm and npx the shell finds first", async () => {
      const { run } = await tools(false);

      const ran = await run(
        "node -v && npm --version && npx --version && command -v node",
      );

      const [version, npm, npx, found] = String(ran["stdout"]).split(/\r?\n/);
      expect(version).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(npm).toMatch(/^\d+\.\d+\.\d+$/);
      expect(npx).toBe(npm);
      const slashed = (path: string) =>
        path.toLowerCase().replaceAll("\\", "/");
      expect(slashed(found ?? "")).toContain(slashed(dirname(node)));
    });

    it("tells the model when it could not be installed, and the command still runs", async () => {
      const { run } = await tools(false, {
        executable: async () => undefined,
        install: async () => {
          throw new Error("nodejs.org could not be reached.");
        },
      });

      const ran = await run("echo ran");

      expect(ran["stdout"]).toBe("ran\n");
      expect(ran["sealedOff"]).toContain("nodejs.org could not be reached.");
    });

    it("installs a package from the registry through Zhiyin's proxy", async () => {
      const { root, run } = await tools(true);

      const ran = await run(
        "npm install --no-audit --no-fund --loglevel=error is-number@7.0.0",
      );

      expect(ran["exitCode"], String(ran["stderr"])).toBe(0);
      const installed = join(root, "node_modules", "is-number", "package.json");
      expect(existsSync(installed)).toBe(true);
      expect(JSON.parse(await readFile(installed, "utf8"))).toMatchObject({
        version: "7.0.0",
      });
    });
  },
);
