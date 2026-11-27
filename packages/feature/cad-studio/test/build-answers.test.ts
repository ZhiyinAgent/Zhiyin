/**
 * What a build's answer says beside the measures of this build: how each part
 * changed since the last build of the same script, files an earlier build
 * wrote whose parts have changed since, requirements that failed and then
 * left the requirements file, how many objects a part meant to print prints
 * as, and the joins and cuts with a shape of no volume. Python is a stand-in
 * answering as the harness would; the real harness's measures are shown in
 * the system-boundary tests.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation, PartReviews, type CadPython } from "../src/index.js";
import { requestOf, stoppedUnasked } from "./harness-request.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

type Part = {
  name: string;
  valid: boolean;
  solids: number;
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  volume: number;
  area: number;
  centre: [number, number, number] | null;
  faces: Record<string, number>;
  holes: { diameter: number; count: number }[];
};

/** A part of the size and volume given, its box about the origin. */
function part(
  name: string,
  size: [number, number, number],
  volume: number,
  more: Partial<Part> = {},
): Part {
  return {
    name,
    valid: true,
    solids: 1,
    size,
    min: [-size[0] / 2, -size[1] / 2, -size[2] / 2],
    max: [size[0] / 2, size[1] / 2, size[2] / 2],
    volume,
    area: 1000,
    centre: [0, 0, 0],
    faces: { plane: 6 },
    holes: [],
    ...more,
  };
}

type Requirement = { id: string; says?: string };

/** What the stand-in harness answers next: the parts, what it says of each requirement, and anything more. */
type Answering = {
  parts: Part[];
  requirement?: (one: Requirement) => Record<string, unknown>;
  more?: Record<string, unknown>;
  exportMore?: Record<string, unknown>;
};

async function studio() {
  const root = await folders.make("zhiyin-cad-answers-workspace-");
  const data = await folders.make("zhiyin-cad-answers-data-");
  const answering: Answering = { parts: [] };
  const python: CadPython = {
    state: async () => "ready",
    run: async (request) => {
      const path = await requestOf(request);
      if (!path) return stoppedUnasked;
      const given = JSON.parse(await readFile(path, "utf8")) as {
        phase?: string;
        output: string;
        exports?: { file: string; kind: string; parts?: string[] }[];
        requirements?: Requirement[];
      };
      if (given.phase === "script")
        await writeFile(join(given.output, "manifest.json"), "{}");
      else {
        for (const one of given.exports ?? [])
          await writeFile(join(given.output, one.file), `${one.kind} file`);
        await writeFile(
          join(given.output, "answer.json"),
          JSON.stringify({
            parts: answering.parts,
            overlaps: [],
            exports: (given.exports ?? []).map((one) => ({
              file: one.file,
              bytes: 2048,
              parts: one.parts ?? answering.parts.map((p) => p.name),
              ...answering.exportMore,
            })),
            seconds: { total: 1 },
            picture: false,
            ...(given.requirements
              ? {
                  requirements: given.requirements.map((one) => ({
                    id: one.id,
                    holds: true,
                    measured: "as asked",
                    margin: 1,
                    unit: "mm",
                    ...answering.requirement?.(one),
                  })),
                }
              : {}),
            ...answering.more,
          }),
        );
      }
      return { ok: true, run: { exitCode: 0, stdout: "", stderr: "" } };
    },
  };
  const tools = cadAutomation(python, {
    workspaceRoot: () => root,
    harness: join(data, "harness", "run.py"),
    directory: join(data, "cad-studio"),
  });
  const call = async (args: Record<string, unknown>) => {
    const asked = await tools.inspect("cad_build", args);
    if (!asked.ok) throw new Error(asked.reason);
    return (await tools.callTool(
      "cad_build",
      args,
      undefined,
      asked.identity,
    )) as { isError?: boolean; content: { text?: string }[] };
  };
  const build = async (args: Record<string, unknown>) =>
    (await call(args)).content[0]?.text ?? "";
  /** What the person is shown of a build: the details drawn under its call. */
  const shown = async (args: Record<string, unknown>) =>
    tools.describeResult("cad_build", args, {
      ok: true,
      value: await call(args),
    });
  await writeFile(join(root, "stand.py"), "show(Box(1, 1, 1))\n");
  return { root, answering, build, shown, directory: join(data, "cad-studio") };
}

