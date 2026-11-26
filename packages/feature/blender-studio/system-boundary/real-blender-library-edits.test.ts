/**
 * The zhiyin library's topology edits, against a real Blender: extrude, inset,
 * bevel, bridge, fill, loop cut, merge and symmetrize each act on what a pick
 * took, then say in one measured line what changed, and refuse what they
 * cannot do as asked.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "../src/index.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

/** A mesh object named `name`, made fresh from the bmesh `shape` the lines before build. */
const made = (name: string, lines: string[], at = "(0, 0, 0)") => [
  "import bmesh, bpy",
  `old = bpy.data.objects.get('${name}')`,
  "if old: bpy.data.objects.remove(old)",
  "shape = bmesh.new()",
  ...lines,
  `mesh = bpy.data.meshes.new('${name}')`,
  "shape.to_mesh(mesh)",
  "shape.free()",
  `obj = bpy.data.objects.new('${name}', mesh)`,
  `obj.location = ${at}`,
  "bpy.context.scene.collection.objects.link(obj)",
];

/** A one-metre box standing on the floor: z from 0 to 1 m in the world. */
const box = made(
  "Box",
  ["bmesh.ops.create_cube(shape, size=1)"],
  "(0, 0, 0.5)",
);

/** The same box without its top face. */
const openBox = made(
  "Box",
  [
    "bmesh.ops.create_cube(shape, size=1)",
    "bmesh.ops.delete(shape, geom=[f for f in shape.faces if f.normal.z > 0.9], context='FACES_ONLY')",
  ],
  "(0, 0, 0.5)",
);

/** The one-metre box standing on the floor, each side cut into a grid of 5 × 5 faces 200 mm across. */
const gridBox = made(
  "Grid box",
  [
    "bmesh.ops.create_cube(shape, size=1)",
    "bmesh.ops.subdivide_edges(shape, edges=shape.edges[:], cuts=4, use_grid_fill=True)",
  ],
  "(0, 0, 0.5)",
);

/** A closed cylinder of 32 sides, a metre high and across, each cap one face. */
const can = made("Can", [
  "bmesh.ops.create_cone(shape, cap_ends=True, segments=32, radius1=0.5, radius2=0.5, depth=1)",
]);

/** A one-metre square face lying on the floor, centred on the origin. */
const plane = made("Plane", [
  "corners = [shape.verts.new(c) for c in ((-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0))]",
  "shape.faces.new(corners)",
]);

/** Two loops of loose edges, a circle of `below` points at z 0 and one of `above` at z 1 m. */
const rings = (below: number, above: number) =>
  made("Rings", [
    `bmesh.ops.create_circle(shape, segments=${below}, radius=0.5)`,
    `upper = bmesh.ops.create_circle(shape, segments=${above}, radius=0.5)`,
    "for v in upper['verts']: v.co.z += 1",
  ]);

/** Two discs of eight sides, one on the floor and one 1 m above it, each a face whose rim the surface runs on outward from. */
const discs = made("Discs", [
  "bmesh.ops.create_circle(shape, segments=8, radius=0.5, cap_ends=True)",
  "upper = bmesh.ops.create_circle(shape, segments=8, radius=0.5, cap_ends=True)",
  "for v in upper['verts']: v.co.z += 1",
]);

/** An open tube of twelve sides, a metre high, a hole at each end. */
const tube = made("Tube", [
  "bmesh.ops.create_cone(shape, cap_ends=False, segments=12, radius1=0.5, radius2=0.5, depth=1)",
]);

/** A circle of seven loose edges: a hole whose edges are odd in number. */
const heptagon = made("Odd", [
  "bmesh.ops.create_circle(shape, segments=7, radius=0.5)",
]);

/** The one-metre box with its top and +x faces turned to point into it. */
const turned = made(
  "Box",
  [
    "bmesh.ops.create_cube(shape, size=1)",
    "bmesh.ops.reverse_faces(shape, faces=[f for f in shape.faces if f.normal.z > 0.9 or f.normal.x > 0.9])",
  ],
  "(0, 0, 0.5)",
);

