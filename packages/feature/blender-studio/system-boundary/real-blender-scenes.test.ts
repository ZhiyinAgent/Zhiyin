/**
 * The studio against a real Blender, on scenes of its own: exports, colours
 * and descriptions of large scenes, attachments, a scene file damaged on disk,
 * and a model's own object named like the product backdrop.
 *
 * Skipped unless Blender is named in the environment, as the main real-Blender
 * suite is:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
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
  content: { type: string; text?: string; data?: string }[];
};

/** The names of the objects an OBJ file holds, by its `o` lines. */
function objectsInObj(text: string): string[] {
  return [...text.matchAll(/^o (.+)$/gm)].map((match) => match[1]!.trim());
}

/** The names of the nodes a GLB file holds, from its JSON chunk. */
function nodesInGlb(glb: Buffer): string[] {
  const length = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + length).toString("utf8")) as {
    nodes?: { name?: string }[];
  };
  return (json.nodes ?? []).map((node) => node.name ?? "");
}

/** A colour said as #rrggbb, as its three channels. */
function channels(hex: string): [number, number, number] {
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

describe.runIf(blender)("a real Blender, on scenes of its own", () => {
  const folders = new TemporaryFolders();
  let root: string;
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };

  beforeAll(async () => {
    root = await folders.make("zhiyin-studio-scenes-");
    workspace = join(root, "workspace");
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
    tools = sceneAutomation(scenes.scene("scenes"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("scenes"),
    });
  });

  afterAll(async () => {
    await scenes.forget("scenes");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("exports an object with a hole without its cutter, and a default export without the parts the model hid", async () => {
    await call("blender_open_scene", { path: "holed.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Plate", kind: "cube", size: [0.08, 0.04, 0.006] }],
    });
    const shaped = await call("blender_shape_objects", {
      object: "Plate",
      operations: [
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "cylinder",
            diameter: 0.01,
            depth: 0.02,
            location: [0, 0, 0],
          },
        },
      ],
    });
    expect(shaped.said).toContain("a round hole 10 mm across");
    await call("blender_add_objects", {
      objects: [
        {
          name: "Lid",
          kind: "cube",
          size: [0.02, 0.02, 0.004],
          location: [0.03, 0, 0.005],
          parent: "Plate",
        },
      ],
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Lid", hidden: true }],
    });

    const glb = await call("blender_export", {
      output: "named.glb",
      objects: ["Plate"],
    });
    await call("blender_export", { output: "named.obj", objects: ["Plate"] });
    await call("blender_export", { output: "named.fbx", objects: ["Plate"] });
    await call("blender_export", { output: "all.obj" });

    expect(glb.isError).toBeUndefined();
    expect(
      nodesInGlb(await readFile(join(workspace, "named.glb"))).filter((name) =>
        /cutter/i.test(name),
      ),
    ).toEqual([]);
    expect(
      objectsInObj(await readFile(join(workspace, "named.obj"), "utf8")),
    ).not.toContainEqual(expect.stringMatching(/cutter/i));
    expect(
      (await readFile(join(workspace, "named.fbx"))).includes("cutter"),
    ).toBe(false);
    const everything = objectsInObj(
      await readFile(join(workspace, "all.obj"), "utf8"),
    );
    expect(everything).toContain("Plate");
    expect(everything).not.toContainEqual(expect.stringMatching(/cutter/i));
    expect(everything).not.toContain("Lid");
  });

  it("says the colour of every object in a render of more than 63 of them", async () => {
    await call("blender_open_scene", { path: "many.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Floor",
          kind: "cube",
          size: [1, 1, 0.02],
          location: [0, 0, 0],
        },
      ],
    });
    // Drawn objects outside the picture, ahead of the last one in the scene.
    await call("blender_run_script", {
      code: [
        "import bpy",
        "for n in range(68):",
        "    bpy.ops.mesh.primitive_cube_add(size=0.05, location=(50 + n, 0, 0))",
        "    bpy.context.object.name = f'Far {n}'",
      ].join("\n"),
    });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Blocker",
          kind: "cube",
          size: [0.9, 0.9, 0.02],
          location: [0, 0, 0.05],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Floor"],
      material: { name: "Grey", color: "#808080", roughness: 0.8 },
    });
    await call("blender_set_material", {
      objects: ["Blocker"],
      material: { name: "Red", color: "#c0392b", roughness: 0.8 },
    });
    await call("blender_set_lighting", { preset: "studio" });
    await call("blender_set_camera", {
      frame: { objects: ["Floor"], direction: "top", margin: 0.05 },
      resolution: [160, 160],
    });

    const rendered = await call("blender_render", {
      output: "renders/many.png",
      engine: "eevee",
    });

    expect(rendered.isError).toBeUndefined();
    const blocker = /Blocker #([0-9a-f]{6})/.exec(rendered.said)?.[1];
    const floor = /Floor #([0-9a-f]{6})/.exec(rendered.said)?.[1];
    expect(blocker).toBeDefined();
    expect(floor).toBeDefined();
    const [red, green, blue] = channels(blocker!);
    expect(red).toBeGreaterThan(green * 1.5);
    expect(red).toBeGreaterThan(blue * 1.5);
    const [floorRed, floorGreen, floorBlue] = channels(floor!);
    expect(Math.max(floorRed, floorGreen, floorBlue)).toBeLessThan(
      Math.min(floorRed, floorGreen, floorBlue) * 1.2,
    );
  });

  it("says the colours of a render whose scene sets its own white balance, display and file colour", async () => {
    await call("blender_open_scene", { path: "graded.blend", create: true });
    await call("blender_run_script", {
      code: [
        "import bpy",
        "for n in range(12):",
        "    bpy.ops.mesh.primitive_cube_add(size=0.05, location=(50 + n, 0, 0))",
        "    bpy.context.object.name = f'Far {n}'",
      ].join("\n"),
    });
    await call("blender_add_objects", {
      objects: [
        { name: "Floor", kind: "cube", size: [1, 1, 0.02] },
        {
          name: "Blocker",
          kind: "cube",
          size: [0.5, 0.5, 0.02],
          location: [0, 0, 0.05],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Blocker"],
      material: { name: "Red", color: "#c0392b", roughness: 0.8 },
    });
    await call("blender_set_lighting", { preset: "studio" });
    await call("blender_set_camera", {
      frame: { objects: ["Floor"], direction: "top", margin: 0.05 },
      resolution: [160, 160],
    });
    await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "s.view_settings.use_white_balance = True",
        "s.view_settings.white_balance_temperature = 5500",
        "s.view_settings.use_curve_mapping = True",
        "s.display_settings.display_device = 'Display P3'",
        "s.render.image_settings.color_depth = '16'",
        "s.render.image_settings.color_management = 'OVERRIDE'",
      ].join("\n"),
    });

    const rendered = await call("blender_render", {
      output: "renders/graded.png",
      engine: "eevee",
    });

    expect(rendered.said).not.toContain("could not be read");
    expect(rendered.said).toMatch(/Blocker #[0-9a-f]{6}/);
    expect(rendered.said).toMatch(/Floor #[0-9a-f]{6}/);
  });

  it("refuses to export only a hole's cutter, which is never exported", async () => {
    await call("blender_open_scene", { path: "cut.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Plate", kind: "cube", size: [0.08, 0.04, 0.006] }],
    });
    await call("blender_shape_objects", {
      object: "Plate",
      operations: [
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "cylinder",
            diameter: 0.01,
            depth: 0.02,
            location: [0, 0, 0],
          },
        },
      ],
    });

    const exported = await call("blender_export", {
      output: "cutter.glb",
      objects: ["Plate cutter 1"],
    });

    expect(exported.isError).toBe(true);
    expect(exported.said).toContain("cutter");
    expect(exported.said).not.toContain("Exported");
  });

  it("describes a scene of 600 parts within the time limit, saying what goes into what", async () => {
    await call("blender_open_scene", { path: "crowded.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Floor",
          kind: "cube",
          size: [40, 40, 0.1],
          location: [0, 0, -0.05],
        },
      ],
    });
    // Posts stand 5 mm into the floor, each well clear of the others.
    const added = await call("blender_run_script", {
      code: [
        "import bpy",
        "for n in range(600):",
        "    x, y = n % 25 - 12, n // 25 - 12",
        "    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=1, vertices=16, location=(x * 0.8, y * 0.8, 0.495))",
        "    bpy.context.object.name = f'Post {n}'",
      ].join("\n"),
    });
    expect(added.isError).toBeUndefined();

    const described = await call("blender_describe_scene", {});

    expect(described.isError).toBeUndefined();
    expect(described.said).toContain("Objects (601):");
    const into = described.said
      .split("\n")
      .filter((line) => line.startsWith("- Post "));
    expect(into).toHaveLength(600);
    // Each says it is set into the floor, or, past the time the checks have
    // on a busy machine, is named as not checked.
    const unchecked =
      /\nNot checked for pieces nothing holds, for want of time: ([^\n]*)\./.exec(
        described.said,
      )?.[1] ?? "";
    for (const line of into) {
      const name = /^- (Post \d+):/.exec(line)?.[1] ?? "";
      if (!line.endsWith(" · set into Floor"))
        expect(unchecked.split(", ")).toContain(name);
    }
    expect(
      into.filter((line) => line.endsWith(" · set into Floor")).length,
    ).toBeGreaterThan(0);
    // So many going into one are said together, the deepest measured at
    // points over each shape, so about 5 mm.
    expect(described.said).toMatch(
      /\n- 600 objects go into Floor: Post ×600, the deepest Post \d+ by [45](\.\d+)? mm\./,
    );
  });

  it("names the shapes still as adding made them: resized or later bevelled ones stay, an extruded one or one given another step leaves", async () => {
    await call("blender_open_scene", { path: "as-added.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Untouched", kind: "cube", size: [0.1, 0.1, 0.1] },
        {
          name: "Rounded",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [0.3, 0, 0],
          bevel: { width: 0.005 },
        },
        {
          name: "Pen",
          kind: "cylinder",
          size: [0.01, 0.01, 0.14],
          location: [0.6, 0, 0],
        },
        {
          name: "Extruded",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [0.9, 0, 0],
        },
        {
          name: "Smoothed",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [1.2, 0, 0],
        },
        {
          name: "Bevelled later",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [1.5, 0, 0],
        },
      ],
    });
    const resized = await call("blender_edit_objects", {
      edits: [
        { object: "Rounded", size: [0.3, 0.1, 0.05] },
        { object: "Pen", size: [0.02, 0.01, 0.1] },
      ],
    });
    expect(resized.isError).toBeUndefined();
    const extruded = await call("blender_run_script", {
      code: 'zhiyin.extrude(zhiyin.pick("Extruded", facing="+z"), 0.05)',
    });
    expect(extruded.isError).toBeUndefined();
    await call("blender_shape_objects", {
      object: "Smoothed",
      operations: [{ kind: "subdivision", levels: 1 }],
    });
    const bevelled = await call("blender_shape_objects", {
      object: "Bevelled later",
      operations: [{ kind: "bevel", width: 0.004 }],
    });
    expect(bevelled.isError).toBeUndefined();

    const described = await call("blender_describe_scene", {});

    const still =
      described.said
        .split("\n")
        .find((line) => line.startsWith("Still as blender_add_objects")) ?? "";
    expect(still).toContain("(4 of 6 meshes)");
    expect(still).toContain("Untouched (cube)");
    expect(still).toContain("Rounded (cube, bevel)");
    expect(still).toContain("Pen (cylinder)");
    // A bevelled box is still a block-out shape, whichever tool rounded it.
    expect(still).toContain("Bevelled later (cube, bevel)");
    expect(still).not.toContain("Extruded");
    expect(still).not.toContain("Smoothed");
  });

  it("measures sharp edges on each mesh however it was made, names a part pushed into its parent with its material, and says both after a look and a render", async () => {
    await call("blender_open_scene", { path: "form.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Box", kind: "cube", size: [0.1, 0.1, 0.1] },
        {
          name: "Rounded",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [0.3, 0, 0],
          bevel: { width: 0.005 },
        },
        {
          name: "Paper",
          kind: "cube",
          size: [0.21, 0.297, 0.0003],
          location: [0.6, 0, 0],
        },
        {
          name: "Can",
          kind: "cylinder",
          size: [0.066, 0.066, 0.115],
          segments: 32,
          location: [0.9, 0, 0],
        },
        {
          name: "Mug",
          kind: "cylinder",
          size: [0.08, 0.08, 0.1],
          segments: 32,
          location: [0, 0.5, 0.05],
        },
        {
          name: "Handle",
          kind: "tube",
          location: [0, 0, 0],
          parent: "Mug",
          radius: 0.005,
          points: [
            [0.035, 0.5, 0.03],
            [0.065, 0.5, 0.03],
            [0.065, 0.5, 0.07],
            [0.035, 0.5, 0.07],
          ],
        },
        {
          name: "Coffee",
          kind: "cylinder",
          size: [0.07, 0.07, 0.06],
          location: [0, 0.5, 0.05],
          parent: "Mug",
        },
      ],
    });
    // A box a script made and rounded with bmesh, which adding never stamped.
    const scripted = await call("blender_run_script", {
      code: [
        "import bmesh, bpy",
        "shape = bmesh.new()",
        "bmesh.ops.create_cube(shape, size=0.1)",
        "bmesh.ops.bevel(shape, geom=list(shape.edges), offset=0.004, segments=2, profile=0.5, affect='EDGES')",
        "mesh = bpy.data.meshes.new('Scripted')",
        "shape.to_mesh(mesh)",
        "shape.free()",
        "made = bpy.data.objects.new('Scripted', mesh)",
        "made.location = (1.2, 0, 0)",
        "bpy.context.scene.collection.objects.link(made)",
      ].join("\n"),
    });
    expect(scripted.isError, scripted.said).toBeUndefined();
    await call("blender_set_material", {
      objects: ["Mug", "Handle"],
      material: { name: "Ceramic", color: "#eeeeee" },
    });
    await call("blender_set_material", {
      objects: ["Coffee"],
      material: { name: "Coffee", color: "#3a2418" },
    });

    const lineOf = (said: string, start: string) =>
      said.split("\n").find((line) => line.startsWith(start)) ?? "";
    const described = (await call("blender_describe_scene", {})).said;
    const sharp = lineOf(described, "Sharp edges");
    const pushed = lineOf(described, "Pushed into the object");

    // A plain box's twelve 100 mm edges; a can's two rims of 32 sides.
    expect(sharp).toMatch(/\bBox 1\.2 m\b/);
    expect(sharp).toMatch(/\bCan 41\d(\.\d+)? mm\b/);
    // Rounded by a step or in a script's mesh, a box has no sharp edge, and
    // a sheet's rim is too thin to round.
    expect(sharp).not.toContain("Rounded");
    expect(sharp).not.toContain("Scripted");
    expect(sharp).not.toContain("Paper");
    // The handle shares the mug's material; the coffee in it does not.
    expect(pushed).toMatch(/Handle [\d.]+ mm into Mug/);
    expect(pushed).not.toContain("Coffee");

    const looked = await call("blender_look", { objects: ["Mug", "Box"] });
    expect(lineOf(looked.said, "Sharp edges")).toMatch(/\bBox 1\.2 m\b/);
    expect(lineOf(looked.said, "Sharp edges")).not.toContain("Can");
    expect(lineOf(looked.said, "Pushed into the object")).toContain("Handle");
    const rendered = await call("blender_render", {
      output: "form.png",
      view: "plan",
      resolution: [96, 64],
    });
    expect(rendered.isError, rendered.said).toBeUndefined();
    expect(lineOf(rendered.said, "Sharp edges")).toMatch(/\bCan 41\d/);
    expect(lineOf(rendered.said, "Pushed into the object")).toContain("Handle");
  });

  it("counts a mesh's pieces of one material passing into each other, and looks closely first at the objects with them, past the setting", async () => {
    await call("blender_open_scene", { path: "joined.blend", create: true });
    const added = await call("blender_add_objects", {
      objects: [
        { name: "Floor", kind: "plane", size: [4, 4] },
        {
          name: "Table",
          kind: "cube",
          size: [1.2, 0.8, 0.04],
          location: [0, 0, 0.73],
        },
        {
          name: "Mug",
          kind: "cylinder",
          size: [0.08, 0.08, 0.1],
          segments: 32,
          location: [0.2, 0, 0.8],
        },
        {
          name: "Handle",
          kind: "tube",
          location: [0, 0, 0],
          radius: 0.005,
          points: [
            [0.235, 0, 0.78],
            [0.265, 0, 0.78],
            [0.265, 0, 0.82],
            [0.235, 0, 0.82],
          ],
        },
        {
          name: "Pen",
          kind: "cylinder",
          size: [0.01, 0.01, 0.14],
          location: [-0.2, 0, 0.76],
          rotation: [0, 90, 0],
        },
        {
          name: "Cap",
          kind: "cylinder",
          size: [0.012, 0.012, 0.04],
          location: [-0.26, 0, 0.76],
          rotation: [0, 90, 0],
        },
        {
          name: "Box",
          kind: "cube",
          size: [0.2, 0.15, 0.1],
          location: [-0.1, 0.25, 0.8],
        },
      ],
    });
    expect(added.isError, added.said).toBeUndefined();
    await call("blender_set_material", {
      objects: ["Mug", "Handle", "Pen"],
      material: { name: "Ceramic", color: "#eeeeee" },
    });
    await call("blender_set_material", {
      objects: ["Cap"],
      material: { name: "Cap blue", color: "#2244aa" },
    });
    // Joined as a script joins meshes: each pair becomes one mesh of two pieces.
    const joined = await call("blender_run_script", {
      code: [
        "import bpy",
        "for keep, into in (('Mug', 'Handle'), ('Pen', 'Cap')):",
        "    o = bpy.data.objects",
        "    with bpy.context.temp_override(active_object=o[keep], selected_editable_objects=[o[keep], o[into]]):",
        "        bpy.ops.object.join()",
      ].join("\n"),
    });
    expect(joined.isError, joined.said).toBeUndefined();
    await call("blender_set_camera", {
      location: [0, -1.4, 1.4],
      look_at: [0, 0, 0.75],
    });

    const looked = await call("blender_look", { objects: ["Mug", "Pen"] });
    const lineOf = (name: string) =>
      looked.said.split("\n").find((line) => line.startsWith(`${name}:`)) ?? "";
    expect(lineOf("Mug")).toMatch(
      /2 pieces.*2 closed pieces of one material passing into each other by up to [\d.]+ mm, as two meshes joined into one leave them/,
    );
    // The pen's cap is of another material: two pieces, neither said to pass.
    expect(lineOf("Pen")).toContain("2 pieces");
    expect(lineOf("Pen")).not.toContain("passing into each other");

    const close = await call("blender_close_ups", { main: 2 });
    expect(close.isError, close.said).toBeUndefined();
    const shown = [...close.said.matchAll(/^- ([A-Za-z]+):/gm)].map(
      (found) => found[1],
    );
    // The mug first, for its joined pieces; the table and floor are the setting.
    expect(shown[0]).toBe("Mug");
    expect(shown).toHaveLength(2);
    expect(shown).not.toContain("Table");
    expect(shown).not.toContain("Floor");
  });

  it("refuses to attach an object to itself or to one of its own parts, and leaves the scene as it was", async () => {
    await call("blender_open_scene", { path: "attached.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "A", kind: "cube", size: [0.02, 0.02, 0.02] },
        {
          name: "B",
          kind: "cube",
          size: [0.01, 0.01, 0.01],
          location: [0.03, 0, 0],
          parent: "A",
        },
      ],
    });

    const loop = await call("blender_edit_objects", {
      edits: [{ object: "A", parent: "B" }],
    });
    const itself = await call("blender_edit_objects", {
      edits: [{ object: "A", parent: "A" }],
    });
    const added = await call("blender_add_objects", {
      objects: [
        { name: "C", kind: "cube", size: [0.01, 0.01, 0.01], parent: "C" },
      ],
    });
    const described = await call("blender_describe_scene", {
      objects: ["A", "B"],
    });

    expect(loop.isError).toBe(true);
    expect(loop.said).toContain(
      "“A” cannot be attached to “B”, which is attached to it.",
    );
    expect(itself.isError).toBe(true);
    expect(itself.said).toContain("“A” cannot be attached to itself.");
    expect(added.isError).toBe(true);
    expect(added.said).toContain("“C” cannot be attached to itself.");
    for (const said of [loop.said, itself.said, added.said])
      expect(said).not.toMatch(/Error:|Traceback/);
    expect(described.said).toContain("attached to A");
    expect(described.said).not.toMatch(/^- A .*attached to/m);
  });

  it("says a model's own object named Backdrop keeps its material, and a default export takes it and not the preset's backdrop", async () => {
    await call("blender_open_scene", { path: "backdrop.blend", create: true });
    const made = await call("blender_add_objects", {
      objects: [
        { name: "Backdrop", kind: "cube", size: [0.4, 0.4, 0.005] },
        {
          name: "Mug",
          kind: "cylinder",
          size: [0.08, 0.08, 0.1],
          location: [0, 0, 0.05],
        },
      ],
    });
    expect(made.isError).toBeUndefined();
    await call("blender_set_material", {
      objects: ["Backdrop"],
      material: { name: "Red sweep", color: "#c0392b" },
    });
    await call("blender_set_lighting", { preset: "product" });
    const reflections = await call("blender_set_lighting", {
      backdrop_reflections: 0.5,
    });
    const described = await call("blender_describe_scene", {
      objects: ["Backdrop"],
    });
    const exported = await call("blender_export", { output: "all.obj" });

    expect(reflections.isError).toBeUndefined();
    expect(described.said).toContain("material Red sweep");
    expect(exported.isError).toBeUndefined();
    const names = objectsInObj(
      await readFile(join(workspace, "all.obj"), "utf8"),
    );
    expect(names).toContain("Backdrop");
    expect(names).toContain("Mug");
    expect(names).not.toContainEqual(expect.stringMatching(/^Backdrop\./));
  });

  it("exports USD to a workspace on another drive than Zhiyin's data, copying the file where it cannot be moved", async () => {
    await call("blender_open_scene", { path: "usd.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Box", kind: "cube", size: [0.05, 0.05, 0.05] }],
    });
    // Windows refuses to move a file to another drive; here every move out
    // of Blender's own folders is refused the same way.
    const refusing = await call("blender_run_script", {
      code: [
        "import os, tempfile, builtins",
        "moved = os.replace",
        "def across_drives(source, target, *rest, **named):",
        "    if os.path.abspath(str(source)).lower().startswith(tempfile.gettempdir().lower()) and not os.path.abspath(str(target)).lower().startswith(tempfile.gettempdir().lower()):",
        "        raise OSError(18, 'The system cannot move the file to a different disk drive', str(source), 17, str(target))",
        "    return moved(source, target, *rest, **named)",
        "builtins.zhiyin_moved = moved",
        "os.replace = across_drives",
      ].join("\n"),
    });
    expect(refusing.isError).toBeUndefined();
    let exported;
    try {
      exported = await call("blender_export", {
        output: "box.usda",
        objects: ["Box"],
      });
    } finally {
      await call("blender_run_script", {
        code: "import os, builtins\nos.replace = builtins.zhiyin_moved",
      });
    }

    expect(exported.isError).toBeUndefined();
    expect(await readFile(join(workspace, "box.usda"), "utf8")).toContain(
      "Box",
    );
  });

  it("answers when the open scene file changed on disk into one Blender cannot load, without starting Blender again", async () => {
    await call("blender_open_scene", { path: "damaged.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Cube", kind: "cube", size: [0.05, 0.05, 0.05] }],
    });
    await writeFile(join(workspace, "damaged.blend"), "not a scene");

    const described = await call("blender_describe_scene", {});
    const opened = await call("blender_open_scene", {
      path: "fresh.blend",
      create: true,
    });

    expect(described.isError).toBe(true);
    expect(described.said).toContain(
      "damaged.blend changed on disk and could not be loaded",
    );
    expect(described.said).toContain("No scene is open.");
    expect(described.said).not.toMatch(/Blender stopped|Traceback/);
    // Blender's reason, without the path where the file is.
    expect(described.said).not.toContain(workspace);
    expect(opened.isError).toBeUndefined();
    expect(opened.said).toContain("Created fresh.blend");
  });

  it("packs each picture into the scene file as it saves, again when the picture's file changes, and keeps it when the file is gone", async () => {
    const opened = await call("blender_open_scene", {
      path: "packed.blend",
      create: true,
    });
    expect(opened.isError, opened.said).toBeUndefined();
    /** Saves a square picture of one colour as wall.png in the workspace. */
    const wall = (size: number, rgb: string) => `
import bpy
img = bpy.data.images.new("drawn", ${size}, ${size})
img.generated_color = (${rgb}, 1)
img.filepath_raw = bpy.path.abspath("//wall.png")
img.file_format = "PNG"
img.save()
bpy.data.images.remove(img)
`;
    const kept = `
import bpy
img = next(i for i in bpy.data.images if i.filepath.endswith("wall.png"))
print("packed", img.packed_file is not None, "size", img.size[0], "path", bpy.path.basename(img.filepath))
`;
    await call("blender_run_script", { code: wall(8, "1, 0, 0") });
    await call("blender_add_objects", {
      objects: [{ name: "Wall", kind: "cube", size: [1, 1, 1] }],
    });
    const laid = await call("blender_set_material", {
      objects: ["Wall"],
      material: { name: "Papered", texture: { path: "wall.png" } },
    });
    const first = await call("blender_run_script", { code: kept });
    await call("blender_run_script", { code: wall(16, "0, 0, 1") });
    const again = await call("blender_run_script", { code: kept });
    await rm(join(workspace, "wall.png"));
    const reopened = await call("blender_open_scene", { path: "packed.blend" });
    const gone = await call("blender_run_script", { code: kept });
    const described = await call("blender_describe_scene", {
      objects: ["Wall"],
    });

    expect(laid.isError, laid.said).toBeUndefined();
    expect(first.said).toContain("packed True size 8 path wall.png");
    // Changed on disk, the picture is packed again as its file now holds it.
    expect(again.said).toContain("packed True size 16 path wall.png");
    // With its file gone, the scene file still holds the picture.
    expect(reopened.isError, reopened.said).toBeUndefined();
    expect(gone.said).toContain("packed True size 16 path wall.png");
    expect(described.said).toContain("picture wall.png");
    expect(described.said).not.toContain("missing");
  });

  it("says nothing of putting the scene back when a failed script removed the scene file", async () => {
    await call("blender_open_scene", { path: "removed.blend", create: true });

    const failed = await call("blender_run_script", {
      code: [
        "import os, bpy",
        "os.remove(bpy.data.filepath)",
        "raise ValueError('stop here')",
      ].join("\n"),
    });
    const next = await call("blender_add_objects", {
      objects: [{ name: "Cube", kind: "cube", size: [0.05, 0.05, 0.05] }],
    });

    expect(failed.said).toContain("ValueError: stop here");
    expect(failed.said).not.toContain("could not put the scene back");
    expect(next.said).toContain("removed.blend no longer exists");
  });

  it.each([
    [
      "it is no longer a scene",
      (path: string) => writeFile(path, "not a scene"),
    ],
    ["it is gone", (path: string) => rm(path)],
  ])(
    "shows no scene of Blender's own when the scene file cannot be opened again in a Blender started anew, as when %s",
    async (_case, lose) => {
      await call("blender_open_scene", { path: "lost.blend", create: true });
      const session = scenes.scene("scenes");
      await session.close();
      await lose(join(workspace, "lost.blend"));

      const described = await call("blender_describe_scene", {});
      const before = session.state().preview?.sequence ?? 0;
      session.look({ kind: "turn", yaw: 15, pitch: 0 });
      for (
        let tries = 0;
        tries < 600 && (session.state().preview?.sequence ?? 0) <= before;
        tries++
      )
        await new Promise((resolve) => setTimeout(resolve, 100));

      expect(described.said).toContain("lost.blend could not be opened again");
      expect(await session.sceneIn(workspace)).toBeUndefined();
      // Blender's own startup cube, camera and light are not drawn.
      expect(session.state().preview?.empty).toBe(true);
    },
  );
});
