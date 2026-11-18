/**
 * The zhiyin library's loops, marks and shaping, against a real Blender:
 * loops and rings walked across quads, open boundaries, a face region's
 * outline and a loop's inside, edge marks as Blender keeps them, and points
 * made round, even, flat or moved with a falloff. Each call's measured line
 * comes back in the script's answer, and a call that cannot do as asked is
 * refused with why.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
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

/** A mesh object made fresh from one bmesh call, standing at `location`. */
const made = (name: string, call: string, location = "(0, 0, 0)") => [
  "import bmesh, bpy",
  `old = bpy.data.objects.get('${name}')`,
  "if old: bpy.data.objects.remove(old)",
  "shape = bmesh.new()",
  call,
  `mesh = bpy.data.meshes.new('${name}')`,
  "shape.to_mesh(mesh)",
  "shape.free()",
  `obj = bpy.data.objects.new('${name}', mesh)`,
  `obj.location = ${location}`,
  "bpy.context.scene.collection.objects.link(obj)",
];

/** A flat 2 m square of 4 × 4 quads, each 500 mm, centred on the origin. */
const grid = made(
  "Grid",
  "bmesh.ops.create_grid(shape, x_segments=4, y_segments=4, size=1)",
);
/** An open tube of 8 sides, 500 mm in radius, standing 1 m tall on the floor. */
const tube = made(
  "Tube",
  "bmesh.ops.create_cone(shape, cap_ends=False, segments=8, radius1=0.5, radius2=0.5, depth=1)",
  "(0, 0, 0.5)",
);
/** A UV sphere of 2 m radius: 8 segments round, 4 rings from pole to pole. */
const sphere = made(
  "Sphere",
  "bmesh.ops.create_uvsphere(shape, u_segments=8, v_segments=4, radius=2)",
);
/** A cone of 8 sides whose sides are a fan of triangles meeting at its tip. */
const cone = made(
  "Cone",
  "bmesh.ops.create_cone(shape, cap_ends=True, cap_tris=False, segments=8, radius1=0.5, radius2=0, depth=1)",
);
/** A one-metre box standing on the floor. */
const box = made("Box", "bmesh.ops.create_cube(shape, size=1)", "(0, 0, 0.5)");
/** Moves the point of the grid at its centre to `x`, `y`, `z`. */
const centreTo = (x: number, y: number, z: number) => [
  "for v in obj.data.vertices:",
  `    if v.co.length < 1e-6: v.co = (${x}, ${y}, ${z})`,
];

