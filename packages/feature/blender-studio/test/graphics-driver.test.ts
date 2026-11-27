/**
 * The NVIDIA driver's version read from what Windows' `pnputil` prints of
 * the display adapters connected, in whatever language Windows speaks: the
 * properties are named by their `DEVPKEY`, NVIDIA's cards by vendor 10DE.
 */

import { describe, expect, it } from "vitest";
import { nvidiaDriverIn } from "../src/graphics-driver.js";

/** One adapter as `pnputil /enum-devices /properties` prints it on a French Windows. */
const adapter = (instance: string, name: string, version: string) =>
  [
    `ID d'instance :                 ${instance}`,
    `Description de l'appareil :          ${name}`,
    "Nom de la classe :                 Display",
    "Propriétés:",
    "    DEVPKEY_Device_DeviceDesc [Chaîne]:",
    `        ${name}`,
    "    DEVPKEY_Device_HardwareIds [Liste de chaînes]:",
    `        ${instance.split("\\").slice(0, 2).join("\\")}`,
    "        PCI\\CC_0300",
    "    DEVPKEY_Device_DriverVersion [Chaîne]:",
    `        ${version}`,
    "    DEVPKEY_Device_DriverProvider [Chaîne]:",
    `        ${name.split(" ")[0]}`,
    "    DEVPKEY_NAME [Chaîne]:",
    `        ${name}`,
    "    DEVPKEY_Device_InstanceId [Chaîne]:",
    `        ${instance}`,
  ].join("\r\n");

const amd = adapter(
  "PCI\\VEN_1002&DEV_164E&SUBSYS_D0001458&REV_CB\\4&16012499&0&0041",
  "AMD Radeon(TM) Graphics",
  "32.0.21045.5002",
);
const nvidia = (version: string, slot = "0009") =>
  adapter(
    `PCI\\VEN_10DE&DEV_2705&SUBSYS_471019DA&REV_A1\\4&d0bdf66&0&${slot}`,
    "NVIDIA GeForce RTX 4070 Ti SUPER",
    version,
  );

const printed = (...adapters: string[]) =>
  [
    "Utilitaire Plug-and-Play Microsoft",
    "",
    ...adapters.flatMap((a) => [a, ""]),
  ].join("\r\n");

describe("the NVIDIA driver's version, as pnputil prints the display adapters", () => {
  it("is the NVIDIA card's, beside another maker's", () => {
    expect(nvidiaDriverIn(printed(amd, nvidia("32.0.16.1088")))).toBe(
      "32.0.16.1088",
    );
  });

  it("is nothing on a PC with no NVIDIA card", () => {
    expect(nvidiaDriverIn(printed(amd))).toBeUndefined();
  });

  it("is nothing when pnputil printed no properties, as on Windows 10", () => {
    expect(
      nvidiaDriverIn(
        printed(
          [
            "Instance ID:                PCI\\VEN_10DE&DEV_2705&SUBSYS_471019DA&REV_A1\\4&d0bdf66&0&0009",
            "Device Description:         NVIDIA GeForce RTX 4070 Ti SUPER",
            "Driver Name:                oem12.inf",
          ].join("\r\n"),
        ),
      ),
    ).toBeUndefined();
  });

  it("names two NVIDIA cards' versions once each, in order, and one version once", () => {
    expect(
      nvidiaDriverIn(
        printed(nvidia("32.0.16.1100", "0010"), nvidia("32.0.16.1088")),
      ),
    ).toBe("32.0.16.1088 32.0.16.1100");
    expect(
      nvidiaDriverIn(
        printed(nvidia("32.0.16.1088", "0010"), nvidia("32.0.16.1088")),
      ),
    ).toBe("32.0.16.1088");
  });

  it("takes no other maker's version for the NVIDIA card's when a value is missing", () => {
    const withoutVersion = nvidia("32.0.16.1088").replace(
      "    DEVPKEY_Device_DriverVersion [Chaîne]:\r\n        32.0.16.1088\r\n",
      "",
    );
    expect(withoutVersion).not.toContain("DriverVersion");
    expect(nvidiaDriverIn(printed(withoutVersion, amd))).toBeUndefined();
  });
});
