// @vitest-environment node
/**
 * A drawing of a Blender scene, made as the composition makes it: the
 * conversation's real Blender finds each view's lines with Line Art, and the
 * CAD studio's real drafting lays them out and dimensions them (ADR 0022).
 *
 * The studios' own tests prove each side with a stand-in for the other. This
 * one proves they meet: the lines Blender writes are the lines the drafting
 * reads, a dimension asked for in the scene's millimetres measures the scene,
 * and the scene is left as it was. It is skipped unless both programs are
 * named in the environment, as their own suites are:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"
 *   npx vitest run --project "system-boundary*" apps/desktop/system-boundary/scene-drawing.test.ts
 */

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
  sceneLines,
} from "@zhiyin/blender-studio";
import { withKeptGlCache } from "@zhiyin/blender-studio/testing";
import { cadAutomation } from "@zhiyin/cad-studio";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { confinedCadPython } from "./cad-python.js";

const blender = process.env["ZHIYIN_BLENDER"];
const python = process.env["ZHIYIN_CAD_PYTHON"];
const session = fileURLToPath(
  new URL(
    "../../../packages/feature/blender-studio/src/session/start.py",
    import.meta.url,
  ),
);
const harness = fileURLToPath(
  new URL(
    "../../../packages/feature/cad-studio/src/harness/run.py",
    import.meta.url,
  ),
);

type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};

const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

