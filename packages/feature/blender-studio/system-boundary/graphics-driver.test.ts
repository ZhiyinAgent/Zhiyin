/**
 * This PC's NVIDIA driver version as Zhiyin reads it from Windows' device
 * properties, through `pnputil` in a Job Object, against the version WMI
 * gives for the same cards, a second source the app does not use. On a PC
 * without an NVIDIA card both are nothing.
 *
 *   npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/graphics-driver.test.ts
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { nvidiaDriverVersion } from "../src/index.js";

/** The NVIDIA cards' driver versions as WMI states them, in order, or nothing. */
async function fromWmi(): Promise<string | undefined> {
  const powershell = join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const { stdout } = await promisify(execFile)(powershell, [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_VideoController | Where-Object { $_.PNPDeviceID -like 'PCI\\VEN_10DE&*' } | ForEach-Object { $_.DriverVersion }",
  ]);
  const versions = [
    ...new Set(
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort();
  return versions.length > 0 ? versions.join(" ") : undefined;
}

describe("this PC's NVIDIA driver version", () => {
  it("is the one WMI gives for its NVIDIA cards, or nothing without one", async () => {
    const read = nvidiaDriverVersion({ open: openProcessContainer });

    expect(await read()).toBe(await fromWmi());
  }, 60_000);
});
