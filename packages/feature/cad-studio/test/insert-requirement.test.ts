/**
 * An insert requirement as the model writes it in a requirements file: the
 * fields it takes, and the words that refuse one written wrong, before any
 * build runs. What the check measures is shown against a real build123d.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { requirementsFor } from "../src/requirements-request.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function read(requirement: Record<string, unknown>) {
  const root = await folders.make("zhiyin-insert-requirement-");
  await writeFile(
    join(root, "requirements.json"),
    JSON.stringify({ requirements: [requirement] }),
  );
  return requirementsFor(root, "requirements.json");
}

describe("an insert requirement", () => {
  it("takes the part, the way it goes in, the parts it goes into, how far it travels and the least clearance", async () => {
    const written = {
      id: "R1",
      says: "The axle goes in through both wheels",
      check: "insert",
      part: "/Axle_.*/",
      along: [0, 1, 0],
      into: ["Body", "/Wheel_.*/"],
      travel: 60,
      min: 0.2,
    };

    expect(await read(written)).toEqual({
      ok: true,
      file: "requirements.json",
      requirements: [written],
    });
    expect(
      await read({
        id: "R2",
        check: "insert",
        part: "Lid",
        along: [0, 0, -1],
        min: 0,
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses one without its way, with a way of no length, or with a travel or a clearance that is no distance", async () => {
    const insert = {
      id: "R1",
      check: "insert",
      part: "Pin",
      along: [0, 0, -1],
    };

    expect(await read({ id: "R1", check: "insert", part: "Pin" })).toEqual({
      ok: false,
      file: "requirements.json",
      reason: "requirements.json: R1: an insert check needs along.",
    });
    expect(await read({ ...insert, along: [0, 0, 0] })).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: R1: along is the direction [x, y, z] the part moves as it goes into its place.",
    });
    expect(await read({ ...insert, travel: 0 })).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: R1: travel is how far the part moves to its place, in mm, above 0; left out, from where it is clear of the parts it goes into.",
    });
    expect(await read({ ...insert, min: -0.1 })).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: R1: min is the least clearance in mm it keeps on the way, 0 or more.",
    });
    expect(await read({ ...insert, into: "Plate" })).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: R1: into names from 1 to 200 parts it goes into or past, or patterns between slashes, each at most 200 characters, and a pattern such as /Bolt_.*/ stands for many; left out, every other shown part.",
    });
  });
});
