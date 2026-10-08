import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateInside, staysBelow, staysInside } from "../src/index.js";

async function workspace() {
  const parent = await mkdtemp(join(tmpdir(), "zhiyin-containment-"));
  const root = join(parent, "inside");
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, "reports", "q3.pdf"), "inside");
  await writeFile(join(parent, "secret.pdf"), "outside");
  await mkdir(join(parent, "elsewhere"));
  await writeFile(join(parent, "elsewhere", "secret.pdf"), "outside");
  return { parent, root };
}

describe("workspace containment", () => {
  it("keeps a path inside the folder, and refuses the parent, a sibling and another drive", () => {
    const root = join("C:", "work", "inside");
    expect(staysInside(root, join(root, "reports", "q3.pdf"))).toBe(true);
    expect(staysInside(root, root)).toBe(true);
    expect(staysInside(root, join(root, ".."))).toBe(false);
    expect(staysInside(root, join(root, "..", "inside-not", "a.pdf"))).toBe(
      false,
    );
    expect(staysInside(root, join("D:", "work", "inside", "a.pdf"))).toBe(
      false,
    );
  });

  it("keeps a name that only starts with two dots inside", () => {
    const root = join("C:", "work", "inside");
    expect(staysInside(root, join(root, "..notes.md"))).toBe(true);
    expect(staysBelow(root, join(root, "..notes.md"))).toBe(true);
  });

  it("keeps a path below the folder, and refuses the folder itself and what is outside", () => {
    const root = join("C:", "work", "inside");
    expect(staysBelow(root, join(root, "reports", "q3.pdf"))).toBe(true);
    expect(staysBelow(root, root)).toBe(false);
    expect(staysBelow(root, join(root, "reports", ".."))).toBe(false);
    expect(staysBelow(root, join(root, ".."))).toBe(false);
    expect(staysBelow(root, join("D:", "work", "inside", "a.pdf"))).toBe(false);
  });

  it("finds a file inside the folder by its workspace-relative path", async () => {
    const { root } = await workspace();
    const found = await locateInside(root, "reports/q3.pdf");
    expect(found).toMatchObject({ kind: "found" });
    expect(found.kind === "found" && found.path.endsWith("q3.pdf")).toBe(true);
  });

  it("refuses a path that climbs out, or is absolute, before reading anything", async () => {
    const { parent, root } = await workspace();
    await expect(locateInside(root, "../secret.pdf")).resolves.toEqual({
      kind: "outside",
    });
    await expect(
      locateInside(root, join(parent, "secret.pdf")),
    ).resolves.toEqual({ kind: "outside" });
  });

  it("refuses a link that leads out of the folder", async () => {
    const { parent, root } = await workspace();
    await symlink(join(parent, "elsewhere"), join(root, "link"), "junction");
    await expect(locateInside(root, "link/secret.pdf")).resolves.toEqual({
      kind: "outside",
    });
  });

  it("says a file is missing, or is a folder, rather than finding it", async () => {
    const { root } = await workspace();
    await expect(locateInside(root, "reports/q4.pdf")).resolves.toEqual({
      kind: "missing",
    });
    await expect(locateInside(root, "reports")).resolves.toEqual({
      kind: "not-a-file",
    });
  });
});