/** A circle of twelve loose edges, a hole with nothing around it. */
const disc = made("Disc", [
  "bmesh.ops.create_circle(shape, segments=12, radius=0.5)",
]);

/** Two one-metre boxes in the same place, in one mesh. */
const pair = made("Pair", [
  "bmesh.ops.create_cube(shape, size=1)",
  "bmesh.ops.create_cube(shape, size=1)",
]);

/** A one-metre box whose points lie from x = `low` to `low` + 1 m, about its own origin. */
const shifted = (low: number) =>
  made("Shifted", [
    "bmesh.ops.create_cube(shape, size=1)",
    `for v in shape.verts: v.co.x += ${low + 0.5}`,
  ]);

/** Prints the object's size in metres, as `size x, y, z`. */
const size =
  "bpy.context.view_layer.update(); print('size', ', '.join(f'{d:g}' for d in obj.dimensions))";

describe.runIf(blender)("the zhiyin library's edits in a real Blender", () => {
  const folders = new TemporaryFolders();
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const run = async (lines: string[]) => {
    const result = (await tools.callTool("blender_run_script", {
      code: lines.join("\n"),
    })) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-library-edits-");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: withKeptGlCache(containedSessionLaunch)(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("library-edits"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("library-edits"),
    });
    await tools.callTool("blender_open_scene", {
      path: "library-edits.blend",
      create: true,
    });
  });

  afterAll(async () => {
    await scenes.forget("library-edits");
    await scenes.closeAll();
    await folders.removeAll();
  });

  describe("extrude", () => {
    it("pushes a face out along its normal and says how far, which way and where the new face lies", async () => {
      const { failed, said } = await run([
        ...box,
        "top = zhiyin.extrude(zhiyin.pick(obj, facing='+z'), 0.2)",
        "print(top.kind, len(top))",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain("faces 1\n");
      expect(said).toContain(
        "- Extruded 1 face of Box 200 mm along its normal, +z: 6 → 10 faces, 12 → 20 edges, 8 → 12 points; the new face lies at x -500 mm to 500 mm, y -500 mm to 500 mm, z 1.2 m.",
      );
      expect(said).toContain("size 1, 1, 1.2\n");
    });

    it("extrudes an edge towards a direction given as three numbers", async () => {
      const { failed, said } = await run([
        ...plane,
        "edge = zhiyin.pick(obj, 'edges', inside=[[0.4, -1, -1], [1, 1, 1]])",
        "zhiyin.extrude(edge, [0.3, 0, 0])",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Extruded 1 edge of Plane 300 mm towards +x: 1 → 2 faces, 4 → 7 edges, 4 → 6 points; open edges 4 → 6; the new edge lies at x 800 mm, y -500 mm to 500 mm, z 0 mm.",
      );
      expect(said).toContain("size 1.3, 1, 0\n");
    });

    it("extrudes an open rim by a distance along its faces' normals, or onward past them", async () => {
      const { failed, said } = await run([
        ...openBox,
        "zhiyin.extrude(zhiyin.boundary(obj), 0.1)",
        ...openBox,
        "zhiyin.extrude(zhiyin.boundary(obj), 0.1, along='onward')",
      ]);

      expect(failed, said).toBe(false);
      // Out square to the walls, as Alt-S does: a flange 100 mm wide all round, corners included.
      expect(said).toContain(
        "- Extruded 4 edges of Box 100 mm along the normals of the faces beside them: 5 → 9 faces, 12 → 20 edges, 8 → 12 points; the new edges lie at x -600 mm to 600 mm, y -600 mm to 600 mm, z 1 m.",
      );
      // Onward, the walls carry on up.
      expect(said).toContain(
        "- Extruded 4 edges of Box 100 mm onward past the faces beside them: 5 → 9 faces, 12 → 20 edges, 8 → 12 points; the new edges lie at x -500 mm to 500 mm, y -500 mm to 500 mm, z 1.1 m.",
      );
    });

    it("refuses to extrude loose edges by a distance alone, since no face beside them gives a way to go", async () => {
      const { failed, said } = await run([
        ...disc,
        "zhiyin.extrude(zhiyin.pick(obj, 'edges'), 0.3)",
      ]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "Extruding edges by a distance follows the faces beside them, and 12 of the edges picked border none: give a direction as three numbers, such as by=[0, 0, 0.1].",
      );
    });
  });

  describe("inset", () => {
    it("insets a face, says the ring's width, and hands back the inner face for the next step", async () => {
      const { failed, said } = await run([
        ...box,
        "inner = zhiyin.inset(zhiyin.pick(obj, facing='+z'), 0.1)",
        "zhiyin.extrude(inner, -0.3)",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Inset 1 face of Box by 100 mm: 6 → 10 faces, 12 → 20 edges, 8 → 12 points; the ring is 100 mm wide.",
      );
      expect(said).toContain(
        "- Extruded 1 face of Box 300 mm against its normal, -z: 10 → 14 faces, 20 → 28 edges, 12 → 16 points; the new face lies at x -400 mm to 400 mm, y -400 mm to 400 mm, z 700 mm.",
      );
      expect(said).toContain("size 1, 1, 1\n");
    });

    it("refuses a pick already spent by an edit, since its faces are no longer where it says", async () => {
      const { failed, said } = await run([
        ...box,
        "top = zhiyin.pick(obj, facing='+z')",
        "zhiyin.inset(top, 0.1)",
        "zhiyin.inset(top, 0.1)",
      ]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "This pick of Box was spent by inset, which changed the mesh: use what inset returned, or pick again.",
      );
    });

    it("refuses an inset so wide it turns the ring inside out, saying how wide one can be", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.inset(zhiyin.pick(obj, facing='+z'), 0.6)",
      ]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "Insetting 1 face of Box by 600 mm turns its ring inside out. At most about 500 mm keeps every face.",
      );
    });
  });

  describe("bevel", () => {
    it("bevels an edge by the width asked", async () => {
      const { failed, said } = await run([
        ...box,
        "edge = zhiyin.pick(obj, 'edges', inside=[[0.4, -1, 0.9], [1, 1, 1.1]])",
        "zhiyin.bevel(edge, 0.1)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Bevelled 1 edge of Box 100 mm, 1 segment: 6 → 7 faces, 12 → 15 edges, 8 → 10 points; 1 face added.",
      );
    });

    it("bevels a rim of edges in segments", async () => {
      const { failed, said } = await run([
        ...box,
        "rim = zhiyin.pick(obj, 'edges', above=0.99)",
        "zhiyin.bevel(rim, 0.3, segments=2)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Bevelled 4 edges of Box 300 mm, 2 segments: 6 → 14 faces, 12 → 28 edges, 8 → 16 points; 8 faces added.",
      );
    });

    it("says when the width was clamped so faces do not overlap", async () => {
      const { failed, said } = await run([
        ...box,
        "edge = zhiyin.pick(obj, 'edges', inside=[[0.4, -1, 0.9], [1, 1, 1.1]])",
        "zhiyin.bevel(edge, 1.5)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Bevelled 1 edge of Box, asked 1.5 m, made 1 m (clamped so faces do not overlap), 1 segment:",
      );
    });

    it("refuses faces, saying to pick the edges to round", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.bevel(zhiyin.pick(obj, facing='+z'), 0.1)",
      ]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "bevel takes edges or points, and the pick holds faces: pick kind='edges' for the edges to round.",
      );
    });
  });

  describe("bridge", () => {
    it("bridges two closed loops into a tube, with cuts between", async () => {
      const { failed, said } = await run([
        ...rings(8, 8),
        "zhiyin.bridge(zhiyin.pick(obj, 'edges'), cuts=2)",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Bridged two closed loops of 8 edges on Rings with 24 faces, 2 cuts between: 0 → 24 faces, 16 → 56 edges, 16 → 32 points; open edges 0 → 16, loose edges 16 → 0; the edges between the loops run 1 m; its section is 923.9 mm by 923.9 mm where it leaves the loops, and is no narrower between them.",
      );
      expect(said).toContain("size 1, 1, 1\n");
    });

    it("says a bridge turned out of line, how many edges round, and the twist that brings it back", async () => {
      const { failed, said } = await run([
        ...rings(8, 8),
        "zhiyin.bridge(zhiyin.pick(obj, 'edges'), twist=2)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "the edges between the loops run 1.361 m, twisted 3 edges round: twist=0 makes them 1 m; its section is 923.9 mm by 923.9 mm where it leaves the loops.",
      );
    });

    it("bows a band the way the loops' own faces run on, and says how far", async () => {
      const { failed, said } = await run([
        ...discs,
        "zhiyin.bridge(zhiyin.pick(obj, 'edges'), cuts=3, smoothness=1)",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Bridged two closed loops of 8 edges on Discs with 32 faces, 3 cuts between, bowed by 1, up to 250 mm out of line: 2 → 34 faces, 16 → 72 edges, 16 → 40 points; open edges 16 → 0; the edges between the loops run 1 m; its section is 923.9 mm by 923.9 mm where it leaves the loops, and is no narrower between them.",
      );
      expect(said).toContain("size 1.5, 1.5, 1\n");
    });

    it("bridges two patches on one side into a handle that crosses nothing and keeps the surface facing out", async () => {
      const { failed, said } = await run([
        ...gridBox,
        "for z in (0.3, 0.7):",
        "    zhiyin.extrude(zhiyin.pick(obj, facing='+x', near=[[0.5, 0, z], 0.01]), 0.1)",
        "caps = zhiyin.pick(obj, facing='+x', inside=[[0.55, -1, 0], [1, 1, 1]])",
        "zhiyin.bridge(caps, cuts=4, smoothness=1)",
        "zhiyin.fix_normals(obj)",
      ]);

      expect(failed, said).toBe(false);
      const bridged =
        said.split("\n").find((line) => line.startsWith("- Bridged")) ?? "";
      expect(bridged).toContain(
        "Bridged two closed loops of 4 edges on Grid box, the rims of the 2 faces picked, which it removed, with 20 faces, 4 cuts between, bowed by 1",
      );
      expect(bridged).not.toContain("crossing");
      // Its side rails lie along one line; each row stays on its own rail.
      expect(bridged).not.toContain("faces with no area");
      // The outer rail is three times the inner one and bows three times as far,
      // so the band leaves each 200 mm cap square and is little more than half as
      // thick across its middle rows: a pinch the answer shows.
      expect(bridged).toMatch(
        /; its section is 200 mm by 200 mm where it leaves the loops and 200 mm by 11\d(\.\d+)? mm at its narrowest\.$/,
      );
      expect(said).toContain("- Turned no faces of Grid box");
    });

    it("refuses loops of different counts, saying the counts found", async () => {
      const { failed, said } = await run([
        ...rings(8, 6),
        "zhiyin.bridge(zhiyin.pick(obj, 'edges'))",
      ]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "Bridging takes two loops of the same number of edges; the pick holds loops of 8 and 6 edges.",
      );
    });
  });

  describe("delete", () => {
    it("deletes a face and says the hole it leaves, handing back its rim", async () => {
      const { failed, said } = await run([
        ...box,
        "rim = zhiyin.delete(zhiyin.pick(obj, facing='+z'))",
        "print(rim.kind, len(rim))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Deleted 1 face of Box: 6 → 5 faces, 12 → 12 edges, 8 → 8 points; open edges 0 → 4; it leaves 1 hole, of 4 edges.",
      );
      expect(said).toContain("edges 4\n");
    });

    it("deletes a point with the edges and faces that meet at it", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.delete(zhiyin.pick(obj, 'verts', near=[[0.5, 0.5, 1], 0.01]))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Deleted 1 point of Box: 6 → 3 faces, 12 → 9 edges, 8 → 7 points; open edges 0 → 6; it leaves 1 hole, of 6 edges.",
      );
    });

    it("fills a cylinder's cap with a grid of quads once the cap is deleted", async () => {
      const { failed, said } = await run([
        ...can,
        "rim = zhiyin.delete(zhiyin.pick(obj, facing='+z'))",
        "zhiyin.fill(rim, method='grid')",
        "print('ngons', sum(1 for p in obj.data.polygons if len(p.vertices) > 4))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain("it leaves 1 hole, of 32 edges.");
      expect(said).toContain(
        "- Filled 1 hole of Can with a 8 × 8 grid of 64 faces",
      );
      // The bottom cap is still the one n-gon.
      expect(said).toContain("ngons 1\n");
    });
  });

  describe("dissolve", () => {
    it("dissolves a patch of faces into one, naming the n-gon it leaves", async () => {
      const { failed, said } = await run([
        ...gridBox,
        "zhiyin.dissolve(zhiyin.pick(obj, facing='+x', inside=[[0.4, -0.31, 0.19], [0.6, 0.31, 0.81]]))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Dissolved 9 faces of Grid box: 150 → 142 faces, 300 → 288 edges, 152 → 148 points; it leaves 1 n-gon, of 12 sides.",
      );
    });

    it("dissolves a point, joining the faces round it into one", async () => {
      const { failed, said } = await run([
        ...gridBox,
        "zhiyin.dissolve(zhiyin.pick(obj, 'verts', near=[[0.5, 0.1, 0.4], 0.01]))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Dissolved 1 point of Grid box: 150 → 147 faces, 300 → 296 edges, 152 → 151 points; it leaves 1 n-gon, of 8 sides.",
      );
    });
  });

  describe("fill", () => {
    it("fills a mesh's hole with a face and says the open edges are gone and the poles at its corners", async () => {
      const { failed, said } = await run([...openBox, "zhiyin.fill(obj)"]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Filled 1 hole of Box with 1 face: 5 → 6 faces, 12 → 12 edges, 8 → 8 points; open edges 4 → 0; 4 poles where 3 edges meet.",
      );
    });

    it("caps a tube's ends with grids by default, saying the poles each grid leaves", async () => {
      const { failed, said } = await run([...tube, "zhiyin.fill(obj)"]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Filled 2 holes of Tube with 18 faces, in grids of 3 × 3 and 3 × 3: 12 → 30 faces, 36 → 60 edges, 24 → 32 points; open edges 24 → 0; 8 poles where 3 edges meet.",
      );
    });

    it("fans a tube's ends round a point at each middle, a pole of twelve edges each", async () => {
      const { failed, said } = await run([
        ...tube,
        "zhiyin.fill(obj, method='fan')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Filled 2 holes of Tube with fans of 24 triangles round a point at each middle: 12 → 36 faces, 36 → 60 edges, 24 → 26 points; open edges 24 → 0; 2 poles where 12 edges meet.",
      );
    });

    it("fills a hole of an odd number of edges with one face by default, saying why, and refuses a grid asked for", async () => {
      const left = await run([...heptagon, "zhiyin.fill(obj)"]);
      const asked = await run([...heptagon, "zhiyin.fill(obj, method='grid')"]);

      expect(left.failed, left.said).toBe(false);
      expect(left.said).toContain(
        "- Filled 1 hole of Odd with 1 face, as a grid takes an even number of edges, four or more, and it has 7:",
      );
      expect(asked.failed).toBe(true);
      expect(asked.said).toContain(
        "A grid fill takes holes of an even number of edges, four or more; this one has 7.",
      );
    });

    it("fills a loop with a grid of quads", async () => {
      const { failed, said } = await run([
        ...disc,
        "zhiyin.fill(zhiyin.pick(obj, 'edges'), method='grid')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Filled 1 hole of Disc with a 3 × 3 grid of 9 faces: 0 → 9 faces, 12 → 24 edges, 12 → 16 points; open edges 0 → 12, loose edges 12 → 0.",
      );
    });

    it("fills a loop with one face, naming the n-gon it made", async () => {
      const { failed, said } = await run([
        ...disc,
        "zhiyin.fill(obj, method='face')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Filled 1 hole of Disc with 1 face: 0 → 1 face, 12 → 12 edges, 12 → 12 points; open edges 0 → 12, loose edges 12 → 0; made 1 n-gon of 12 sides.",
      );
    });

    it("refuses a mesh with no hole", async () => {
      const { failed, said } = await run([...box, "zhiyin.fill(obj)"]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "Box has no hole to fill: every edge has two faces.",
      );
    });
  });

  describe("loop_cut", () => {
    it("cuts a loop across the ring of an edge and says where it lies", async () => {
      const { failed, said } = await run([
        ...box,
        "edge = zhiyin.pick(obj, 'edges', inside=[[0.4, 0.4, 0.1], [0.6, 0.6, 0.9]])",
        "cut = zhiyin.loop_cut(edge)",
        "print(cut.kind, len(cut))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain("edges 4\n");
      expect(said).toContain(
        "- Cut 1 loop across 4 edges of Box: 6 → 10 faces, 12 → 20 edges, 8 → 12 points; the new loop lies at x -500 mm to 500 mm, y -500 mm to 500 mm, z 500 mm.",
      );
    });

    it("slides a cut towards one end of the ring", async () => {
      const { failed, said } = await run([
        ...box,
        "edge = zhiyin.pick(obj, 'edges', inside=[[0.4, 0.4, 0.1], [0.6, 0.6, 0.9]])",
        "zhiyin.loop_cut(edge, cuts=2, slide=0.5)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Cut 2 loops across 4 edges of Box, slid 50% of a gap towards +z: 6 → 14 faces, 12 → 28 edges, 8 → 16 points; the new loops lie at x -500 mm to 500 mm, y -500 mm to 500 mm, z 500 mm to 833.3 mm.",
      );
    });

    it("refuses faces, saying to pick an edge to cut across", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.loop_cut(zhiyin.pick(obj, facing='+z'))",
      ]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "loop_cut takes edges, and the pick holds faces: pick kind='edges' for an edge the loop crosses.",
      );
    });
  });

  describe("merge", () => {
    it("merges points closer than a distance and says how many went", async () => {
      const { failed, said } = await run([...pair, "zhiyin.merge(obj)"]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Merged points of Pair closer than 0.1 mm: 8 removed; 12 → 6 faces, 24 → 12 edges, 16 → 8 points.",
      );
    });

    it("says nothing was merged, and how close the closest points are", async () => {
      const { failed, said } = await run([...box, "zhiyin.merge(obj)"]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Merged no points of Box: none are closer than 0.1 mm; the closest two are 1 m apart.",
      );
    });

    it("collapses a pick into one point at its centre", async () => {
      const { failed, said } = await run([
        ...box,
        "top = zhiyin.pick(obj, 'verts', above=0.9)",
        "zhiyin.merge(top, to='center')",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Merged 4 points of Box into one at (0, 0, 1 m): 6 → 5 faces, 12 → 8 edges, 8 → 5 points.",
      );
      expect(said).toContain("size 1, 1, 1\n");
    });
  });

  describe("symmetrize", () => {
    it("copies one half onto the other and says the seam is closed", async () => {
      const { failed, said } = await run([
        ...shifted(-0.2),
        "zhiyin.symmetrize(obj, axis='x', direction='+')",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Symmetrized Shifted across its own x = 0, copying its +x half onto -x: 6 → 10 faces, 12 → 20 edges, 8 → 12 points; the seam has no open edges.",
      );
      expect(said).toContain("size 1.6, 1, 1\n");
    });

    it("refuses when there is nothing on the side to copy", async () => {
      const { failed, said } = await run([
        ...shifted(0.1),
        "zhiyin.symmetrize(obj, axis='x', direction='-')",
      ]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "Shifted has nothing on the -x side of its own x = 0 to copy: its points lie at x 100 mm to 1.1 m.",
      );
    });
  });

  describe("fix_normals", () => {
    it("turns the faces pointing into a closed shape out again, and says when none are left", async () => {
      const { failed, said } = await run([
        ...turned,
        "flipped = zhiyin.fix_normals(obj)",
        "print(flipped.kind, len(flipped))",
        "zhiyin.fix_normals(obj)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain("faces 2\n");
      expect(said).toContain(
        "- Turned 2 faces of Box (1 piece, 1 closed): 2 faces that pointed into its closed piece, the largest at (500, 0, 500 mm); now every face faces its way.",
      );
      expect(said).toContain(
        "- Turned no faces of Box: each of its 6 faces already faces out of its closed piece or with the rest of its open one (1 piece, 1 closed).",
      );
    });
  });

  describe("imprint", () => {
    it("cuts an outline into the top it is pressed onto, and hands back the faces inside it", async () => {
      const { failed, said } = await run([
        ...box,
        "inner = zhiyin.imprint(obj, [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]])",
        "print(inner.kind, len(inner))",
        size,
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain("faces 1\n");
      expect(said).toContain(
        "- Imprinted an outline of 4 points onto Box along -z: 6 → 8 faces, 12 → 18 edges, 8 → 12 points; 1 face inside it, 1600 cm², at x -200 mm to 200 mm, y -200 mm to 200 mm, z 1 m; the cut left 2 more faces of more than four sides.",
      );
      expect(said).toContain("size 1, 1, 1\n");
    });

    it("sinks the outline when given a depth, the extrude saying where its floor lies", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.imprint(obj, [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]], depth=-0.05)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain("; sunk 50 mm, as the next line says.");
      expect(said).toContain(
        "- Extruded 1 face of Box 50 mm against its normal, -z: 8 → 12 faces, 18 → 26 edges, 12 → 16 points; the new face lies at x -200 mm to 200 mm, y -200 mm to 200 mm, z 950 mm.",
      );
    });

    it("raises lettering pressed onto a front, reading the right way seen from there", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.imprint(obj, text='ZY', height=0.3, direction='+y', depth=0.01)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /- Imprinted the text “ZY”, 300 mm high onto Box along \+y: .*; 2 faces inside it, [\d.]+ cm², at x -[\d.]+ mm to [\d.]+ mm, y -500 mm, z [\d.]+ mm to [\d.]+ mm;/,
      );
      expect(said).toMatch(
        /- Extruded 2 faces of Box 10 mm along their normals: .* the new faces lie at x -[\d.]+ mm to [\d.]+ mm, y -510 mm,/,
      );
    });

    it("follows a closed curve onto a round side", async () => {
      const { failed, said } = await run([
        ...made("Can", [
          "bmesh.ops.create_cone(shape, cap_ends=True, segments=32, radius1=0.5, radius2=0.5, depth=1)",
        ]),
        "import math",
        "zhiyin.curve('Ring', [[0.15 * math.cos(i * math.pi / 3), -1, 0.15 * math.sin(i * math.pi / 3)] for i in range(6)], kind='poly', cyclic=True)",
        "zhiyin.imprint(obj, curve='Ring', direction='+y')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /- Imprinted the curve Ring onto Can along \+y: .*; \d+ faces inside it, 59\d\.\d cm², at x -150 mm to 150 mm, y -500 mm to -4\d\d\.\d mm, z -129\.9 mm to 129\.9 mm/,
      );
    });

    it("refuses an outline that passes off the surface", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.imprint(obj, [[-0.2, -0.2], [0.8, -0.2], [0.8, 0.2], [-0.2, 0.2]])",
      ]);

      expect(failed).toBe(true);
      expect(said).toMatch(
        /The outline passes off Box along -z: \d+ of \d+ points tried along it meet nothing, as at \(.+\)\. Move it or shrink it to lie on the surface\./,
      );
    });
  });
});