describe("what changed since the last build of the same script", () => {
  it("says, for each part that changed notably, its volume, size and solids before and after, and nothing of the others", async () => {
    const { answering, build } = await studio();
    answering.parts = [
      part("Body", [100, 50, 20], 100_000),
      part("Wheel", [20, 20, 10], 3000),
    ];
    const first = await build({ file: "stand.py" });
    answering.parts = [
      part("Body", [100, 50, 60], 151_000, { solids: 2 }),
      part("Wheel", [20, 20, 10], 3000),
    ];
    const second = await build({ file: "stand.py" });

    expect(first).not.toContain("changed since");
    expect(second).toContain(
      "Body changed since the last build of stand.py: volume 100 → 151 cm³ (+51%), size 100 × 50 × 20 → 100 × 50 × 60 mm, 1 → 2 solids.",
    );
    expect(second).not.toContain("Wheel changed");
  });

  it("leaves out a change of under 2% in volume and of under 1% of its longest side in size", async () => {
    const { answering, build } = await studio();
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    await build({ file: "stand.py" });
    answering.parts = [part("Body", [100.5, 50, 20], 101_500)];
    const slight = await build({ file: "stand.py" });
    answering.parts = [part("Body", [100.5, 50, 20], 104_000)];
    const more = await build({ file: "stand.py" });

    expect(slight).not.toContain("changed since");
    expect(more).toContain(
      "Body changed since the last build of stand.py: volume 102 → 104 cm³ (+2%).",
    );
  });

  it("says a part that is no longer a valid solid, one with no volume, and the parts the last build showed that this one does not", async () => {
    const { answering, build } = await studio();
    answering.parts = [
      part("Body", [100, 50, 20], 100_000),
      part("Mirror", [4, 4, 4], 64),
      part("Roof", [40, 40, 2], 3200),
    ];
    await build({ file: "stand.py" });
    answering.parts = [
      part("Body", [100, 50, 20], 100_000, { valid: false }),
      part("Cabin", [96, 0, 0], 0, { valid: false, centre: null }),
    ];
    const second = await build({ file: "stand.py" });

    expect(second).toContain(
      "Body changed since the last build of stand.py: no longer a valid solid.",
    );
    expect(second).toContain("Cabin has no volume: it holds no material.");
    expect(second).toContain(
      "Mirror and Roof were shown by the last build of stand.py and are not shown now.",
    );
  });

  it("compares a build only with the last of the same script and arguments, and code with the last build of code", async () => {
    const { answering, build } = await studio();
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    await build({ file: "stand.py", arguments: ["20"] });
    answering.parts = [part("Body", [100, 50, 40], 200_000)];
    const other = await build({ file: "stand.py", arguments: ["40"] });
    answering.parts = [part("Body", [100, 50, 22], 110_000)];
    const again = await build({ file: "stand.py", arguments: ["20"] });
    await build({ code: "show(Box(1, 1, 1))" });
    answering.parts = [part("Body", [100, 50, 40], 200_000)];
    const code = await build({ code: "show(Box(2, 2, 2))" });

    expect(other).not.toContain("changed since");
    expect(again).toContain(
      "Body changed since the last build of stand.py with the same arguments: volume 100 → 110 cm³ (+10%), size 100 × 50 × 20 → 100 × 50 × 22 mm.",
    );
    expect(code).toContain(
      "Body changed since the last build of code given in the call: volume 110 → 200 cm³ (+82%), size 100 × 50 × 22 → 100 × 50 × 40 mm.",
    );
  });

  it("takes code that shows no part of the last build of code's names for another design, and says nothing of the parts it does not show", async () => {
    const { answering, build } = await studio();
    answering.parts = [part("Bracket", [100, 50, 20], 100_000)];
    await build({ code: "show(Box(1, 1, 1))" });
    answering.parts = [part("Block", [10, 10, 10], 1000)];
    const block = await build({ code: "show(Box(2, 2, 2))" });
    answering.parts = [
      part("Block", [10, 10, 20], 2000),
      part("Pin", [2, 2, 8], 25),
    ];
    const again = await build({ code: "show(Box(3, 3, 3))" });

    expect(block).not.toContain("Bracket");
    expect(again).toContain(
      "Block changed since the last build of code given in the call: volume 1 → 2 cm³ (+100%), size 10 × 10 × 10 → 10 × 10 × 20 mm.",
    );
  });
});

