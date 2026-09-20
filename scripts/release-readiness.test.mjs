import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path) => readFile(path, "utf8");

describe("open-source release contracts", () => {
  it("declares Apache-2.0 for the repository and desktop application", async () => {
    const [repositoryPackage, desktopPackage] = await Promise.all([
      read("package.json").then(JSON.parse),
      read("apps/desktop/package.json").then(JSON.parse),
    ]);

    expect(repositoryPackage.license).toBe("Apache-2.0");
    expect(desktopPackage.license).toBe("Apache-2.0");
    expect(desktopPackage.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
  });

  it("places the project and third-party notices beside the packaged app", async () => {
    const packaging = await read("apps/desktop/electron-builder.yml");

    expect(packaging).toContain("from: ../../LICENSE");
    expect(packaging).toContain("from: ../../NOTICE");
    expect(packaging).toContain("from: ../../THIRD_PARTY_LICENSES.md");
  });

  it("makes the gate the only definition of CI checks", async () => {
    const workflow = await read(".github/workflows/ci.yml");

    expect(workflow).toContain("scripts/gate.ps1");
    expect(workflow).not.toMatch(/pnpm (?:lint|typecheck|test|build)/);
  });

  it("installs Electron from the workspace that declares it", async () => {
    const [ciWorkflow, releaseWorkflow, desktopPackage] = await Promise.all([
      read(".github/workflows/ci.yml"),
      read(".github/workflows/release.yml"),
      read("apps/desktop/package.json").then(JSON.parse),
    ]);

    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      expect(workflow).toContain("pnpm --filter desktop install:electron");
      expect(workflow).not.toContain("pnpm exec install-electron");
      expect(workflow).not.toContain("exec install-electron");
    }

    expect(desktopPackage.scripts["install:electron"]).toBe(
      "node node_modules/electron/install.js",
    );
  });

  it("publishes only alpha previews with checksums and provenance", async () => {
    const workflow = await read(".github/workflows/release.yml");

    expect(workflow).toContain("scripts/gate.ps1 -Full");
    expect(workflow).toContain("Get-FileHash");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toMatch(/actions\/attest@[0-9a-f]{40} # v4/);
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("--latest=false");
  });
});
