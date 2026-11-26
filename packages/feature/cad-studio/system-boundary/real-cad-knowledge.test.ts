/**
 * The CAD studio's knowledge against the real library: build123d's and
 * bd_warehouse's reference read in the CAD environment and kept, and each
 * known API change, whose old form gives the error or warning its pattern
 * matches, answered with a form that runs; each CadQuery habit and kernel
 * failure, met with what fixes it; and the names only a later release has,
 * absent here and answered with what this one has. Skipped unless the CAD
 * environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-knowledge.test.ts
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogIndex } from "@zhiyin/catalog-search";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadBreaks } from "../src/api-breaks.js";
import { laterNames } from "../src/later-names.js";
import { cadQueryHabits, kernelErrors } from "../src/script-habits.js";
import { cadAutomation, cadKnowledge, type CadPython } from "../src/index.js";
import { pageOf, referenceOf } from "../src/library-versions.js";
import { plainWords } from "../src/library-words.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const folders = new TemporaryFolders();
const block = 'show(Box(10, 10, 10), name="Block")';

/** Each change's old form and a form that works, as lines of a script. */
const forms: Record<string, { wrong: string; right: string }> = {
  add: {
    wrong: "with BuildPart() as made:\n    add(Box(10, 10, 10))",
    right: "with BuildPart() as made:\n    insert(Box(10, 10, 10))",
  },
  to_tuple: {
    wrong: "print(Vector(1, 2, 3).to_tuple())",
    right: "print(tuple(Vector(1, 2, 3)), tuple(Vertex(1, 2, 3)))",
  },
  to_wire: {
    wrong: "Edge.make_line((0, 0), (10, 0)).to_wire()",
    right: "Wire(Edge.make_line((0, 0), (10, 0)))",
  },
  to_axis: {
    wrong: "Edge.make_line((0, 0), (10, 0)).to_axis()",
    right: "Axis(Edge.make_line((0, 0), (10, 0))), Axis(Location((1, 2, 3)))",
  },
  to_plane: { wrong: "Axis.Z.to_plane()", right: "Plane(Axis.Z)" },
  make_plane: { wrong: "Face.make_plane(Plane.XY)", right: "Face(Plane.XY)" },
  relocate: {
    wrong: "Box(10, 10, 10).relocate(Location((5, 0, 0)))",
    right:
      "Box(10, 10, 10).moved(Location((5, 0, 0))).located(Location((5, 0, 0)))",
  },
  is_planar_face: {
    wrong: "Box(10, 10, 10).faces()[0].is_planar_face",
    right: "assert Box(10, 10, 10).faces()[0].is_planar",
  },
  planar: {
    wrong: "Edge.make_line((0, 0), (10, 0)).location_at(0.5, planar=True)",
    right: "Edge.make_line((0, 0), (10, 0)).location_at(0.5, x_dir=(0, 0, 1))",
  },
  is_inside: {
    wrong: "Box(1, 1, 1).bounding_box().is_inside(Box(2, 2, 2).bounding_box())",
    right:
      "assert Box(1, 1, 1).bounding_box().within(Box(2, 2, 2).bounding_box())\nassert Box(2, 2, 2).bounding_box().contains(Box(1, 1, 1).bounding_box())",
  },
  new_edges: {
    wrong: "with BuildPart() as made:\n    Box(10, 10, 10)\n    made.new_edges",
    right:
      "with BuildPart() as made:\n    Box(10, 10, 10)\n    made.edges(Select.NEW)",
  },
  "tangent-objects": {
    wrong: "PointArcTangentLine((10, 0), CenterArc((0, 0), 2, 0, 360))",
    right:
      "ConstrainedLines(CenterArc((0, 0), 2, 0, 360), (10, 0), selector=lambda found: found[0])\nConstrainedArcs(CenterArc((-5, 0), 4, 0, 360), CenterArc((5, 0), 3, 0, 360), radius=10, selector=lambda found: found[0])",
  },
  end_angle: {
    wrong:
      "with BuildLine():\n    EllipticalCenterArc((0, 0), 20, 10, start_angle=0, end_angle=90)",
    right:
      "with BuildLine():\n    EllipticalCenterArc((0, 0), 20, 10, start_angle=0, arc_size=90)",
  },
  workplane: {
    wrong: "with BuildLine(workplane=Plane.XZ):\n    Line((0, 0), (10, 0))",
    right: "with BuildLine(Plane.XZ):\n    Line((0, 0), (10, 0))",
  },
};