describe("how much of each part is said", () => {
  it("gives in full only the parts that changed since the last build of the same script, naming the rest as unchanged", async () => {
    const { answering, build } = await studio();
    const broken = part("Bracket", [30, 30, 5], 2000, { valid: false });
    answering.parts = [
      part("Body", [100, 50, 20], 100_000),
      part("Wheel", [20, 20, 10], 3000),
      part("Axle", [5, 5, 40], 700),
      broken,
    ];
    const first = await build({ file: "stand.py" });
    answering.parts = [
      part("Body", [100, 50, 60], 151_000),
      part("Wheel", [20, 20, 10], 3000),
      part("Axle", [5, 5, 40], 700),
      broken,
    ];
    const second = await build({ file: "stand.py" });

    expect(first).toContain("Wheel: a valid solid, 20 × 20 × 10 mm");
    expect(second).toContain("Body: a valid solid, 100 × 50 × 60 mm");
    expect(second).not.toContain("Wheel: a valid solid");
    expect(second).toContain(
      "Wheel and Axle are as the last build of stand.py measured them.",
    );
    // A part with a fault is given in full however often it is built.
    expect(second).toContain("Bracket: not a valid solid");
  });

  it("gives parts alike in one line, with where each one's centre of mass is", async () => {
    const { answering, build } = await studio();
    const screw = (name: string, x: number) =>
      part("", [4, 4, 20], 200, {
        name,
        min: [x - 2, -2, -10],
        max: [x + 2, 2, 10],
        centre: [x, 0, 0],
      });
    answering.parts = [
      part("Body", [100, 50, 20], 100_000),
      screw("Screw_1", -40),
      screw("Screw_2", 0),
      screw("Screw_3", 40),
    ];

    const said = await build({ file: "stand.py" });

    expect(said).toContain(
      "Screw_1, Screw_2 and Screw_3, each: a valid solid, 4 × 4 × 20 mm. Volume 200 mm³, surface 1,000 mm². 6 faces: 6 flat. Centres of mass at (-40, 0, 0), (0, 0, 0) and (40, 0, 0).",
    );
    expect(said).not.toContain("Screw_2: a valid solid");
  });

  it("says the press fits together, and every deeper overlap in full", async () => {
    const { answering, build } = await studio();
    answering.parts = [
      part("Housing", [100, 50, 20], 100_000),
      part("Bearing_1", [13, 13, 5], 415),
      part("Bearing_2", [13, 13, 5], 415, { centre: [30, 0, 0] }),
      part("Gear", [20, 20, 8], 2000),
    ];
    const fit = (second: string, volume: number) => ({
      first: "Housing",
      second,
      volume,
      depth: 0.05,
      min: [0, 0, 0],
      max: [1, 1, 1],
    });
    answering.more = {
      overlaps: [
        fit("Bearing_1", 4.86),
        fit("Bearing_2", 4.86),
        {
          first: "Housing",
          second: "Gear",
          volume: 120,
          depth: 2,
          min: [0, 0, 0],
          max: [5, 5, 5],
        },
      ],
    };

    const said = await build({ file: "stand.py" });

    expect(said).toContain(
      "Housing and Bearing_1 (4.86 mm³) and Housing and Bearing_2 (4.86 mm³) overlap by as little as a press fit, at most 0.05 mm thick, which is meant only where one part is pressed into the other.",
    );
    expect(said).toContain(
      "Housing and Gear overlap by 120 mm³, what they share 2 mm thick, from (0, 0, 0) to (5, 5, 5): far deeper than a press fit",
    );
  });
});