describe.runIf(blender)(
  "the zhiyin library's loops and shaping in a real Blender",
  () => {
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
      const root = await folders.make("zhiyin-studio-loops-");
      const workspace = join(root, "workspace");
      await mkdir(workspace, { recursive: true });
      scenes = new ConversationScenes({
        blender: async () => blender,
        directory: join(root, "data"),
        launch: containedSessionLaunch(
          { open: openProcessContainer },
          { scripts: join(root, "session-scripts") },
        ),
        script: sessionScript,
      });
      tools = sceneAutomation(scenes.scene("loops"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("loops"),
      });
      await tools.callTool("blender_open_scene", {
        path: "loops.blend",
        create: true,
      });
    });

    afterAll(async () => {
      await scenes.forget("loops");
      await scenes.closeAll();
      await folders.removeAll();
    });

    describe("loop", () => {
      it("walks a grid's edge loop across quads from the edge nearest a point, to the border", async () => {
        const { failed, said } = await run([
          ...grid,
          "found = zhiyin.loop(obj, near=[0.25, 0, 0])",
          "print(found.kind, len(found))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain("edges 4");
        expect(said).toContain(
          "- Took the edge loop of Grid through the edge nearest (250, 0, 0 mm): 4 edges, open, 2 m long; x -1 m to 1 m, y 0 mm, z 0 mm.",
        );
      });

      it("closes round a sphere's equator, and stops at its poles where more than four edges meet", async () => {
        const { failed, said } = await run([
          ...sphere,
          "zhiyin.loop(obj, near=[1.7, 0.7, 0])",
          "zhiyin.loop(obj, near=[1.7, 0, 0.7])",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Took the edge loop of Sphere through the edge nearest (1.7, 0.7, 0 m), which passes 9.285 mm from it: 8 edges, closed, 12.25 m long; x -2 m to 2 m, y -2 m to 2 m, z 0 mm.",
        );
        expect(said).toContain(
          "- Took the edge loop of Sphere through the edge nearest (1.7, 0, 0.7 m), which passes 9.285 mm from it: 4 edges, open, 6.123 m long; x 0 mm to 2 m, y 0 mm, z -2 m to 2 m.",
        );
      });

      it("follows a tube's rim through an edge picked on it, and keeps the loop by name", async () => {
        const { failed, said } = await run([
          ...tube,
          "edge = zhiyin.pick(obj, 'edges', near=[[0.18, 0.43, 1], 0.05])",
          "zhiyin.loop(obj, through=edge, name='top rim')",
          "print(len(zhiyin.picked(obj, 'top rim')))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Took the edge loop of Tube through the 1 edge picked: 8 edges, closed, 3.061 m long; x -500 mm to 500 mm, y -500 mm to 500 mm, z 1 m; kept as “top rim”.",
        );
        expect(said).toContain("8\n");
      });

      it("takes a loop through each edge picked, counting each loop once", async () => {
        const { failed, said } = await run([
          ...grid,
          "middle = zhiyin.pick(obj, 'edges', near=[[0, 0, 0], 0.3])",
          "zhiyin.loop(obj, through=middle)",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Took 2 edge loops of Grid through the 4 edges picked: 8 edges in 2 loops (4 edges, open, 2 m long; 4 edges, open, 2 m long); x -1 m to 1 m, y -1 m to 1 m, z 0 mm.",
        );
      });

      it("refuses a loop up a cone's fan of triangles, saying how many edges meet at the edge's ends", async () => {
        const { failed, said } = await run([
          ...cone,
          "zhiyin.loop(obj, near=[0, 0.25, 0])",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "The edge nearest (0, 250, 0 mm) of Cone leads into no loop: 8 and 3 edges meet at its ends. A loop carries on through a point where four edges meet, each between two faces, or along an open rim through a point where three edges meet.",
        );
      });

      it("refuses a call that gives neither a point nor edges to go through", async () => {
        const { failed, said } = await run([...grid, "zhiyin.loop(obj)"]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "loop needs near=[x, y, z], a point the loop passes by, or through=, a pick of edges it goes through.",
        );
      });
    });

    describe("ring", () => {
      it("crosses a grid's quads from the edge nearest a point, to the border", async () => {
        const { failed, said } = await run([
          ...grid,
          "zhiyin.ring(obj, near=[0.25, 0, 0])",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Took the edge ring of Grid across the edge nearest (250, 0, 0 mm): 5 edges, open, crossing 4 faces, each 500 mm long; x 0 mm to 500 mm, y -1 m to 1 m, z 0 mm.",
        );
      });

      it("closes round a tube across its sides", async () => {
        const { failed, said } = await run([
          ...tube,
          "zhiyin.ring(obj, near=[0, 0.5, 0.5])",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Took the edge ring of Tube across the edge nearest (0, 500, 500 mm): 8 edges, closed, crossing 8 faces, each 1 m long; x -500 mm to 500 mm, y -500 mm to 500 mm, z 0 mm to 1 m.",
        );
      });

      it("refuses a ring across triangles, saying how many sides the faces have", async () => {
        const { failed, said } = await run([
          ...cone,
          "zhiyin.ring(obj, near=[0, 0.25, 0])",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "The edge nearest (0, 250, 0 mm) of Cone is in no ring: a ring crosses faces of four sides, and the faces beside it have 3 and 3.",
        );
      });
    });

    describe("boundary", () => {
      it("finds a tube's two open rims, each with its edges and length", async () => {
        const { failed, said } = await run([...tube, "zhiyin.boundary(obj)"]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Found the open boundary of Tube: 16 edges in 2 loops (8 edges, closed, 3.061 m long; 8 edges, closed, 3.061 m long); x -500 mm to 500 mm, y -500 mm to 500 mm, z 0 mm to 1 m.",
        );
      });

      it("keeps to the rims that touch a pick", async () => {
        const { failed, said } = await run([
          ...tube,
          "top = zhiyin.pick(obj, 'verts', above=0.9)",
          "print(len(zhiyin.boundary(top)))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Found the open boundary of Tube by the 8 points picked: 8 edges, closed, 3.061 m long; x -500 mm to 500 mm, y -500 mm to 500 mm, z 1 m.",
        );
      });

      it("refuses a closed surface, which has none", async () => {
        const { failed, said } = await run([...sphere, "zhiyin.boundary(obj)"]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "Sphere has no open boundary: each of its 56 edges joins two faces.",
        );
      });
    });

    describe("region_to_loop and loop_to_region", () => {
      it("outlines a face region, then takes the faces inside the outline back", async () => {
        const { failed, said } = await run([
          ...grid,
          "middle = zhiyin.pick(obj, inside=[[-0.5, -0.5, -1], [0.5, 0.5, 1]])",
          "outline = zhiyin.region_to_loop(middle, name='outline')",
          "inside = zhiyin.loop_to_region(outline)",
          "print(inside.kind, inside.indices == middle.indices)",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Outlined 4 faces of Grid: 8 edges, closed, 4 m long; x -500 mm to 500 mm, y -500 mm to 500 mm, z 0 mm; kept as “outline”.",
        );
        expect(said).toContain(
          "- Took the faces inside the 8 edges picked of Grid: 4 faces, 1 m², the smaller side; the other side holds 12 faces, 3 m²; x -500 mm to 500 mm, y -500 mm to 500 mm, z 0 mm.",
        );
        expect(said).toContain("faces True");
      });

      it("says when the two sides of a loop are equal", async () => {
        const { failed, said } = await run([
          ...sphere,
          "equator = zhiyin.loop(obj, near=[1.7, 0.7, 0])",
          "zhiyin.loop_to_region(equator)",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toMatch(
          /- Took the faces inside the 8 edges picked of Sphere: 16 faces, [\d.]+ m², one of two equal sides; the other side holds 16 faces, [\d.]+ m²; x -2 m to 2 m, y -2 m to 2 m, z (-2 m to 0 mm|0 mm to 2 m)\./,
        );
      });

      it("refuses to outline faces that close on themselves", async () => {
        const { failed, said } = await run([
          ...sphere,
          "zhiyin.region_to_loop(zhiyin.pick(obj))",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "The 32 faces picked of Sphere have no outline: together they close on themselves.",
        );
      });

      it("refuses edges that do not part the faces", async () => {
        const { failed, said } = await run([
          ...grid,
          "one = zhiyin.pick(obj, 'edges', near=[[0.25, 0, 0], 0.01])",
          "zhiyin.loop_to_region(one)",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "The 1 edge picked does not part Grid's faces: they all still reach each other around it.",
        );
      });
    });

    describe("mark", () => {
      it("sets a crease and a seam as Blender keeps them, says how many changed, and says when nothing did", async () => {
        const { failed, said } = await run([
          ...box,
          "top = zhiyin.pick(obj, 'edges', above=0.99)",
          "zhiyin.mark(top, crease=1, seam=True)",
          "zhiyin.mark(top, crease=1)",
          "zhiyin.mark(top, seam=False, sharp=True, bevel_weight=0.5)",
          "a = obj.data.attributes",
          "print('crease', sum(d.value for d in a['crease_edge'].data))",
          "print('seam', sum(d.value for d in a['uv_seam'].data))",
          "print('sharp', sum(d.value for d in a['sharp_edge'].data))",
          "print('bevel', sum(d.value for d in a['bevel_weight_edge'].data))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Marked 4 edges of Box: crease 1, 4 changed, now on 4 of its 12 edges; seam, 4 changed, now on 4 of its 12 edges.",
        );
        expect(said).toContain(
          "- Marked 4 edges of Box: crease 1, none changed, now on 4 of its 12 edges. Nothing changed: they were already so.",
        );
        expect(said).toContain(
          "- Marked 4 edges of Box: bevel weight 0.5, 4 changed, now on 4 of its 12 edges; sharp, 4 changed, now on 4 of its 12 edges; seam cleared, 4 changed, now on 0 of its 12 edges.",
        );
        expect(said).toContain("crease 4.0");
        expect(said).toContain("seam 0");
        expect(said).toContain("sharp 4");
        expect(said).toContain("bevel 2.0");
      });

      it("refuses a mark with nothing to set", async () => {
        const { failed, said } = await run([
          ...box,
          "zhiyin.mark(zhiyin.pick(obj, 'edges', above=0.99))",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "mark needs something to set: crease, bevel_weight, sharp or seam.",
        );
      });
    });

    describe("circularize", () => {
      it("makes a square outline round, evenly spaced, at the radius it fits", async () => {
        const { failed, said } = await run([
          ...grid,
          "outline = zhiyin.region_to_loop(zhiyin.pick(obj, inside=[[-0.5, -0.5, -1], [0.5, 0.5, 1]]))",
          "zhiyin.circularize(outline)",
          "print(sorted({round(obj.data.vertices[v].co.length, 4) for e in outline for v in obj.data.edges[e].vertices}))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Circularized a closed loop of 8 points on Grid: radius 603.6 mm, centre (0, 0, 0 mm), facing [0, 0, 1]; off round by up to 103.6 mm before, 0 mm after; points moved up to 103.6 mm.",
        );
        expect(said).toContain("[0.6036]");
      });

      it("takes the radius asked, and says the radius it would have fitted", async () => {
        const { failed, said } = await run([
          ...grid,
          "outline = zhiyin.region_to_loop(zhiyin.pick(obj, inside=[[-0.5, -0.5, -1], [0.5, 0.5, 1]]))",
          "zhiyin.circularize(outline, radius=0.5)",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Circularized a closed loop of 8 points on Grid: radius 500 mm as asked (it fits 603.6 mm), centre (0, 0, 0 mm), facing [0, 0, 1]; off round by up to 103.6 mm before, 0 mm after; points moved up to 207.1 mm.",
        );
      });

      it("refuses an open chain of two points", async () => {
        const { failed, said } = await run([
          ...grid,
          "zhiyin.circularize(zhiyin.pick(obj, 'edges', near=[[0.25, 0, 0], 0.01]))",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "A circle needs at least three points; the 1 edge picked joins 2.",
        );
      });
    });

    describe("space_evenly", () => {
      it("spaces an open chain's points evenly along it, keeping its ends", async () => {
        const { failed, said } = await run([
          ...grid,
          ...centreTo(0.3, 0, 0),
          "row = zhiyin.loop(obj, near=[-0.75, 0, 0])",
          "zhiyin.space_evenly(row)",
          "print(sorted(round(obj.data.vertices[v].co.x, 4) + 0.0 for v in {v for e in row for v in obj.data.edges[e].vertices}))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Spaced an open chain of 5 points on Grid along its 2 m: segments off even by up to 300 mm before (200 mm to 800 mm), 0 mm after (each 500 mm); points moved up to 300 mm.",
        );
        expect(said).toContain("[-1.0, -0.5, 0.0, 0.5, 1.0]");
      });

      it("refuses a chain with no point between its ends", async () => {
        const { failed, said } = await run([
          ...grid,
          "zhiyin.space_evenly(zhiyin.pick(obj, 'edges', near=[[0.25, 0, 0], 0.01]))",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "Spacing evenly needs a point between two others; the 1 edge picked joins only its 2 ends.",
        );
      });
    });

    describe("flatten", () => {
      it("flattens points onto their best-fit plane", async () => {
        const { failed, said } = await run([
          ...grid,
          ...centreTo(0, 0, 0.2),
          "zhiyin.flatten(zhiyin.pick(obj, 'verts'))",
          "print(sorted({round(v.co.z, 4) for v in obj.data.vertices}))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Flattened 25 points of Grid onto their best-fit plane through (0, 0, 8 mm), facing [0, 0, 1]: off it by up to 192 mm before, 0 mm after; points moved up to 192 mm.",
        );
        expect(said).toContain("[0.008]");
      });

      it("flattens points onto a plane given", async () => {
        const { failed, said } = await run([
          ...grid,
          ...centreTo(0, 0, 0.2),
          "zhiyin.flatten(zhiyin.pick(obj, 'verts'), plane=[[0, 0, 0], 'up'])",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Flattened 25 points of Grid onto the plane through (0, 0, 0 mm), facing [0, 0, 1]: off it by up to 200 mm before, 0 mm after; points moved up to 200 mm.",
        );
      });

      it("refuses three points onto their own plane, which are always flat", async () => {
        const { failed, said } = await run([
          ...grid,
          "zhiyin.flatten(zhiyin.pick(obj, 'verts', near=[[1, 1, 0], 0.5]))",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain(
          "Three points always lie on a plane: flattening the 3 points picked onto their best-fit plane would move nothing. Give plane=[point, normal] to flatten them onto another.",
        );
      });
    });

    describe("move", () => {
      it("moves a point fully and its neighbours within the falloff by a smooth share of it", async () => {
        const { failed, said } = await run([
          ...grid,
          "centre = zhiyin.pick(obj, 'verts', near=[[0, 0, 0], 0.01])",
          "zhiyin.move(centre, by=[0, 0, 0.2], falloff=0.8)",
          "print(sorted({round(v.co.z, 4) for v in obj.data.vertices}))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Moved 9 points of Grid: the 1 picked fully by (0, 0, 200 mm), now at x 0 mm, y 0 mm, z 200 mm; 8 more within 800 mm partly (smooth), by 7.464 mm to 63.28 mm.",
        );
        expect(said).toContain("[0.0, 0.0075, 0.0633, 0.2]");
      });

      it("measures the falloff along the mesh when connected", async () => {
        const { failed, said } = await run([
          ...grid,
          "centre = zhiyin.pick(obj, 'verts', near=[[0, 0, 0], 0.01])",
          "zhiyin.move(centre, by=[0, 0, 0.2], falloff=0.8, shape='linear', connected=True)",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Moved 5 points of Grid: the 1 picked fully by (0, 0, 200 mm), now at x 0 mm, y 0 mm, z 200 mm; 4 more within 800 mm along the mesh partly (linear), by 75 mm each.",
        );
      });

      it("moves only the pick with no falloff", async () => {
        const { failed, said } = await run([
          ...grid,
          "zhiyin.move(zhiyin.pick(obj, 'edges', near=[[0.25, 0, 0], 0.01]), by=[0, 0.1, 0])",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Moved 2 points of Grid by (0, 100, 0 mm), now at x 0 mm to 500 mm, y 100 mm, z 0 mm.",
        );
      });

      it("refuses a move of nothing", async () => {
        const { failed, said } = await run([
          ...grid,
          "zhiyin.move(zhiyin.pick(obj, 'verts'), by=[0, 0, 0])",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain("by [0, 0, 0] moves nothing.");
      });
    });

    describe("scale", () => {
      it("scales a pick along the world's axes about its middle, as S Y 0.5 does", async () => {
        const { failed, said } = await run([
          ...box,
          "zhiyin.scale(zhiyin.pick(obj, facing='+z'), [1, 0.5, 1])",
          "print(sorted({round(v.co.y, 4) for v in obj.data.vertices}))",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Scaled 4 points of Box by 1, 0.5, 1 about (0, 0, 1 m): they lay at x -500 mm to 500 mm, y -500 mm to 500 mm, z 1 m; now at x -500 mm to 500 mm, y -250 mm to 250 mm, z 1 m.",
        );
        expect(said).toContain("[-0.5, -0.25, 0.25, 0.5]");
      });

      it("scales by one factor about a point given, and to nothing along an axis", async () => {
        const { failed, said } = await run([
          ...box,
          "zhiyin.scale(zhiyin.pick(obj, facing='+z'), 2, about=[0, 0, 0])",
          "zhiyin.scale(zhiyin.pick(obj, facing='+x', within=60), [0, 1, 1])",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Scaled 4 points of Box by 2 about (0, 0, 0 mm): they lay at x -500 mm to 500 mm, y -500 mm to 500 mm, z 1 m; now at x -1 m to 1 m, y -1 m to 1 m, z 2 m.",
        );
        // The side now leans out to the wider top; scaled to nothing across x, it stands upright.
        expect(said).toContain(
          "- Scaled 4 points of Box by 0, 1, 1 about (0.75, 0, 1 m): they lay at x 500 mm to 1 m, y -1 m to 1 m, z 0 mm to 2 m; now at x 750 mm, y -1 m to 1 m, z 0 mm to 2 m.",
        );
      });

      it("refuses a scale by 1, which moves nothing", async () => {
        const { failed, said } = await run([
          ...box,
          "zhiyin.scale(zhiyin.pick(obj, facing='+z'), [1, 1, 1])",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain("by 1 on every axis moves nothing.");
      });
    });

    describe("rotate", () => {
      it("turns a pick about an axis through its middle, as R Z 45 does", async () => {
        const { failed, said } = await run([
          ...box,
          "zhiyin.rotate(zhiyin.pick(obj, facing='+z'), 45, axis='z')",
        ]);

        expect(failed, said).toBe(false);
        expect(said).toContain(
          "- Turned 4 points of Box by 45° about z through (0, 0, 1 m): they lay at x -500 mm to 500 mm, y -500 mm to 500 mm, z 1 m; now at x -707.1 mm to 707.1 mm, y -707.1 mm to 707.1 mm, z 1 m.",
        );
      });

      it("turns a pick about a point given, on an axis given as three numbers", async () => {
        const { failed, said } = await run([
          ...box,
          "zhiyin.rotate(zhiyin.pick(obj, facing='+z'), 90, axis=[0, 1, 0], about=[0.5, 0, 1])",
        ]);

        expect(failed, said).toBe(false);
        // The top swings up on its +x edge like a lid opening to stand upright.
        expect(said).toContain(
          "- Turned 4 points of Box by 90° about [0, 1, 0] through (0.5, 0, 1 m): they lay at x -500 mm to 500 mm, y -500 mm to 500 mm, z 1 m; now at x 500 mm, y -500 mm to 500 mm, z 1 m to 2 m.",
        );
      });

      it("refuses a turn of 0°, which moves nothing", async () => {
        const { failed, said } = await run([
          ...box,
          "zhiyin.rotate(zhiyin.pick(obj, facing='+z'), 0, axis='z')",
        ]);

        expect(failed).toBe(true);
        expect(said).toContain("A turn of 0° moves nothing.");
      });
    });
  },
);
