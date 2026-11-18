/**
 * The environment the studio hands to whoever keeps it: the lock it ships,
 * and how it is named and refused when a package is asked for.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cadEnvironment } from "../src/index.js";

describe("the CAD environment", () => {
  it("pins build123d and bd_warehouse in the lock it ships, with the size of each file it installs", () => {
    const lock = cadEnvironment.lock;

    expect(lock.asked).toEqual(["build123d", "bd_warehouse"]);
    expect(lock.locked.map((entry) => entry.name)).toContain("build123d");
    expect(lock.locked.map((entry) => entry.name)).toContain("bd-warehouse");
    expect(lock.locked.every((entry) => entry.bytes > 0)).toBe(true);
    expect(lock.pythonBuild.bytes).toBeGreaterThan(0);
  });

  it("pins the library versions the harness's replaced operations were last proved against", async () => {
    // Moving the pin starts by running the real-library tests on the new
    // versions; only then does the harness say it was proved against them.
    const interception = await readFile(
      new URL("../src/harness/zhiyin_cad/interception.py", import.meta.url),
      "utf8",
    );
    const proved =
      /^PROVED_WITH = \{"build123d": "([^"]+)", "bd_warehouse": "([^"]+)"\}$/m.exec(
        interception,
      );
    const pinned = (name: string) =>
      cadEnvironment.lock.locked.find((entry) => entry.name === name)?.version;

    expect(proved?.slice(1)).toEqual([
      pinned("build123d"),
      pinned("bd-warehouse"),
    ]);
  });

  it("is made by the CAD studio connector of the 3D & Rendering plugin, and takes no package, which could change the kernel's versions", () => {
    expect(cadEnvironment.name).toBe("cad");
    expect(cadEnvironment.installedBy).toEqual({
      connector: "CAD studio connector",
      plugin: "3D & Rendering",
    });
    expect(cadEnvironment.takesNoPackages).toBe(
      "“cad” is the CAD studio's environment, pinned to the versions it is tested with, so it takes no other package: a package could change the kernel's versions. Add it to the default environment or one of your own.",
    );
  });
});
