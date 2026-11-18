/**
 * The parts each conversation built last, kept for the person's view of them:
 * what the view is told, and the mesh it reads back.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PartsPanelState } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { PartPreviews } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const plate = { name: "Plate", size: [80, 50, 8], valid: true } as const;
const pin = { name: "Pin", size: [10, 10, 10], valid: true } as const;

async function setUp() {
  const data = await folders.make("zhiyin-part-previews-");
  const runs = join(data, "runs");
  await mkdir(runs);
  /** A mesh as a build leaves it, in a run's folder that goes once it answers. */
  const built = async (text: string) => {
    const file = join(runs, `${Math.random()}.glb`);
    await writeFile(file, text);
    return file;
  };
  const previews = new PartPreviews(join(data, "cad-studio"));
  const heard: [string, PartsPanelState | undefined][] = [];
  previews.onChange((taskId, state) => heard.push([taskId, state]));
  return { data, runs, built, previews, heard };
}

const text = (data: Uint8Array | undefined) =>
  data === undefined ? undefined : Buffer.from(data).toString();

describe("the parts a conversation built last", () => {
  it("shows the latest build, and reads its mesh back only for that build", async () => {
    const { built, previews } = await setUp();

    await previews.shown("one", await built("first mesh"), [plate]);
    await previews.shown(
      "one",
      await built("second mesh"),
      [plate, pin],
      "parts/plate.py",
    );

    const state = previews.state("one");
    expect(state).toEqual({
      sequence: expect.any(Number),
      parts: [plate, pin],
      script: "parts/plate.py",
    });
    expect(text((await previews.model("one", state!.sequence))?.data)).toBe(
      "second mesh",
    );
    // A view still asking for the build before gets nothing, not the new mesh
    // under the old one's name.
    expect(await previews.model("one", state!.sequence - 1)).toBeUndefined();
  });

  it("keeps the mesh in its own folder, so it outlives the run that made it", async () => {
    const { built, runs, previews } = await setUp();

    await previews.shown("one", await built("the mesh"), [plate]);
    await rm(runs, { recursive: true });

    const { sequence } = previews.state("one")!;
    expect(text((await previews.model("one", sequence))?.data)).toBe(
      "the mesh",
    );
  });

  it("fails, rather than answering nothing as for a replaced build, when the mesh of the build shown cannot be read", async () => {
    const { built, data, previews } = await setUp();

    await previews.shown("one", await built("the mesh"), [plate]);
    const { sequence } = previews.state("one")!;
    await rm(join(data, "cad-studio", "one"), { recursive: true });

    await expect(previews.model("one", sequence)).rejects.toThrow();
  });

  it("keeps each conversation's parts apart", async () => {
    const { built, previews } = await setUp();

    await previews.shown("one", await built("one's mesh"), [plate]);
    await previews.shown("two", await built("two's mesh"), [pin]);

    expect(previews.state("one")?.parts).toEqual([plate]);
    expect(previews.state("two")?.parts).toEqual([pin]);
    const two = previews.state("two")!;
    expect(text((await previews.model("two", two.sequence))?.data)).toBe(
      "two's mesh",
    );
    expect(await previews.model("one", two.sequence)).toBeUndefined();
  });

  it("tells who listens of each build, and of the parts put away when going back removed it", async () => {
    const { built, data, previews, heard } = await setUp();

    await previews.shown("one", await built("the mesh"), [plate]);
    const { sequence } = previews.state("one")!;
    await previews.putAway("one");

    expect(heard).toEqual([
      ["one", { sequence, parts: [plate] }],
      ["one", undefined],
    ]);
    expect(previews.state("one")).toBeUndefined();
    expect(await previews.model("one", sequence)).toBeUndefined();
    expect(await readdir(join(data, "cad-studio", "one"))).toEqual([]);
  });

  it("keeps the parts shown before when a new mesh cannot be kept", async () => {
    const { built, runs, previews, heard } = await setUp();
    await previews.shown("one", await built("the mesh"), [plate]);
    const before = previews.state("one");

    await expect(
      previews.shown("one", join(runs, "never-written.glb"), [pin]),
    ).rejects.toThrow();

    expect(previews.state("one")).toEqual(before);
    expect(text((await previews.model("one", before!.sequence))?.data)).toBe(
      "the mesh",
    );
    expect(heard).toHaveLength(1);
  });

  it("lets go of a forgotten conversation's parts", async () => {
    const { built, previews } = await setUp();
    await previews.shown("one", await built("the mesh"), [plate]);
    const { sequence } = previews.state("one")!;

    await previews.forget("one");

    expect(previews.state("one")).toBeUndefined();
    expect(await previews.model("one", sequence)).toBeUndefined();
  });

  it("keeps nothing from the last time the app ran", async () => {
    const { data, built } = await setUp();
    const directory = join(data, "left-before");
    await mkdir(join(directory, "old-conversation"), { recursive: true });
    await writeFile(
      join(directory, "old-conversation", "parts-1.glb"),
      "an earlier run's mesh",
    );

    const previews = new PartPreviews(directory);
    await previews.shown("t1", await built("mesh"), [plate]);

    expect(await readdir(directory)).toEqual(["t1"]);
  });
});
