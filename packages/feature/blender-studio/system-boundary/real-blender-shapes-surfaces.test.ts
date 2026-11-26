/**
 * Shaping steps that work on a surface, against a real Blender: walls
 * measured between their shells, subdivision pulled in from its cage, shading
 * kept flat by weighted normals and the hard-surface stack, displacing by a
 * texture or a workspace picture, wrapping onto another shape, a curve's
 * geometry, and a tube's section, taper and ends. Each answer is measured on
 * the shape.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-shapes-surfaces.test.ts
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

const box = (name: string, size: number[], location: number[]) => ({
  name,
  kind: "cube",
  size,
  location,
});

describe.runIf(blender)("surface shaping steps in a real Blender", () => {
  const folders = new TemporaryFolders();
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  let workspace: string;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const done = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args);
    expect(result.failed, result.said).toBe(false);
    return result.said;
  };
  const fresh = async (objects: Record<string, unknown>[]) => {
    await done("blender_run_script", {
      code: "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)",
    });
    return objects.length ? done("blender_add_objects", { objects }) : "";
  };
  const shape = (object: string, ...operations: Record<string, unknown>[]) =>
    done("blender_shape_objects", { object, operations });

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-surfaces-");
    workspace = join(root, "workspace");
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
    tools = sceneAutomation(scenes.scene("surfaces"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("surfaces"),
    });
    await call("blender_open_scene", { path: "surfaces.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("surfaces");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("measures walls between their shells, on a sheet and on a closed box", async () => {
    await fresh([
      {
        name: "Sheet",
        kind: "grid",
        size: [0.2, 0.2],
        segments: 4,
        location: [0, 0, 0.1],
      },
      box("Crate", [0.3, 0.3, 0.3], [1, 0, 0.15]),
      {
        name: "Panel",
        kind: "plane",
        size: [0.2, 0.2],
        location: [2, 0, 0.1],
      },
    ]);
    expect(
      await shape("Sheet", {
        kind: "solidify",
        thickness: 0.004,
        shell_group: "Back",
        rim_group: "Edge",
        material_offset: 1,
      }),
    ).toContain(
      "Sheet: walls 4 mm thick; its walls measure 4 mm thick throughout, its shell in the vertex group Back, its rim in the vertex group Edge, its new shell taking the material +1 slots on.",
    );
    expect(
      await shape("Crate", {
        kind: "solidify",
        thickness: 0.01,
        mode: "complex",
      }),
    ).toContain(
      "Crate: walls 10 mm thick, hollow inside and sealed, so it looks as before: its volume went from 27 L to 5.056 L, by the complex method; its walls measure 10.02 mm thick throughout.",
    );
    expect(
      await shape("Panel", { kind: "solidify", thickness: 0.002, rim: false }),
    ).toContain(
      "Panel: walls 2 mm thick, its rim left open; its walls measure 2 mm thick throughout.",
    );
  }, 60_000);

  it("subdivides, saying how far the surface pulls in from its cage, simply or with creases", async () => {
    await fresh([
      box("Cage", [0.2, 0.2, 0.2], [0, 0, 0.1]),
      box("Simple", [0.2, 0.2, 0.2], [1, 0, 0.1]),
      box("Creased", [0.2, 0.2, 0.2], [2, 0, 0.1]),
    ]);
    expect(
      await shape("Cage", { kind: "subdivision", levels: 2, render_levels: 3 }),
    ).toMatch(
      /Cage: subdivided 2 times, from 6 faces to 96, 3 times in renders, shrinking it from 200 × 200 × 200 mm to 167\.9 × 167\.9 × 167\.9 mm, .*; its surface lies up to [\d.]+ mm in from its cage's corners \(mean [\d.]+ mm\), most at \([-\d., ]+ mm\); its cage: 6 quads, no triangles or faces of more than four sides; poles: 8 points where 3 edges meet, as at \([-\d., ]+ mm\); no edge creased; edges all 200 mm long/,
    );
    const simple = await shape("Simple", {
      kind: "subdivision",
      levels: 2,
      scheme: "simple",
    });
    expect(simple).toContain(
      "Simple: subdivided simply 2 times, from 6 faces to 96; its surface passes through its cage's corners; its cage: 6 quads,",
    );
    expect(simple).toMatch(
      /\. Its thinnest wall is 200 mm, at \([-\d., ]+ m{1,2}\)\./,
    );
    expect(
      await shape("Creased", {
        kind: "subdivision",
        levels: 2,
        crease: 1,
        angle: 30,
      }),
    ).toContain(
      "Creased: subdivided 2 times, from 6 faces to 96, 12 edges sharper than 30° creased 1; its surface passes through its cage's corners; its cage: 6 quads, no triangles or faces of more than four sides; poles: 8 points where 3 edges meet, as at",
    );
    expect(
      await shape("Creased", { kind: "remove", modifier: "Subdivision" }),
    ).toContain("Subdivision removed");
    expect(
      await done("blender_describe_scene", { objects: ["Creased"] }),
    ).toContain("6 faces, flat-shaded, closed, 8 L, 12 edges creased");
  }, 60_000);

  it("reads the cage before subdividing: its triangles, faces of more than four sides, poles and edge lengths, each with a place, and creases a kept pick", async () => {
    await fresh([box("Lid", [0.2, 0.1, 0.02], [0, 0, 0.01])]);
    await done("blender_run_script", {
      code: [
        "import bpy, bmesh",
        "o = bpy.data.objects['Lid']",
        "b = bmesh.new()",
        "b.from_mesh(o.data)",
        "top = [f for f in b.faces if f.normal.z > 0.5][0]",
        // A point in the middle of the top joins its four corners: four triangles meeting at a 4-edge point, a 5-edge pole at none.
        "bmesh.ops.poke(b, faces=[top])",
        "b.to_mesh(o.data)",
        "b.free()",
        "zhiyin.pick('Lid', 'edges', below=0.0001, name='base')",
      ].join("\n"),
    });
    const said = await shape("Lid", {
      kind: "subdivision",
      levels: 1,
      crease: 1,
      edges: "base",
    });
    expect(said).toMatch(
      /Lid: subdivided 1 times, from 9 faces to 32, .*4 edges of the pick “base” creased 1; .*; its cage: 5 quads, 4 triangles, as at \([-\d., ]+ mm\); poles: 4 points where 3 edges meet, as at \([-\d., ]+ mm\); 4 edges creased \(crease 1\), which it holds; edges from 20 mm to 200 mm long, the longest 10 times the shortest/,
    );
    const unknown = await call("blender_shape_objects", {
      object: "Lid",
      operations: [{ kind: "subdivision", crease: 1, edges: "rim" }],
    });
    expect(unknown.failed).toBe(true);
    expect(unknown.said).toContain(
      "“Lid” keeps no pick of edges named “rim”. It keeps these picks of edges: base.",
    );
  }, 60_000);

  it("keeps large faces flat with weighted normals and the hard-surface stack, and triangulates keeping the shading", async () => {
    await fresh([
      box("Plate", [0.2, 0.2, 0.02], [0, 0, 0.01]),
      box("Housing", [0.2, 0.2, 0.1], [1, 0, 0.05]),
      box("Flat", [0.2, 0.2, 0.1], [2, 0, 0.05]),
    ]);
    const weighted = await shape(
      "Plate",
      { kind: "smooth", shading: "smooth" },
      { kind: "bevel", width: 0.003, segments: 2 },
      { kind: "weighted_normals", weighting: "face_area" },
    );
    expect(weighted).toMatch(
      /normals weighted by face area at 50, sharp edges kept: [\d,]+ of its [\d,]+ faces shade flat, \d+% of its surface \(\d+ and \d+% before\)/,
    );
    const hard = await shape("Housing", {
      kind: "hard_surface",
      width: 0.002,
      segments: 3,
      triangulate: true,
    });
    expect(hard).toMatch(
      /Housing: hard surface: smoothed by a Smooth by Angle step kept last, its 12 edges sharper than 30° kept sharp; 12 edges rounded by 2 mm, face strength set on affected faces for weighted normals; normals weighted by face area at 50, sharp edges kept, by the faces' strength: [\d,]+ of its [\d,]+ faces shade flat, \d+% of its surface \(6 and 100% before\); triangulated, from [\d,]+ faces to [\d,]+ triangles, its shading kept/,
    );
    expect(await shape("Flat", { kind: "weighted_normals" })).toContain(
      "Flat: normals weighted by face area at 50, sharp edges kept: 6 of its 6 faces shade flat, 100% of its surface (6 and 100% before); it was flat-shaded all over, so weighted normals change nothing until it is smoothed.",
    );
  }, 60_000);

  it("displaces by a texture or a workspace picture, saying how far its points moved", async () => {
    await fresh([
      {
        name: "Ground",
        kind: "grid",
        size: [1, 1],
        segments: 20,
        location: [0, 0, 0],
      },
      box("Brick", [0.1, 0.1, 0.1], [2, 0, 0.05]),
      {
        name: "Relief",
        kind: "grid",
        size: [1, 1],
        segments: 20,
        location: [4, 0, 0],
      },
    ]);
    const ground = await shape("Ground", {
      kind: "displace",
      texture: "clouds",
      texture_size: 0.25,
      strength: 0.05,
      direction: "z",
    });
    expect(ground).toMatch(
      /Ground: displaced by clouds 250 mm across, 50 mm at full strength along z: its points moved up to [\d.]+ mm \(mean [\d.]+ mm\), its size from 1 × 1 × 0 m to 1 × 1 × 0\.0\d+ m/,
    );
    expect(await shape("Brick", { kind: "displace", strength: 0.01 })).toMatch(
      /; it has only 8 points to move: subdivide it first for detail/,
    );
    // A picture of 2 × 2 pixels: white on the left, black on the right.
    await done("blender_run_script", {
      code: [
        "import bpy",
        "p = bpy.data.images.new('relief', 2, 2)",
        "p.pixels = [1, 1, 1, 1, 0, 0, 0, 1] * 2",
        "p.filepath_raw = 'relief.png'",
        "p.file_format = 'PNG'",
        "p.save()",
        "bpy.data.images.remove(p)",
      ].join("\n"),
    });
    expect(
      await shape("Relief", {
        kind: "displace",
        texture: "image",
        image: "relief.png",
        strength: 0.02,
        direction: "z",
      }),
    ).toMatch(
      /Relief: displaced by the picture relief\.png, 20 mm at full strength along z: its points moved up to 10 mm/,
    );
  }, 60_000);

  it("holds a displace to the faces facing up, and says when its edges are too long for the pattern", async () => {
    await fresh([
      {
        name: "Rock",
        kind: "quad_sphere",
        size: [1, 1, 1],
        segments: 8,
        location: [0, 0, 0.5],
      },
      {
        name: "Coarse",
        kind: "grid",
        size: [1, 1],
        segments: 4,
        location: [2, 0, 0],
      },
    ]);
    const rock = await shape("Rock", {
      kind: "displace",
      texture: "clouds",
      texture_size: 0.3,
      strength: 0.05,
      mask: "top",
    });
    expect(rock).toMatch(
      /Rock: displaced by clouds 300 mm across, 50 mm at full strength along normal, on the faces facing up \([\d,]+ points\): its points moved up to/,
    );
    const below = await done("blender_run_script", {
      code: [
        "import bpy",
        "o = bpy.data.objects['Rock']",
        "g = o.vertex_groups['Rock displace top']",
        "low = [v for v in o.data.vertices if v.co.z < -0.3]",
        "print('below', sum(1 for v in low for x in v.groups if x.group == g.index and x.weight > 0))",
      ].join("\n"),
    });
    expect(below).toMatch(/^below 0$/m);
    expect(
      await shape("Coarse", {
        kind: "displace",
        texture: "voronoi",
        texture_size: 0.05,
        strength: 0.01,
      }),
    ).toContain(
      "; it has only 25 points to move: subdivide it first for detail",
    );
    await done("blender_add_objects", {
      objects: [
        {
          name: "Field",
          kind: "grid",
          size: [1, 1],
          segments: 12,
          location: [4, 0, 0],
        },
      ],
    });
    expect(
      await shape("Field", {
        kind: "displace",
        texture: "voronoi",
        texture_size: 0.05,
        strength: 0.01,
      }),
    ).toContain(
      "; its edges are 83.33 mm long (median), longer than the pattern's 50 mm, so the pattern falls between its points: subdivide it until its edges are under 25 mm, or give a larger texture_size",
    );
    const sizeless = await call("blender_shape_objects", {
      object: "Field",
      operations: [{ kind: "displace", texture: "noise", texture_size: 0.1 }],
    });
    expect(sizeless.failed).toBe(true);
    expect(sizeless.said).toContain(
      "noise moves each point by its own random amount and has no size: for a pattern of a size, give texture clouds or voronoi.",
    );
  }, 60_000);

  it("wraps a shape onto another, saying how many points lie on it and how far the rest are", async () => {
    await fresh([
      {
        name: "Head",
        kind: "sphere",
        size: [0.2, 0.2, 0.2],
        segments: 32,
        location: [0, 0, 0.1],
      },
      {
        name: "Cap",
        kind: "grid",
        size: [0.1, 0.1],
        segments: 6,
        location: [0, 0, 0.25],
      },
      {
        name: "Visor",
        kind: "grid",
        size: [0.3, 0.1],
        segments: 6,
        location: [0, 0, 0.25],
      },
    ]);
    expect(
      await shape("Cap", {
        kind: "shrinkwrap",
        target: "Head",
        standoff: 0.002,
      }),
    ).toContain(
      "Cap: wrapped onto Head by nearest surface, 2 mm off it: 49 of its 49 points lie at that distance.",
    );
    expect(
      await shape("Visor", {
        kind: "shrinkwrap",
        target: "Head",
        wrap: "project",
        project_axes: ["z"],
        both_ways: true,
      }),
    ).toMatch(
      /Visor: wrapped onto Head by project along z: \d+ of its 49 points lie on it; the other \d+ stay up to [\d.]+ mm from it/,
    );
  }, 60_000);

  it("sets a curve's geometry and measures the surface it makes", async () => {
    await fresh([]);
    await done("blender_run_script", {
      code: [
        "import bpy",
        "c = bpy.data.curves.new('Rail', 'CURVE')",
        "c.dimensions = '3D'",
        "s = c.splines.new('POLY')",
        "s.points.add(1)",
        "s.points[0].co = (0, 0, 0, 1)",
        "s.points[1].co = (1, 0, 0, 1)",
        "bpy.context.scene.collection.objects.link(bpy.data.objects.new('Rail', c))",
        "t = bpy.data.curves.new('Narrowing', 'CURVE')",
        "s = t.splines.new('POLY')",
        "s.points.add(1)",
        "s.points[0].co = (0, 1, 0, 1)",
        "s.points[1].co = (1, 0.5, 0, 1)",
        "bpy.context.scene.collection.objects.link(bpy.data.objects.new('Narrowing', t))",
      ].join("\n"),
    });
    const capped = await shape("Rail", {
      kind: "curve",
      depth: 0.01,
      resolution: 4,
      caps: true,
    });
    expect(capped).toContain(
      "Rail: swept 10 mm deep about its path, 4 steps round each quarter of its section: now a surface of 32 faces, 1 m along its path, 20 mm across, closed at its ends.",
    );
    // Blender lays a curve's caps on its sides' ends without joining them, as every curve has them.
    expect(capped).not.toContain("without being joined");
    expect(
      await shape("Rail", {
        kind: "curve",
        taper_object: "Narrowing",
        caps: false,
      }),
    ).toContain(
      "Rail: tapered by Narrowing: now a surface of 12 faces, 1 m along its path, 10 mm to 20 mm across, 20 mm at its start and 10 mm at its end, open at its ends.",
    );
    const refused = await call("blender_shape_objects", {
      object: "Rail",
      operations: [{ kind: "bevel", width: 0.001 }],
    });
    expect(refused.said).toContain(
      "“Rail” is a curve, which takes curve steps; a bevel step is for a mesh.",
    );
  }, 60_000);

  it("takes each surface kind's other inputs and says them as measured", async () => {
    await fresh([
      box("Shell", [0.2, 0.2, 0.2], [0, 0, 0.1]),
      box("Soft", [0.2, 0.2, 0.2], [1, 0, 0.1]),
      {
        name: "Bumps",
        kind: "grid",
        size: [0.5, 0.5],
        segments: 10,
        location: [2, 0, 0],
      },
      box("Core", [0.2, 0.2, 0.2], [3, 0, 0.1]),
      box("Skin", [0.3, 0.3, 0.3], [3, 0, 0.1]),
    ]);
    expect(
      await shape("Shell", {
        kind: "solidify",
        thickness: 0.005,
        rim_only: true,
      }),
    ).toContain("Shell: walls 5 mm thick, hollow inside and sealed");
    expect(
      await shape("Soft", {
        kind: "subdivision",
        levels: 1,
        boundary: "keep_corners",
        uv_smooth: "keep_boundaries",
        limit_surface: false,
      }),
    ).toContain(
      ", its open edges' corners kept, its picture layout smoothed: keep boundaries, short of the limit surface",
    );
    expect(
      await shape("Bumps", {
        kind: "displace",
        texture: "voronoi",
        strength: 0.02,
        midlevel: 0,
        space: "global",
      }),
    ).toMatch(
      /Bumps: displaced by voronoi, 20 mm at full strength along normal: its points moved up to [\d.]+ mm/,
    );
    expect(
      await shape("Skin", {
        kind: "shrinkwrap",
        target: "Core",
        wrap_mode: "outside",
        standoff: 0.001,
      }),
    ).toContain(
      // Outside moves only points inside it: its corners stay where they are.
      "Skin: wrapped onto Core by nearest surface, outside, 1 mm off it: 0 of its 8 points lie at that distance; the other 8 stay up to 85.6 mm from it (mean 85.6 mm).",
    );
    await done("blender_run_script", {
      code: [
        "import bpy",
        "for name, dims in (('Path', '3D'), ('Badge', '2D'), ('Square', '2D')):",
        "    c = bpy.data.curves.new(name, 'CURVE')",
        "    c.dimensions = dims",
        "    s = c.splines.new('POLY')",
        "    pts = [(0, 0), (1, 0)] if name == 'Path' else [(-0.05, -0.05), (0.05, -0.05), (0.05, 0.05), (-0.05, 0.05)]",
        "    s.points.add(len(pts) - 1)",
        "    for p, (x, y) in zip(s.points, pts): p.co = (x, y, 0, 1)",
        "    s.use_cyclic_u = name != 'Path'",
        "    o = bpy.data.objects.new(name, c)",
        "    bpy.context.scene.collection.objects.link(o)",
        "    o.location.y = 5",
      ].join("\n"),
    });
    expect(
      await shape("Path", {
        kind: "curve",
        profile_preset: "crown",
        depth: 0.02,
        twist: "z_up",
      }),
    ).toContain(
      "Path: swept 20 mm deep about its path, its section a crown profile, twisting by z up: now a surface of",
    );
    expect(
      await shape("Path", {
        kind: "curve",
        bevel_object: "Square",
        caps: true,
      }),
    ).toContain("Path: its section the shape of Square: now a surface of");
    expect(
      await shape("Badge", { kind: "curve", extrude: 0.01, fill: "both" }),
    ).toContain(
      "Badge: extruded 10 mm each way, filled both: now a surface of",
    );
    const wrong = await call("blender_shape_objects", {
      object: "Badge",
      operations: [{ kind: "curve", fill: "half" }],
    });
    expect(wrong.said).toContain(
      "A curve's fill, for a 2D curve, is both, back, front or none.",
    );
  }, 60_000);

  it("adds a tube of a drawn section, tapering, with open ends, and measures how wide it is at each end", async () => {
    const added = await fresh([
      {
        name: "Duct",
        kind: "tube",
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        section: [
          [-0.02, -0.01],
          [0.02, -0.01],
          [0.02, 0.01],
          [-0.02, 0.01],
        ],
        corners: "sharp",
      },
      {
        name: "Horn",
        kind: "tube",
        points: [
          [0, 1, 0],
          [1, 1, 0],
        ],
        radius: 0.05,
        taper: [1, 0.2],
        caps: false,
        corners: "sharp",
      },
    ]);
    expect(added).toContain(
      "44.72 mm across at its start and 44.72 mm at its end; its section drawn through 4 points.",
    );
    expect(added).toContain(
      "100 mm across at its start and 20 mm at its end; open at its ends.",
    );
  }, 60_000);
});
