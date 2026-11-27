/**
 * The version of this PC's NVIDIA graphics driver, as Windows' device
 * properties state it, which a kept shader cache is matched by (ADR 0032).
 * Windows' own `pnputil` lists the display adapters connected with their
 * properties; each property is named by its `DEVPKEY` in every language
 * Windows speaks, and NVIDIA's cards by its PCI vendor ID, 10DE.
 */

import { join } from "node:path";
import { runProcess, type ProcessContainment } from "@zhiyin/sandbox";

/** Windows' class of display adapters. */
const displayClass = "{4d36e968-e325-11ce-bfc1-08002be10318}";

/** An NVIDIA card's device instance ID, on the PCI bus. */
const nvidiaInstance = /^PCI\\VEN_10DE&/i;

/** A property's name line, `DEVPKEY_… [type]:`; its value is on the line below. */
const propertyLine = /^\s+(DEVPKEY_\w+) \[[^\]]*\]:\s*$/;

/**
 * Each device `pnputil /enum-devices /properties` printed, as its
 * properties: a device's lines start unindented and its properties follow
 * indented, each name above its value.
 */
function devices(printed: string): Map<string, string>[] {
  const found: Map<string, string>[] = [];
  let device: Map<string, string> | undefined;
  let named: string | undefined;
  for (const line of printed.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      if (device === undefined || device.size > 0 || named !== undefined) {
        device = new Map();
        found.push(device);
      }
      named = undefined;
      continue;
    }
    const property = propertyLine.exec(line);
    if (property) named = property[1];
    else if (named !== undefined && device !== undefined) {
      if (!device.has(named)) device.set(named, line.trim());
      named = undefined;
    }
  }
  return found;
}

/**
 * The NVIDIA driver's version among the devices `pnputil` printed, or
 * nothing when no NVIDIA card is listed. Several cards on different
 * drivers give each version, in order.
 */
export function nvidiaDriverIn(printed: string): string | undefined {
  const versions = new Set<string>();
  for (const device of devices(printed)) {
    const instance = device.get("DEVPKEY_Device_InstanceId");
    const version = device.get("DEVPKEY_Device_DriverVersion");
    if (instance && nvidiaInstance.test(instance) && version)
      versions.add(version);
  }
  return versions.size > 0 ? [...versions].sort().join(" ") : undefined;
}

/**
 * Reads the NVIDIA driver's version from Windows each time it is asked,
 * running `pnputil`, by its full path, in a Job Object (ADR 0005). Nothing
 * when the PC has no NVIDIA card, or when the list cannot be read, as on a
 * Windows older than 11, whose `pnputil` lists no properties.
 */
export function nvidiaDriverVersion(
  containment: ProcessContainment,
): () => Promise<string | undefined> {
  return async () => {
    const system = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32");
    const run = await runProcess({
      executable: join(system, "pnputil.exe"),
      arguments: [
        "/enum-devices",
        "/class",
        displayClass,
        "/connected",
        "/properties",
      ],
      cwd: system,
      timeoutMs: 15_000,
      containment,
    });
    return run.exitCode === 0 ? nvidiaDriverIn(run.stdout) : undefined;
  };
}
