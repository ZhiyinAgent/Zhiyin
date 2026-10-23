/**
 * The studio against a real Blender, on scenes of its own: exports, colours
 * and descriptions of large scenes, attachments, a scene file damaged on disk,
 * and a model's own object named like the product backdrop.
 *
 * Skipped unless Blender is named in the environment, as the main real-Blender
 * suite is:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/blender-studio
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { openProcessContainer } from "@zhiyin/process-ownership";
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
    expect(shaped.said).toContain("a 10 mm round hole");
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
    // Measured at points over each shape, so about 5 mm.
    for (const line of into)
      expect(line).toMatch(/goes [45](\.\d+)? mm into Floor/);
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
      expect(session.scene()).toBeUndefined();
      // Blender's own startup cube, camera and light are not drawn.
      expect(session.state().preview?.empty).toBe(true);
    },
  );
});