describe("files an earlier build wrote", () => {
  it("names a file an earlier build of the script wrote whose part has changed since, until a build writes it again", async () => {
    const { answering, build } = await studio();
    answering.parts = [
      part("Body", [100, 50, 20], 100_000),
      part("Wheel", [20, 20, 10], 3000),
    ];
    await build({
      file: "stand.py",
      exports: [
        { path: "out/body.stl", parts: ["Body"] },
        { path: "out/wheel.stl", parts: ["Wheel"] },
      ],
    });
    // Moved, but alike in every measure the answer gives besides where it lies.
    answering.parts = [
      part("Body", [100, 50, 20], 100_000, {
        min: [-50, -25, -9.75],
        max: [50, 25, 10.25],
      }),
      part("Wheel", [20, 20, 10], 3000),
    ];
    const changed = await build({ file: "stand.py" });
    const still = await build({ file: "stand.py" });
    const written = await build({
      file: "stand.py",
      exports: [{ path: "out/body.stl", parts: ["Body"] }],
    });
    const after = await build({ file: "stand.py" });

    expect(changed).toContain(
      "out/body.stl was written by an earlier build; Body has changed since.",
    );
    expect(changed).not.toContain("out/wheel.stl was written");
    expect(still).toContain(
      "out/body.stl was written by an earlier build; Body has changed since.",
    );
    expect(written).not.toContain("was written by an earlier build");
    expect(after).not.toContain("was written by an earlier build");
  });

  it("says nothing of a file changed or moved away since a build wrote it, or written by another script", async () => {
    const { root, answering, build } = await studio();
    await writeFile(join(root, "other.py"), "show(Box(2, 2, 2))\n");
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    await build({
      file: "stand.py",
      exports: [
        { path: "out/body.stl", parts: ["Body"] },
        { path: "out/edited.stl", parts: ["Body"] },
        { path: "out/moved.stl", parts: ["Body"] },
      ],
    });
    await build({
      file: "other.py",
      exports: [{ path: "out/other.stl", parts: ["Body"] }],
    });
    await writeFile(join(root, "out", "edited.stl"), "the person's own");
    await rename(join(root, "out", "moved.stl"), join(root, "moved.stl"));
    answering.parts = [part("Body", [100, 50, 40], 200_000)];
    const changed = await build({ file: "stand.py" });

    expect(changed).toContain(
      "out/body.stl was written by an earlier build; Body has changed since.",
    );
    expect(changed).not.toContain("out/edited.stl");
    expect(changed).not.toContain("out/moved.stl");
    expect(changed).not.toContain("out/other.stl");
  });
});

describe("a requirements file that cannot be read", () => {
  const unreadable = JSON.stringify({
    requirements: [{ id: "R2", check: "hole", part: "Bracket", diameter: 6 }],
  });

  it("builds all the same, and says why no requirement was checked", async () => {
    const { root, answering, build, shown } = await studio();
    await writeFile(join(root, "requirements.json"), unreadable);
    answering.parts = [part("Block", [10, 10, 10], 1000)];

    const answer = await build({ file: "stand.py" });

    expect(answer).toContain("Block");
    expect(answer).toContain(
      "No requirement was checked: requirements.json: R2: a hole check needs tolerance. Fix the file, and the next build checks it.",
    );
    expect((await shown({ file: "stand.py" }))[0]).toEqual({
      kind: "checks",
      label: "Requirements in requirements.json",
      items: [
        {
          label: "requirements.json",
          holds: null,
          note: "requirements.json: R2: a hole check needs tolerance.",
        },
      ],
    });
  });

  it("builds all the same when the call names it", async () => {
    const { root, answering, build } = await studio();
    await writeFile(join(root, "needs.json"), unreadable);
    answering.parts = [part("Block", [10, 10, 10], 1000)];

    const answer = await build({
      file: "stand.py",
      requirements: "needs.json",
    });

    expect(answer).toContain(
      "No requirement was checked: needs.json: R2: a hole check needs tolerance.",
    );
  });
});

describe("margins", () => {
  it("move only between builds of the same script", async () => {
    const { root, answering, build } = await studio();
    await writeFile(join(root, "block.py"), "show(Box(1, 1, 1))\n");
    await writeFile(
      join(root, "requirements.json"),
      JSON.stringify({
        requirements: [
          {
            id: "R1",
            says: "Fits a 120 mm box",
            check: "fits",
            box: [120, 120, 120],
          },
        ],
      }),
    );
    answering.parts = [part("Bracket", [80, 40, 20], 10_000)];
    answering.requirement = () => ({ margin: 40 });
    await build({ file: "stand.py" });
    answering.parts = [part("Block", [10, 10, 10], 1000)];
    answering.requirement = () => ({ margin: 110 });
    const other = await build({ file: "block.py" });
    answering.parts = [part("Bracket", [70, 40, 20], 9_000)];
    answering.requirement = () => ({ margin: 50 });
    const again = await build({ file: "stand.py" });

    // The same design built with other arguments.
    answering.requirement = () => ({ margin: 45 });
    const thinner = await build({ file: "stand.py", arguments: ["4"] });

    expect(thinner).toContain(
      "its margin down from 50 to 45 mm since the last build",
    );
    expect(other).not.toContain("since the last build");
    expect(again).toContain(
      "its margin up from 40 to 50 mm since the last build",
    );
  });
});