/** A script failing with each habit's and kernel error's own error. */
const failing: Record<string, string> = {
  workplane: 'cq.Workplane("XY").box(10, 10, 10)',
  "string-selectors": 'Box(10, 10, 10).faces(">Z")',
  centered: "Box(10, 10, 10, centered=False)",
  diameter: "with BuildPart():\n    Box(10, 10, 10)\n    Hole(diameter=3)",
  hole: "Box(10, 10, 10).hole(3)",
  shell: "Box(10, 10, 10).shell(-1)",
  translate: "Box(10, 10, 10).rotate((0, 0, 0), (0, 0, 1), 90)",
  "lowercase-axes": "Rot(z=90)",
  "chain-methods": "Box(10, 10, 10).cutBlind(-2)",
  "list-fillet": "Box(10, 10, 10).edges().fillet(1)",
  "face-extrude": "Box(10, 10, 10).faces().sort_by(Axis.Z)[-1].extrude(2)",
  assembly: "Assembly()",
  exporters: 'exporters.export(Box(1, 1, 1), "x.step")',
  fillet:
    "with BuildPart() as made:\n    Box(10, 10, 10)\n    fillet(made.edges(), radius=6)",
  chamfer:
    "with BuildPart() as made:\n    Box(10, 10, 10)\n    chamfer(made.edges(), length=6)",
  revolve:
    "with BuildPart():\n    with BuildSketch(Plane.XZ):\n        Rectangle(10, 10)\n    revolve(axis=Axis.Z)",
  offset: "with BuildPart():\n    Box(20, 20, 20)\n    offset(amount=-11)",
  kernel:
    "from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox\nBRepPrimAPI_MakeBox(0.0, 0.0, 0.0).Shape()",
};