describe.runIf(blender && python)("a drawing of a real Blender scene", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let studio: ReturnType<typeof sceneAutomation>;
  let drawing: ReturnType<typeof cadAutomation>;
  const said = (result: Result) =>
    result.content.map((c) => c.text ?? "").join("\n");
  const call = async (
    tools: ReturnType<typeof cadAutomation>,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const asked = await tools.inspect(name, args);
    if (!asked.ok) throw new Error(asked.reason);
    return (await tools.callTool(
      name,
      args,
      undefined,
      asked.identity,
    )) as Result;
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-scene-drawing-");
    workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data", "scenes"),
      launch: withKeptGlCache(containedSessionLaunch)(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: session,
    });
    studio = sceneAutomation(scenes.scene("table"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("table"),
    });
    drawing = cadAutomation(
      await confinedCadPython(python!, "python-scene-drawing-test"),
      {
        workspaceRoot: () => workspace,
        harness,
        directory: join(root, "data", "cad-studio"),
        sceneLines: sceneLines(
          scenes.scene("table"),
          scenes.directory("table"),
          async () => blender,
        ),
      },
    );
    // A table 1200 × 800 mm, 760 mm high, its top 40 mm thick with an 80 mm
    // hole for cables in the middle, on four legs 60 mm across, the back
    // two straight behind the front two.
    const steps = [
      await call(studio, "blender_open_scene", {
        path: "table.blend",
        create: true,
      }),
      await call(studio, "blender_add_objects", {
        objects: [
          {
            name: "Top",
            kind: "cube",
            size: [1.2, 0.8, 0.04],
            location: [0, 0, 0.74],
          },
          ...[
            ["Leg FL", -0.5, -0.3],
            ["Leg FR", 0.5, -0.3],
            ["Leg BL", -0.5, 0.3],
            ["Leg BR", 0.5, 0.3],
          ].map(([name, x, y]) => ({
            name,
            kind: "cylinder",
            size: [0.06, 0.06, 0.72],
            location: [x, y, 0.36],
          })),
        ],
      }),
      await call(studio, "blender_shape_objects", {
        object: "Top",
        operations: [
          {
            kind: "boolean",
            operation: "difference",
            cutter: {
              shape: "cylinder",
              diameter: 0.08,
              depth: 0.1,
              location: [0, 0, 0.74],
            },
          },
        ],
      }),
    ];
    for (const step of steps) expect(step.isError, said(step)).toBeUndefined();
  }, 300_000);

  afterAll(async () => {
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("draws the scene's views, measures it in its own millimetres, and leaves it as it was", async () => {
    const file = join(workspace, "table.blend");
    const before = await hash(file);
    const described = said(await call(studio, "blender_describe_scene", {}));

    const result = await call(drawing, "cad_draw", {
      scene: true,
      views: [
        { view: "front" },
        { view: "top" },
        { section: "A", looking: "front", through: [0, 0, 740] },
      ],
      dimensions: [
        {
          view: "top",
          kind: "length",
          from: [-600, -400, 760],
          to: [600, -400, 760],
        },
        { view: "top", kind: "diameter", at: [40, 0, 760] },
        // The legs, under the top, are hidden circles there.
        { view: "top", kind: "diameter", at: [500, 300, 760], all: true },
        {
          view: "front",
          kind: "length",
          from: [470, 0, 0],
          to: [600, 0, 760],
          direction: "vertical",
        },
      ],
      outputs: [{ path: "table.pdf" }, { path: "top.dxf", view: "top" }],
    });

    expect(result.isError, said(result)).toBeUndefined();
    expect(said(result)).toContain("Dimensions on top: 1200, Ø80, 4× Ø60.");
    expect(said(result)).toContain("Dimensions on front: 760.");
    expect(
      (await readFile(join(workspace, "table.pdf"))).subarray(0, 5).toString(),
    ).toBe("%PDF-");
    expect(await readFile(join(workspace, "top.dxf"), "utf8")).toContain(
      "ENTITIES",
    );
    // The sheet is shown to the model.
    expect(result.content.some((c) => c.type === "image")).toBe(true);
    expect(await hash(file)).toBe(before);
    expect(said(await call(studio, "blender_describe_scene", {}))).toBe(
      described,
    );
  });

  it("draws an auxiliary view of the scene along the direction it is given", async () => {
    const result = await call(drawing, "cad_draw", {
      scene: true,
      views: [{ view: "front" }, { auxiliary: "B", direction: [1, -1, 0] }],
      outputs: [{ path: "auxiliary.pdf" }],
    });

    expect(result.isError, said(result)).toBeUndefined();
    expect(
      (await readFile(join(workspace, "auxiliary.pdf")))
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");

    // Looking down instead draws other lines: the view follows its direction.
    const lines = async (direction: number[], path: string) => {
      const drawn = await call(drawing, "cad_draw", {
        scene: true,
        views: [{ view: "front" }, { auxiliary: "B", direction }],
        outputs: [{ path, view: "B" }],
      });
      expect(drawn.isError, said(drawn)).toBeUndefined();
      return readFile(join(workspace, path), "utf8");
    };
    const across = await lines([1, -1, 0], "across.dxf");
    const down = await lines([0, 0, -1], "down.dxf");
    expect(across).toContain("ENTITIES");
    expect(down).not.toBe(across);
  });

  it("refuses a drawing that expects a size the scene does not have", async () => {
    const result = await call(drawing, "cad_draw", {
      scene: true,
      views: [{ view: "top" }],
      dimensions: [
        {
          view: "top",
          kind: "length",
          from: [-600, -400, 760],
          to: [600, -400, 760],
          expect: 1150,
        },
      ],
      outputs: [{ path: "expected.pdf" }],
    });

    expect(result.isError).toBe(true);
    expect(said(result)).toContain(
      "dimension 1 is 1200 on the part, where 1150 was expected",
    );
    await expect(readFile(join(workspace, "expected.pdf"))).rejects.toThrow();
  });

  it("refuses an object the scene does not have, and writes nothing", async () => {
    const result = await call(drawing, "cad_draw", {
      scene: true,
      objects: ["Sofa"],
      outputs: [{ path: "sofa.pdf" }],
    });

    expect(result.isError).toBe(true);
    expect(said(result)).toContain("Sofa");
    await expect(readFile(join(workspace, "sofa.pdf"))).rejects.toThrow();
  });

  it("leaves a view's hidden edges out when it is given hidden: false", async () => {
    // The back legs stand behind the front ones, and the cable hole runs through the top unseen.
    const hiddenOn = async (path: string) =>
      (await readFile(join(workspace, path), "utf8")).match(
        /\n\s*8\r?\nHIDDEN\r?\n/g,
      )?.length ?? 0;

    const dashed = await call(drawing, "cad_draw", {
      scene: true,
      views: [{ view: "front" }],
      outputs: [{ path: "dashed.dxf" }],
    });
    const plain = await call(drawing, "cad_draw", {
      scene: true,
      views: [{ view: "front", hidden: false }],
      outputs: [{ path: "plain.dxf" }],
    });

    expect(dashed.isError, said(dashed)).toBeUndefined();
    expect(plain.isError, said(plain)).toBeUndefined();
    expect(await hiddenOn("dashed.dxf")).toBeGreaterThan(0);
    expect(await hiddenOn("plain.dxf")).toBe(0);
  });

  // Opens a scene of its own, so it comes after the table's tests.
  it("draws a room's plan, cut through its walls, and two elevations, its walls dimensioned from their corners", async () => {
    const wall = (name: string, size: number[], location: number[]) => ({
      name,
      kind: "cube",
      size,
      location,
    });
    // A room 4 × 3 m inside, walls 200 mm thick and 2.5 m high, the side
    // walls between the long ones, and a door 900 mm wide in the south wall.
    const steps = [
      await call(studio, "blender_open_scene", {
        path: "room.blend",
        create: true,
      }),
      await call(studio, "blender_add_objects", {
        objects: [
          wall("Wall S", [4.4, 0.2, 2.5], [0, -1.6, 1.25]),
          wall("Wall N", [4.4, 0.2, 2.5], [0, 1.6, 1.25]),
          wall("Wall W", [0.2, 3, 2.5], [-2.1, 0, 1.25]),
          wall("Wall E", [0.2, 3, 2.5], [2.1, 0, 1.25]),
        ],
      }),
      await call(studio, "blender_shape_objects", {
        object: "Wall S",
        operations: [
          {
            kind: "boolean",
            operation: "difference",
            cutter: {
              shape: "box",
              size: [0.9, 0.4, 2.1],
              location: [-0.8, -1.6, 1.05],
            },
          },
        ],
      }),
    ];
    for (const step of steps) expect(step.isError, said(step)).toBeUndefined();
    const corner = [-2000, -1500, 1200];

    const result = await call(drawing, "cad_draw", {
      scene: true,
      objects: ["Wall S", "Wall N", "Wall W", "Wall E"],
      views: [
        { section: "A", looking: "top", through: [0, 0, 1200] },
        { view: "front" },
        { view: "right" },
      ],
      dimensions: [
        {
          view: "A",
          kind: "length",
          from: corner,
          to: [2000, -1500, 1200],
          expect: 4000,
        },
        {
          view: "A",
          kind: "length",
          from: corner,
          to: [-2000, 1500, 1200],
          expect: 3000,
        },
        {
          view: "A",
          kind: "length",
          from: [2000, 1500, 1200],
          to: [2200, 1500, 1200],
          expect: 200,
        },
        {
          view: "A",
          kind: "length",
          from: [-1250, -1500, 1200],
          to: [-350, -1500, 1200],
          expect: 900,
        },
        {
          view: "front",
          kind: "length",
          from: [-1250, -1700, 0],
          to: [-1250, -1700, 2100],
          expect: 2100,
        },
      ],
      outputs: [{ path: "room.pdf" }, { path: "room.dxf" }],
    });

    expect(result.isError, said(result)).toBeUndefined();
    expect(said(result)).toContain("Dimensions on A: 4000, 3000, 200, 900.");
    expect(said(result)).toContain("Dimensions on front: 2100.");
    expect(said(result)).toContain("Drew A3 landscape");
    expect(
      (await readFile(join(workspace, "room.pdf"))).subarray(0, 5).toString(),
    ).toBe("%PDF-");
    // The walls the plan cuts are hatched: lines on the hatch layer (group code 8).
    expect(await readFile(join(workspace, "room.dxf"), "utf8")).toMatch(
      /\n\s*8\r?\nHATCH\r?\n/,
    );
  });

  // Opens a scene of its own, so it comes after the table's tests.
  it("shows what stands in a room whose walls are one outline, the plan cutting them as a ring", async () => {
    // The walls as the interiors skill draws them: one outline of the whole
    // plan, 200 mm thick, the room its hole; a cabinet in the room.
    const steps = [
      await call(studio, "blender_open_scene", {
        path: "ring.blend",
        create: true,
      }),
      await call(studio, "blender_add_objects", {
        objects: [
          {
            name: "Walls",
            kind: "outline",
            points: [
              [-2.2, -1.7],
              [2.2, -1.7],
              [2.2, 1.7],
              [-2.2, 1.7],
            ],
            holes: [
              [
                [-2, -1.5],
                [2, -1.5],
                [2, 1.5],
                [-2, 1.5],
              ],
            ],
            height: 2.5,
          },
          {
            name: "Cabinet",
            kind: "cube",
            size: [0.8, 0.6, 0.8],
            location: [0.5, 0.5, 0.4],
          },
        ],
      }),
    ];
    for (const step of steps) expect(step.isError, said(step)).toBeUndefined();

    const result = await call(drawing, "cad_draw", {
      scene: true,
      views: [
        { section: "A", looking: "top", through: [0, 0, 1200] },
        { view: "front" },
      ],
      dimensions: [
        {
          view: "A",
          kind: "length",
          from: [-2000, -1500, 1200],
          to: [2000, -1500, 1200],
          expect: 4000,
        },
        // The cabinet, below the cut, inside the ring of walls.
        {
          view: "A",
          kind: "length",
          from: [100, 200, 800],
          to: [900, 200, 800],
          expect: 800,
        },
      ],
      outputs: [{ path: "ring.pdf" }],
    });

    expect(result.isError, said(result)).toBeUndefined();
    expect(said(result)).toContain("Dimensions on A: 4000, 800.");
  });

  // Opens a scene of its own, so it comes after the table's tests.
  it("draws what a scene places as instances: a collection's copies and those geometry nodes make", async () => {
    // A seat 450 mm square kept in a collection and placed twice, 1 m
    // apart; and stools 200 mm across that geometry nodes set 500 mm apart.
    const steps = [
      await call(studio, "blender_open_scene", {
        path: "instances.blend",
        create: true,
      }),
      await call(studio, "blender_run_script", {
        code: [
          "import bpy",
          "scene = bpy.context.scene",
          'parts = bpy.data.collections.new("Chair parts")',
          'seat = bpy.data.objects.new("Seat", bpy.data.meshes.new("Seat"))',
          "import bmesh",
          "shape = bmesh.new()",
          "bmesh.ops.create_cube(shape, size=0.45)",
          "bmesh.ops.translate(shape, verts=shape.verts, vec=(0, 0, 0.225))",
          "shape.to_mesh(seat.data)",
          "parts.objects.link(seat)",
          'for name, x in (("Chair 1", 1.0), ("Chair 2", 2.0)):',
          "    placed = bpy.data.objects.new(name, None)",
          '    placed.instance_type = "COLLECTION"',
          "    placed.instance_collection = parts",
          "    placed.location = (x, 0, 0)",
          "    scene.collection.objects.link(placed)",
          'stools = bpy.data.objects.new("Stools", bpy.data.meshes.new("Stools"))',
          "scene.collection.objects.link(stools)",
          'tree = bpy.data.node_groups.new("Stools", "GeometryNodeTree")',
          'tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")',
          'line = tree.nodes.new("GeometryNodeMeshLine")',
          'line.inputs["Count"].default_value = 3',
          'line.inputs["Offset"].default_value = (0.5, 0, 0)',
          'cube = tree.nodes.new("GeometryNodeMeshCube")',
          'cube.inputs["Size"].default_value = (0.2, 0.2, 0.4)',
          'on_points = tree.nodes.new("GeometryNodeInstanceOnPoints")',
          'group_out = tree.nodes.new("NodeGroupOutput")',
          'tree.links.new(line.outputs["Mesh"], on_points.inputs["Points"])',
          'tree.links.new(cube.outputs["Mesh"], on_points.inputs["Instance"])',
          'tree.links.new(on_points.outputs["Instances"], group_out.inputs["Geometry"])',
          'stools.modifiers.new("Stools", "NODES").node_group = tree',
          "stools.location = (0, 1, 0.2)",
        ].join("\n"),
      }),
    ];
    for (const step of steps) expect(step.isError, said(step)).toBeUndefined();

    const result = await call(drawing, "cad_draw", {
      scene: true,
      views: [
        { view: "top" },
        { section: "A", looking: "front", through: [0, 0, 200] },
      ],
      dimensions: [
        // From the first chair's left edge to the second's right.
        {
          view: "top",
          kind: "length",
          from: [775, -225, 450],
          to: [2225, -225, 450],
          expect: 1450,
        },
        // Across the last stool.
        {
          view: "top",
          kind: "length",
          from: [900, 900, 400],
          to: [1100, 900, 400],
          expect: 200,
        },
        // The section cuts both seats.
        {
          view: "A",
          kind: "length",
          from: [775, 0, 450],
          to: [2225, 0, 450],
          expect: 1450,
        },
      ],
      outputs: [{ path: "instances.pdf" }, { path: "instances.dxf" }],
    });

    expect(result.isError, said(result)).toBeUndefined();
    expect(said(result)).toContain("Dimensions on top: 1450, 200.");
    expect(said(result)).toContain("Dimensions on A: 1450.");
    expect(await readFile(join(workspace, "instances.dxf"), "utf8")).toMatch(
      /\n\s*8\r?\nHATCH\r?\n/,
    );
  });

  it("draws a row of blades turned into a section's plane, each whole from hub to tip on both sides of the axis", async () => {
    // A drum 100 mm across along y, and six flat blades round it from 50 to
    // 110 mm out, 30 mm along the axis, as a rotor's row stands.
    const blades = Array.from({ length: 6 }, (_, k) => {
      const turn = (Math.PI / 3) * k;
      return {
        name: `Blade ${k + 1}`,
        kind: "cube",
        size: [0.002, 0.03, 0.06],
        location: [0.08 * Math.sin(turn), 0, 0.08 * Math.cos(turn)],
        rotation: [0, 60 * k, 0],
      };
    });
    const steps = [
      await call(studio, "blender_open_scene", {
        path: "rotor.blend",
        create: true,
      }),
      await call(studio, "blender_add_objects", {
        objects: [
          {
            name: "Drum",
            kind: "cylinder",
            size: [0.1, 0.1, 0.1],
            location: [0, 0, 0],
            rotation: [90, 0, 0],
          },
          ...blades,
        ],
      }),
    ];
    for (const step of steps) expect(step.isError, said(step)).toBeUndefined();

    const result = await call(drawing, "cad_draw", {
      scene: true,
      views: [
        { view: "front" },
        {
          section: "A",
          looking: "right",
          through: [0, 0, 0],
          revolved: blades.map((blade) => blade.name),
          axis: { through: [0, 0, 0], along: [0, 1, 0] },
        },
      ],
      dimensions: [
        // Root to tip above the axis, and tip to tip across it.
        {
          view: "A",
          kind: "length",
          from: [0, -15, 110],
          to: [0, -15, 50],
          direction: "vertical",
          expect: 60,
        },
        {
          view: "A",
          kind: "length",
          from: [0, 15, 110],
          to: [0, 15, -110],
          direction: "vertical",
          expect: 220,
        },
      ],
      outputs: [{ path: "rotor.pdf" }],
    });

    expect(result.isError, said(result)).toBeUndefined();
    expect(said(result)).toMatch(/Dimensions on A: (59\.99|60), 220(\.01)?\./);
  });
});
