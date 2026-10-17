/**
 * What Blender is started with, against a container that records the launch:
 * no variable of the person's can point Blender at scripts it runs on start,
 * or USD and MaterialX at plugins and folders they load from.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessContainment } from "@zhiyin/process-ownership";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { containedSessionLaunch } from "../src/session-process.js";

const folders = new TemporaryFolders();

afterEach(async () => {
  vi.unstubAllEnvs();
  await folders.removeAll();
});

describe("starting Blender", () => {
  it("passes on none of the person's variables that name what Blender, USD or MaterialX load", async () => {
    vi.stubEnv("BLENDER_SYSTEM_SCRIPTS", "C:/planted/scripts");
    vi.stubEnv("PXR_PLUGINPATH_NAME", "C:/planted/usd");
    vi.stubEnv("MaterialX_Search_Path", "C:/planted/materialx");
    vi.stubEnv("ZHIYIN_KEPT", "kept");
    const directory = await folders.make("zhiyin-blender-session-");
    const program = join(directory, "blender");
    await mkdir(program);
    await writeFile(join(program, "blender.exe"), "");
    let environment: Readonly<Record<string, string | undefined>> | undefined;
    const containment = {
      open: () => ({
        launch: (options: { environment?: typeof environment }) => {
          environment = options.environment;
          throw new Error("Not started in this test.");
        },
        close: () => {},
      }),
    } as unknown as ProcessContainment;
    const launch = containedSessionLaunch(containment, async () => {});

    await expect(
      launch({
        executable: join(program, "blender.exe"),
        script: join(directory, "session.py"),
        directory: join(directory, "conversation"),
        warm: join(directory, "warm.png"),
      }),
    ).rejects.toThrow("Not started in this test.");

    const names = Object.keys(environment ?? {}).map((name) =>
      name.toUpperCase(),
    );
    expect(names).not.toContain("BLENDER_SYSTEM_SCRIPTS");
    expect(names).not.toContain("PXR_PLUGINPATH_NAME");
    expect(names).not.toContain("MATERIALX_SEARCH_PATH");
    expect(environment?.["ZHIYIN_KEPT"]).toBe("kept");
  });
});