describe("requirements that left the file", () => {
  it("names once a requirement that failed in the last build checked against the file and is no longer in it", async () => {
    const { root, answering, build } = await studio();
    const requirements = (ids: string[]) =>
      writeFile(
        join(root, "requirements.json"),
        JSON.stringify({
          requirements: [
            { id: "R1", check: "fits", box: [200, 200, 200] },
            {
              id: "R3",
              says: "No wall under 1.2 mm",
              check: "wall",
              part: "Body",
              min: 1.2,
            },
            { id: "R4", check: "wall", part: "Body", min: 0.5 },
          ].filter((one) => ids.includes(one.id)),
        }),
      );
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    answering.requirement = (one) =>
      one.id === "R3" ? { holds: false, margin: -1.09 } : {};
    await requirements(["R1", "R3", "R4"]);
    await build({ file: "stand.py" });
    await requirements(["R1"]);
    const dropped = await build({ file: "stand.py" });
    const later = await build({ file: "stand.py" });

    expect(dropped).toContain(
      "R3 (No wall under 1.2 mm) failed in the last build, 1.09 mm past its limit, and is no longer in requirements.json.",
    );
    // One that held is gone without a word.
    expect(dropped).not.toContain("R4");
    expect(later).not.toContain("R3");
  });
});

describe("the requirements as the person is shown them", () => {
  it("shows each requirement as holding, failing or not checked, with what was measured, beside the studio's answer", async () => {
    const { root, answering, shown } = await studio();
    await writeFile(
      join(root, "requirements.json"),
      JSON.stringify({
        requirements: [
          {
            id: "R1",
            says: "Fits a 200 mm cube",
            check: "fits",
            box: [200, 200, 200],
          },
          { id: "R2", check: "wall", part: "Body", min: 1.2 },
          { id: "R3", check: "wall", part: "Lid", min: 1.2 },
        ],
      }),
    );
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    answering.requirement = (one) =>
      one.id === "R2"
        ? { holds: false, measured: "thinnest wall 0.8 mm", margin: -0.4 }
        : one.id === "R3"
          ? { holds: null, why: "no part is named Lid" }
          : { measured: "100 × 50 × 20 mm" };

    const details = await shown({ file: "stand.py" });

    expect(details[0]).toEqual({
      kind: "checks",
      label: "Requirements in requirements.json",
      items: [
        {
          label: "R1 · Fits a 200 mm cube",
          holds: true,
          note: "100 × 50 × 20 mm; 1 mm to spare",
        },
        {
          label: "R2",
          holds: false,
          note: "thinnest wall 0.8 mm; 0.4 mm past the limit",
        },
        { label: "R3", holds: null, note: "no part is named Lid" },
      ],
    });
    expect(details[1]).toMatchObject({
      kind: "text",
      label: "The CAD studio's answer",
    });
  });

  it("says, under the list, a requirement that failed in the last build and is no longer in the file", async () => {
    const { root, answering, shown } = await studio();
    const requirements = (ids: string[]) =>
      writeFile(
        join(root, "requirements.json"),
        JSON.stringify({
          requirements: [
            { id: "R1", check: "fits", box: [200, 200, 200] },
            {
              id: "R3",
              says: "No wall under 1.2 mm",
              check: "wall",
              part: "Body",
              min: 1.2,
            },
          ].filter((one) => ids.includes(one.id)),
        }),
      );
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    answering.requirement = (one) =>
      one.id === "R3" ? { holds: false, margin: -1.09 } : {};
    await requirements(["R1", "R3"]);
    await shown({ file: "stand.py" });
    await requirements(["R1"]);

    const details = await shown({ file: "stand.py" });

    expect(details[0]).toMatchObject({
      kind: "checks",
      items: [{ label: "R1", holds: true }],
      note: "R3 (No wall under 1.2 mm) failed in the last build, 1.09 mm past its limit, and is no longer in requirements.json.",
    });
  });

  it("shows no requirements list for a build with no requirements file", async () => {
    const { answering, shown } = await studio();
    answering.parts = [part("Body", [100, 50, 20], 100_000)];

    const details = await shown({ file: "stand.py" });

    expect(details.map((one) => one.kind)).toEqual(["text"]);
  });
});