describe.skipIf(!python)(
  "the CAD studio's knowledge, with a real build123d",
  () => {
    let real: CadPython;
    let runs = 0;
    let counted: CadPython;
    let data: string;
    let root: string;
    let build: (code: string) => Promise<Result>;
    let lookUp: (args: Record<string, unknown>) => Promise<Result>;

    beforeAll(async () => {
      real = await confinedPython();
      counted = {
        state: () => real.state(),
        run: (request) => {
          runs += 1;
          return real.run(request);
        },
      };
      data = await folders.make("zhiyin-real-cad-knowledge-data-");
      root = await folders.make("zhiyin-real-cad-knowledge-workspace-");
      const tools = cadAutomation(real, {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
      });
      build = async (code) => {
        const args = { code: `from build123d import *\n${code}` };
        const asked = await tools.inspect("cad_build", args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          "cad_build",
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
      lookUp = async (args) => {
        const asked = await tools.inspect("cad_api", args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          "cad_api",
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
    }, 30_000);

    afterAll(() => folders.removeAll());

    it("reads the installed library's reference once, keeps it, and its pages hold the library's own members", async () => {
      const knowledge = cadKnowledge(counted, {
        harness,
        directory: join(data, "knowledge"),
      });

      const face = await knowledge.page(pageOf("build123d", "Face"));
      const box = await knowledge.page(pageOf("build123d", "BoundBox"));
      const screw = await knowledge.page(
        pageOf("bd_warehouse", "fastener.SocketHeadCapScrew"),
      );

      expect(face?.text).toContain("- is_planar (property)");
      expect(box?.text).toContain("- within(self, other: 'BoundBox'");
      expect(screw?.text).toContain("fastener_type");
      // What a part class takes from a class with its own page is named there.
      expect((await knowledge.page(pageOf("build123d", "Box")))?.text).toMatch(
        /\nFrom build123d\.\w+, on its own page: .*\bfillet\b/,
      );
      expect(runs).toBe(1);

      // Read again by the next run of Zhiyin, from what was kept.
      const next = cadKnowledge(counted, {
        harness,
        directory: join(data, "knowledge"),
      });
      const ids = new Set((await next.entries()).map((entry) => entry.id));
      expect((await next.page(pageOf("build123d", "insert")))?.text).toContain(
        "build123d.insert(",
      );
      expect(runs).toBe(1);
      // Every page a known change sends the model to is there.
      for (const one of cadBreaks)
        for (const id of one.see) expect(ids, id).toContain(id);
    }, 180_000);

    it("finds the pages models asked cad_api for in past runs, by name and by what they wanted", async () => {
      const knowledge = cadKnowledge(real, {
        harness,
        directory: join(data, "knowledge"),
      });
      await knowledge.page(referenceOf("build123d"));
      const entries = await knowledge.entries();
      const index = catalogIndex(entries);
      const found = (query: string) =>
        index.find(query).map((match) => match.entry.id);
      const page = (name: string) => pageOf("build123d", name);

      // Every name given plain words has a page in the installed library.
      const ids = new Set(entries.map((entry) => entry.id));
      for (const [library, words] of Object.entries(plainWords))
        for (const name of Object.keys(words))
          expect(ids, `${library}.${name}`).toContain(
            pageOf(library as "build123d" | "bd_warehouse", name),
          );
      // A name asked for is its own page first, whatever shares its words.
      for (const name of [
        "Edge",
        "Wire",
        "Location",
        "Plane",
        "Text",
        "fillet",
      ])
        expect(found(name)[0], name).toBe(page(name));
      expect(found("Plane.offset")[0]).toBe(page("Plane"));
      // What a model wanted, in its own words, reaches the name that does it.
      expect(found("Check how to make digit solids for numbering")).toContain(
        page("Text"),
      );
      expect(found("round the edges of a part")).toContain(page("fillet"));
      expect(found("round_edges")).toContain(page("fillet"));
      expect(found("select circular edges on a part")).toEqual(
        expect.arrayContaining([page("GeomType")]),
      );
      expect(found("coil")).toContain(page("Helix"));
      expect(found("move")).toEqual(
        expect.arrayContaining([page("Location"), page("Pos")]),
      );
    }, 180_000);

    it.each(cadBreaks.map((one) => [one.id, one] as const))(
      "answers the old form of %s with the form that works",
      async (id, one) => {
        const answer = await build(`${forms[id]!.wrong}\n${block}`);

        expect(answer.content[0]?.text).toContain(
          `changed this: write ${one.right}, in place of ${one.wrong}.`,
        );
      },
      120_000,
    );

    it("answers an old form a workspace module the script imports uses", async () => {
      await writeFile(
        join(root, "plate.py"),
        "from build123d import *\n\ndef plate():\n    with BuildPart() as made:\n        add(Box(10, 10, 2))\n    return made.part\n",
      );

      const answer = await build(
        'import plate\nshow(plate.plate(), name="Plate")',
      );

      expect(answer.isError).toBeUndefined();
      expect(answer.content[0]?.text).toContain(
        "changed this: write insert(shape), in place of add(shape) in a builder.",
      );
    }, 120_000);

    it("builds every form that works, with no change said", async () => {
      const answer = await build(
        [...Object.values(forms).map((one) => one.right), block].join("\n"),
      );

      expect(answer.isError).toBeUndefined();
      expect(answer.content[0]?.text).not.toContain("changed this");
    }, 120_000);

    it("has a pair of forms for every known change", () => {
      expect(Object.keys(forms).sort()).toEqual(
        cadBreaks.map((one) => one.id).sort(),
      );
    });

    it.each(
      [...cadQueryHabits, ...kernelErrors].map((one) => [one.id, one] as const),
    )(
      "answers a script failing with %s with what fixes it",
      async (id, one) => {
        const answer = await build(`${failing[id]!}\n${block}`);

        expect(answer.isError).toBe(true);
        expect(answer.content[0]?.text).toContain(one.says);
      },
      120_000,
    );

    it("has a failing script for every habit and kernel error, and every page they name opens", async () => {
      const knowledge = cadKnowledge(real, {
        harness,
        directory: join(data, "knowledge"),
      });
      const hints = [...cadQueryHabits, ...kernelErrors];

      expect(Object.keys(failing).sort()).toEqual(
        hints.map((one) => one.id).sort(),
      );
      for (const id of hints.flatMap((one) => one.see ?? []))
        expect(await knowledge.page(id), id).toBeDefined();
    }, 180_000);

    it("fails a fillet or chamfer given edges of another shape saying so, not as a radius too large", async () => {
      const other = await build(
        "plate = Box(20, 20, 4)\nplate = plate.fillet(1, Box(20, 20, 4).edges().filter_by(Axis.Z))",
      );
      const moved = await build(
        "with BuildPart() as made:\n    Box(20, 20, 4)\n    edges = made.part.moved(Pos(5, 0, 0)).edges().filter_by(Axis.Z)\n    chamfer(edges, length=1)",
      );
      const tooLarge = await build(
        "with BuildPart() as made:\n    Box(20, 20, 4)\n    fillet(made.edges(), radius=3)",
      );

      expect(other.content[0]?.text).toContain(
        "ValueError: fillet was given 4 edges, 4 of them not edges of the shape it works on: an edge of another shape, or of this one before a move or an operation remade it. Take the edges from the shape as it is at that step, as made.edges() in its BuildPart or part.edges().",
      );
      expect(moved.content[0]?.text).toContain(
        "ValueError: chamfer was given 4 edges, 4 of them not edges of the shape it works on",
      );
      expect(tooLarge.content[0]?.text).toContain(
        "ValueError: Failed creating a fillet with radius of 3",
      );
    }, 120_000);

    it("lacks every name a later release has, and answers each with what it has instead, in its place among other names", async () => {
      const absent = await build(
        `import build123d, bd_warehouse.gear\nprint("present:", [n for n in ${JSON.stringify(
          laterNames
            .filter((one) => one.library === "build123d")
            .flatMap((one) => one.names),
        )} if hasattr(build123d, n) or hasattr(build123d.ShapeList, n)] + [n for n in ${JSON.stringify(
          laterNames
            .filter((one) => one.library === "bd_warehouse")
            .flatMap((one) => one.names),
        )} if hasattr(bd_warehouse.gear, n)])\n${block}`,
      );
      const answer = await lookUp({
        names: ["extrude", "BuildSheet", "bd_warehouse.flange", "SlotCurve"],
      });
      const parts = answer.content[0]?.text?.split("\n\n") ?? [];

      expect(absent.content[0]?.text).toContain("present: []");
      expect(answer.isError).toBeUndefined();
      expect(parts[0]).toMatch(/^build123d\.extrude\(/);
      const sheet = parts.findIndex((one) =>
        one.startsWith("BuildSheet is not in build123d"),
      );
      const flange = parts.findIndex((one) =>
        one.startsWith("bd_warehouse.flange"),
      );
      const slot = parts.findIndex((one) =>
        one.startsWith("SlotCurve is not in build123d"),
      );
      expect(sheet).toBeGreaterThan(0);
      expect(flange).toBeGreaterThan(sheet);
      expect(slot).toBeGreaterThan(flange);
      expect(parts[sheet]).toContain("sheet(outline, thickness, bends)");
    }, 120_000);
  },
);
