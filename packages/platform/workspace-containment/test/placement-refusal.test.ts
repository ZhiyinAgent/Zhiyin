import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  placedAgain,
  placeForWriting,
  placementRefusal,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("a placement that cannot be written", () => {
  it("is answered to the person when the path leaves the workspace or leads through a link whose target is missing", () => {
    expect(placementRefusal("../notes.md", "outside")).toEqual({
      reason: "../notes.md is outside the workspace.",
      correctable: false,
    });
    expect(placementRefusal("C:\\later\\part.step", "link")).toEqual({
      reason:
        "C:\\later\\part.step leads through a link whose target is missing, so where it would be written is not known.",
      correctable: false,
    });
  });

  it("is answered to the model when a better call can fix it, a place in Zhiyin's own folders included", () => {
    expect(
      placementRefusal("C:\\zhiyin-data\\approved.json", "protected"),
    ).toEqual({
      reason:
        "C:\\zhiyin-data\\approved.json is in a folder Zhiyin keeps for itself, which no tool writes. Choose another place for the file.",
      correctable: true,
    });
    expect(placementRefusal("con.pdf", "reserved")).toEqual({
      reason:
        "con.pdf is named as Windows names a device, such as NUL or CON, which no file can be. Give the file another name.",
      correctable: true,
    });
    expect(placementRefusal("notes.md:hidden", "colon")).toEqual({
      reason:
        'notes.md:hidden has a ":" in it. Name the file by a workspace-relative path without one.',
      correctable: true,
    });
    expect(placementRefusal("C:\\notes.md:hidden", "colon")).toEqual({
      reason:
        'C:\\notes.md:hidden has a ":" past its drive. Name the file without one.',
      correctable: true,
    });
    expect(placementRefusal("\\notes.md", "not-absolute")).toEqual({
      reason:
        "\\notes.md is not a whole path: give its drive, as C:\\folder\\file, or a workspace path.",
      correctable: true,
    });
  });
});

describe("a place approved for writing, placed again", () => {
  async function workspace() {
    const parent = await folders.make("zhiyin-placed-again-");
    const root = join(parent, "inside");
    await mkdir(join(root, "parts"), { recursive: true });
    await mkdir(join(parent, "elsewhere"));
    return { parent, root };
  }

  it("is the same while the path still reaches it", async () => {
    const { parent, root } = await workspace();
    const inside = await placeForWriting(root, "parts/gear.step");
    if (inside.kind !== "writable") throw new Error(inside.kind);
    const outside = join(parent, "elsewhere", "gear.step");

    await expect(placedAgain(root, inside)).resolves.toBe("same");
    await expect(
      placedAgain(root, {
        absolute: outside,
        relative: outside,
        exists: false,
        outside: true,
      }),
    ).resolves.toBe("same");
  });

  it("has moved when a link made since carries the path elsewhere", async () => {
    const { parent, root } = await workspace();
    const approved = await placeForWriting(root, "later/gear.step");
    if (approved.kind !== "writable") throw new Error(approved.kind);
    await symlink(join(parent, "elsewhere"), join(root, "later"), "junction");

    await expect(placedAgain(root, approved)).resolves.toBe("moved");
  });

  it("has a file appeared in it when none was approved to be replaced", async () => {
    const { root } = await workspace();
    const approved = await placeForWriting(root, "parts/gear.step");
    if (approved.kind !== "writable") throw new Error(approved.kind);
    await writeFile(join(root, "parts", "gear.step"), "made meanwhile");

    await expect(placedAgain(root, approved)).resolves.toBe("appeared");
  });

  it("has moved when a place outside now leads into the workspace or into Zhiyin's own folders", async () => {
    const { parent, root } = await workspace();
    const own = join(parent, "elsewhere");
    const outside = join(own, "gear.step");
    const approved = {
      absolute: outside,
      relative: outside,
      exists: false,
      outside: true,
    } as const;

    await expect(placedAgain(root, approved, [own])).resolves.toBe("moved");
  });
});