describe("what the harness says of a build's own steps", () => {
  it("says how many objects a part meant to print prints as, after the file that holds it", async () => {
    const { answering, build } = await studio();
    answering.parts = [part("Body", [100, 50, 20], 100_000, { solids: 3 })];
    answering.exportMore = {
      mesh: { for: "printing", within: 0.02 },
      objects: { Body: { solids: 3, objects: 3 } },
    };
    const text = await build({
      file: "stand.py",
      exports: [{ path: "out/body.stl", parts: ["Body"] }],
    });

    expect(text).toContain(
      "Wrote out/body.stl (1 KB), meshed for printing, no facet more than 0.02 mm from the surface: Body. Body is 3 solids; they print as 3 separate objects.",
    );
  });

  it("says how many triangles a file for printing holds and whether its mesh closes", async () => {
    const { answering, build } = await studio();
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    answering.exportMore = {
      mesh: { for: "printing", within: 0.02, triangles: 12_408, open: 0 },
    };
    const closed = await build({
      file: "stand.py",
      exports: [{ path: "out/body.stl", parts: ["Body"] }],
    });
    answering.exportMore = {
      mesh: { for: "printing", within: 0.02, triangles: 96, open: 3 },
    };
    const open = await build({
      file: "stand.py",
      exports: [{ path: "out/body.3mf", parts: ["Body"] }],
    });

    expect(closed).toContain(
      "Wrote out/body.stl (1 KB), meshed for printing, no facet more than 0.02 mm from the surface, 12,408 triangles, closed: Body.",
    );
    expect(open).toContain(
      "no facet more than 0.02 mm from the surface, 96 triangles, 3 edges open, which a slicer may refuse or close wrongly: Body.",
    );
  });

  it("says what the checks for the way each part is made found, and the parts left unchecked for want of time", async () => {
    const { answering, build } = await studio();
    answering.parts = [
      part("Housing", [100, 50, 20], 30_000),
      part("Plate", [60, 40, 20], 40_000),
    ];
    answering.more = {
      making: [
        "Housing, moulded (cast()) along +Z: 1 face, 200 mm², trapped where the mould leaving along the pull meets the part again, against none allowed: 200 mm² at (3.33, 3.33, 4), a side action along +X frees it.",
      ],
      makingUnchecked: ["Plate"],
    };
    const text = await build({ file: "stand.py" });

    expect(text).toContain(
      "Housing, moulded (cast()) along +Z: 1 face, 200 mm², trapped where the mould leaving along the pull meets the part again, against none allowed: 200 mm² at (3.33, 3.33, 4), a side action along +X frees it.",
    );
    expect(text).toContain(
      "Not checked in full for the way it is made, for want of time: Plate. Build it alone, or with more minutes, to check.",
    );
  });

  it("says each join or cut the script made with a shape of no volume", async () => {
    const { answering, build } = await studio();
    answering.parts = [part("Body", [100, 50, 20], 100_000)];
    answering.more = {
      empty: [
        "At line 7 of stand.py: a join with a shape of no volume, 40 × 0 × 12 mm about (0, 0, 24), adds nothing; the step that made that shape came out flat or empty.",
      ],
    };
    const text = await build({ file: "stand.py" });

    expect(text).toContain(
      "At line 7 of stand.py: a join with a shape of no volume, 40 × 0 × 12 mm about (0, 0, 24), adds nothing; the step that made that shape came out flat or empty.",
    );
  });

  it("says in its first line that cuts were skipped, so the parts are not what the script writes", async () => {
    const { answering, build } = await studio();
    answering.parts = [part("Plate", [100, 60, 10], 60_000)];
    answering.more = {
      skipped: [
        "At line 5 of stand.py: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 200 × 200 × 200 mm about (0, 0, 0): it would leave nothing of the part, so the part was kept as it was before it.",
        "At line 6 of stand.py: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 10 × 10 × 20 mm about (30, 0, 0): its cutter is turned inside out, so it would take away all of the part but where the cutter is, so the part was kept as it was before it.",
      ],
    };
    const text = await build({ file: "stand.py" });

    expect(text.split("\n")[0]).toBe(
      "Built 1 part in 1.0 s, with 2 of the script's cuts skipped, as each would break the part it cuts: the parts below are not what the script writes until those cuts change.",
    );
  });

  it("says in its first line that a cut was skipped when the script showed no part", async () => {
    const { answering, build } = await studio();
    answering.parts = [];
    answering.more = {
      skipped: [
        "At line 5 of stand.py: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 200 × 200 × 200 mm about (0, 0, 0): it would leave nothing of the part, so the part was kept as it was before it.",
      ],
    };
    const text = await build({ file: "stand.py" });

    expect(text.split("\n")[0]).toBe(
      "The script ran in 1.0 s and showed no part, so nothing was measured or drawn. 1 of the script's cuts was skipped, as it would break the part it cuts.",
    );
  });
});

