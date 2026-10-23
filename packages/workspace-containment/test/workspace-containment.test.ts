import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  locateInside,
  realStaysBelow,
  realStaysInside,
  staysBelow,
  staysInside,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace() {
  const parent = await folders.make("zhiyin-containment-");
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

  it("compares a path not yet resolved without case, as Windows matches names", () => {
    const root = join("C:", "work", "inside");
    expect(staysInside(root, join("c:", "WORK", "Inside", "a.pdf"))).toBe(true);
    expect(staysBelow(root, join("C:", "Work", "INSIDE"))).toBe(false);
    expect(staysInside(root, join("C:", "work", "INSIDE-not"))).toBe(false);
  });

  it("compares real paths exactly, so a sibling whose name differs only in case is outside", () => {
    const root = join("C:", "work", "inside");
    expect(realStaysInside(root, join(root, "reports", "q3.pdf"))).toBe(true);
    expect(realStaysInside(root, root)).toBe(true);
    expect(realStaysInside(root, join("C:", "work", "INSIDE", "a.pdf"))).toBe(
      false,
    );
    expect(realStaysInside(root, join("C:", "work", "inside-not"))).toBe(false);
    expect(realStaysInside("C:\\", "C:\\work")).toBe(true);
    expect(realStaysBelow(root, root)).toBe(false);
    expect(realStaysBelow(root, join(root, "a.pdf"))).toBe(true);
  });

  it.skipIf(!TemporaryFolders.canTellCaseApart())(
    "refuses a sibling whose name differs only in case, in a folder that tells case apart",
    async () => {
      const parent = await folders.makeCaseSensitive(
        "zhiyin-containment-case-",
      );
      const root = join(parent, "inside");
      await mkdir(root);
      await mkdir(join(parent, "INSIDE"));
      await writeFile(join(parent, "INSIDE", "secret.txt"), "outside");
      await symlink(join(parent, "INSIDE"), join(root, "link"), "junction");

      await expect(locateInside(root, "../INSIDE/secret.txt")).resolves.toEqual(
        { kind: "outside" },
      );
      await expect(locateInside(root, "link/secret.txt")).resolves.toEqual({
        kind: "outside",
      });
    },
  );

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
    // Missing, so only the check made before reading can say outside rather
    // than missing; and a share on another machine is never opened.
    await expect(locateInside(root, "../nothing-here.pdf")).resolves.toEqual({
      kind: "outside",
    });
    await expect(
      locateInside(root, join(parent, "nothing-here.pdf")),
    ).resolves.toEqual({ kind: "outside" });
    await expect(
      locateInside(root, "\\\\localhost\\C$\\Windows\\win.ini"),
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