describe("a design handed to its reviewer", () => {
  it("is its requirements as first written, what was removed since, the latest measures and the last build's answer", async () => {
    const { root, answering, build, directory } = await studio();
    const fits = {
      id: "R1",
      says: "Fits a 120 mm box",
      check: "fits",
      box: [120, 120, 120],
    };
    const wall = { id: "R2", check: "wall", part: "Bracket", min: 2 };
    const before = new Date(Date.now() - 1000);
    await writeFile(
      join(root, "requirements.json"),
      JSON.stringify({ requirements: [fits, wall] }),
    );
    answering.parts = [part("Bracket", [80, 40, 20], 10_000)];
    answering.requirement = (one) =>
      one.id === "R2" ? { holds: false, margin: -0.5 } : {};
    await build({ file: "stand.py" });
    // The failing wall requirement is dropped, and the part built again.
    await writeFile(
      join(root, "requirements.json"),
      JSON.stringify({ requirements: [fits] }),
    );
    answering.requirement = () => ({ margin: 40 });
    const answer = await build({ file: "stand.py" });

    const reviews = new PartReviews(() => directory);
    const [material, ...more] = await reviews.changedSince(
      "conversation",
      before,
      true,
    );

    expect(more).toEqual([]);
    expect(material).toMatchObject({
      reviewer: "3d-rendering/part-reviewer",
      subject: "the parts built by stand.py",
      pictures: [],
    });
    expect(material?.brief).toContain(
      [
        "## Requirements in requirements.json",
        "",
        "Each requirement as first written in this conversation, with its latest measure:",
        '- R1 (fits), holds, 40 mm to spare: "Fits a 120 mm box" {"box":[120,120,120]}',
        '- R2 (wall), removed since: {"part":"Bracket","min":2}',
      ].join("\n"),
    );
    expect(material?.brief).toContain(
      `## The last build, as the studio answered it\n\n${answer}`,
    );
    expect(
      await reviews.changedSince(
        "conversation",
        new Date(Date.now() + 1000),
        true,
      ),
    ).toEqual([]);
    // Whether a review will come is read from the same record.
    expect(await reviews.hasChangedSince("conversation", before)).toBe(true);
    expect(
      await reviews.hasChangedSince(
        "conversation",
        new Date(Date.now() + 1000),
      ),
    ).toBe(false);
  });

  it("is one design however many requirements files it was built against, each file's requirements listed, with the last build's answer", async () => {
    const { root, answering, build, directory } = await studio();
    const before = new Date(Date.now() - 1000);
    await writeFile(
      join(root, "requirements.json"),
      JSON.stringify({
        requirements: [{ id: "R1", check: "wall", part: "Box", min: 2 }],
      }),
    );
    await writeFile(
      join(root, "closed.json"),
      JSON.stringify({
        requirements: [{ id: "C1", check: "fits", box: [90, 70, 50] }],
      }),
    );
    answering.parts = [part("Box", [80, 60, 40], 20_000)];
    await build({ file: "stand.py" });
    const last = await build({ file: "stand.py", requirements: "closed.json" });

    const material = await new PartReviews(() => directory).changedSince(
      "conversation",
      before,
      true,
    );

    expect(material).toHaveLength(1);
    expect(material[0]?.subject).toBe("the parts built by stand.py");
    expect(material[0]?.brief).toContain(
      "## Requirements in requirements.json",
    );
    expect(material[0]?.brief).toContain("- R1 (wall), holds");
    expect(material[0]?.brief).toContain("## Requirements in closed.json");
    expect(material[0]?.brief).toContain("- C1 (fits), holds");
    expect(material[0]?.brief).toContain(
      `## The last build, as the studio answered it\n\n${last}`,
    );
  });

  describe("among the scripts built against one requirements file", () => {
    const ids = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"];
    const wall = (id: string) => ({ id, check: "wall", part: "Body", min: 2 });
    const notShown = { holds: null, why: "Body is not shown in this build." };
    const line = (id: string, verdict: string) =>
      `- ${id} (wall), ${verdict}: {"part":"Body","min":2}`;

    async function designs() {
      const made = await studio();
      await writeFile(
        join(made.root, "requirements.json"),
        JSON.stringify({ requirements: ids.map(wall) }),
      );
      await writeFile(join(made.root, "diag.py"), "show(Box(1, 1, 1))\n");
      made.answering.parts = [part("Body", [80, 40, 20], 10_000)];
      return made;
    }

    it("leaves out a script whose measures a later build of another has replaced", async () => {
      const { answering, build, directory } = await designs();
      const before = new Date(Date.now() - 1000);
      // diag.py measures only R9, with a fault the design has since lost.
      answering.requirement = (one) =>
        one.id === "R9" ? { holds: false, margin: -1 } : notShown;
      await build({ file: "diag.py" });
      answering.requirement = () => ({ margin: 2 });
      const last = await build({ file: "stand.py" });

      const material = await new PartReviews(() => directory).changedSince(
        "conversation",
        before,
        true,
      );

      expect(material.map((one) => one.subject)).toEqual([
        "the parts built by stand.py",
      ]);
      for (const id of ids)
        expect(material[0]?.brief).toContain(line(id, "holds, 2 mm to spare"));
      expect(material[0]?.brief).toContain(
        `## The last build, as the studio answered it\n\n${last}`,
      );
    });

    it("reviews a later script only for the requirements it measured last, and the design for the rest", async () => {
      const { answering, build, directory } = await designs();
      const before = new Date(Date.now() - 1000);
      answering.requirement = (one) =>
        one.id === "R9" ? { holds: false, margin: -1 } : { margin: 2 };
      await build({ file: "stand.py" });
      answering.requirement = (one) =>
        one.id === "R9" ? { margin: 3 } : notShown;
      const diagnosis = await build({ file: "diag.py" });

      const material = await new PartReviews(() => directory).changedSince(
        "conversation",
        before,
        true,
      );
      const stand = material.find(
        (one) => one.subject === "the parts built by stand.py",
      );
      const diag = material.find(
        (one) => one.subject === "the parts built by diag.py",
      );

      expect(material).toHaveLength(2);
      for (const id of ids.slice(0, 8))
        expect(stand?.brief).toContain(line(id, "holds, 2 mm to spare"));
      expect(stand?.brief).not.toContain("- R9 (wall)");
      expect(diag?.brief).toContain(line("R9", "holds, 3 mm to spare"));
      for (const id of ids.slice(0, 8))
        expect(diag?.brief).not.toContain(`- ${id} (wall)`);
      expect(diag?.brief).toContain(
        `## The last build, as the studio answered it\n\n${diagnosis}`,
      );
    });

    it("leaves out a script that measured none of them", async () => {
      const { answering, build, directory } = await designs();
      const before = new Date(Date.now() - 1000);
      answering.requirement = () => ({ margin: 2 });
      await build({ file: "stand.py" });
      answering.requirement = () => notShown;
      await build({ file: "diag.py" });

      const material = await new PartReviews(() => directory).changedSince(
        "conversation",
        before,
        true,
      );

      expect(material.map((one) => one.subject)).toEqual([
        "the parts built by stand.py",
      ]);
      expect(material[0]?.brief).toContain(line("R1", "holds, 2 mm to spare"));
    });

    it("gives a requirement no build measured to the script that measured most, and judges each by the file as first written", async () => {
      const { root, answering, build, directory } = await designs();
      const before = new Date(Date.now() - 1000);
      answering.requirement = (one) =>
        one.id === "R9" ? { holds: null, why: "the kernel refused" } : {};
      await build({ file: "stand.py" });
      // R1 is tightened after the first build, before diag.py first measures it.
      await writeFile(
        join(root, "requirements.json"),
        JSON.stringify({
          requirements: ids.map((id) =>
            id === "R1" ? { ...wall(id), min: 3 } : wall(id),
          ),
        }),
      );
      answering.requirement = (one) =>
        one.id === "R1" ? { margin: 4 } : notShown;
      await build({ file: "diag.py" });

      const material = await new PartReviews(() => directory).changedSince(
        "conversation",
        before,
        true,
      );
      const stand = material.find(
        (one) => one.subject === "the parts built by stand.py",
      );
      const diag = material.find(
        (one) => one.subject === "the parts built by diag.py",
      );

      expect(stand?.brief).toContain(line("R9", "could not be measured"));
      expect(diag?.brief).not.toContain("- R9 (wall)");
      expect(diag?.brief).toContain(line("R1", "holds, 4 mm to spare"));
      expect(diag?.brief).toContain(
        [
          "Changed since first written; judge the work by the first:",
          '- R1 now reads {"part":"Body","min":3}',
        ].join("\n"),
      );
    });
  });
});
