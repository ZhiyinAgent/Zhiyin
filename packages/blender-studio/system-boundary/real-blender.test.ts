/**
 * The studio against a real Blender.
 *
 * The other tests use a stand-in that speaks the session's protocol, which
 * proves the lifecycle and the approvals but not that Blender does what the
 * script asks. These run the session script in a real Blender, started
 * contained and reached over its pipes. They are skipped unless Blender is
 * named in the environment, because the gate installs nothing:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/blender-studio
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScenePreview } from "@zhiyin/contract";
import {
  openProcessContainer,
  openToLowIntegrity,
} from "@zhiyin/process-ownership";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
  workspaceOpening,
} from "../src/index.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};

describe.runIf(blender)("a real Blender", () => {
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
    root = await mkdtemp(join(tmpdir(), "zhiyin-studio-live-"));
    workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: containedSessionLaunch(
        { open: openProcessContainer },
        openToLowIntegrity,
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("live"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("live"),
      openToBlender: workspaceOpening(openToLowIntegrity),
    });
  });

  afterAll(async () => {
    await scenes.closeAll();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  });

  it("builds a part with a hole, saves it after every change, and keeps previews out of the workspace", async () => {
    expect(
      (await call("blender_open_scene", { path: "part.blend", create: true }))
        .isError,
    ).toBeUndefined();
    await call("blender_add_objects", {
      objects: [{ name: "Plate", kind: "cube", size: [0.08, 0.04, 0.006] }],
    });
    const before = await call("blender_describe_scene", { objects: ["Plate"] });
    const hole = await call("blender_shape_objects", {
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
    const after = await call("blender_describe_scene", { objects: ["Plate"] });

    expect(hole.said).toContain("a 10 mm round hole, 20 mm deep");
    const volume = (text: string) =>
      Number(/closed, ([\d.]+) cm³/.exec(text)?.[1]);
    // 80 × 40 × 6 mm is 19.2 cm³; a 10 mm hole through 6 mm takes 0.47 cm³.
    expect(volume(before.said)).toBeCloseTo(19.2, 1);
    expect(volume(after.said)).toBeCloseTo(19.2 - Math.PI * 0.5 ** 2 * 0.6, 1);

    const preview = scenes.scene("live").state().preview;
    expect(Buffer.from(preview?.data ?? "", "base64").subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8]),
    );
    // Only the scene file: no previews, and no .blend1 backups beside it.
    expect(await readdir(workspace)).toEqual(["part.blend"]);
  });

  it("leaves the saved scene as it was when a script fails halfway", async () => {
    const failed = await call("blender_run_script", {
      code: "import bpy\nbpy.data.objects['Plate'].location.x = 5\nraise ValueError('stop here')",
    });
    const described = await call("blender_describe_scene", {
      objects: ["Plate"],
    });

    expect(failed.isError).toBe(true);
    expect(failed.said).toContain("ValueError: stop here");
    expect(described.said).toContain("at (0, 0, 0 mm)");
  });

  it("says where a failed script stopped by the script's own lines, and nothing of Zhiyin's", async () => {
    const failed = await call("blender_run_script", {
      code: [
        "import bpy",
        "def widths(values):",
        "    return [1 / value for value in values]",
        "sizes = widths([2, 0])",
      ].join("\n"),
    });
    const unfinished = await call("blender_run_script", {
      code: ["import bpy", "sizes = [1, 2"].join("\n"),
    });

    expect(failed.isError).toBe(true);
    expect(failed.said).toContain("ZeroDivisionError: division by zero");
    // How it got there and where it stopped, each line as it was written.
    expect(failed.said).toContain("line 4: sizes = widths([2, 0])");
    expect(failed.said).toContain(
      "line 3, in widths: return [1 / value for value in values]",
    );
    expect(unfinished.said).toMatch(
      /SyntaxError: .+\n\s*line 2: sizes = \[1, 2/,
    );
    // Neither Zhiyin's own code nor the folder it is installed in.
    for (const said of [failed.said, unfinished.said])
      expect(said).not.toMatch(/zhiyin_studio|main\.py|run_script|exec\(/);
  });

  it("loads the scene file again when it changed on disk, as going back in the conversation does", async () => {
    await copyFile(join(workspace, "part.blend"), join(root, "kept.blend"));
    await call("blender_edit_objects", {
      edits: [{ object: "Plate", move_by: [0.1, 0, 0] }],
    });
    await copyFile(join(root, "kept.blend"), join(workspace, "part.blend"));

    const described = await call("blender_describe_scene", {
      objects: ["Plate"],
    });

    expect(described.said).toContain(
      "part.blend changed on disk, so it was loaded again.",
    );
    expect(described.said).toContain("at (0, 0, 0 mm)");
  });

  it("turns the overview for the person without touching the scene file", async () => {
    const saved = (await stat(join(workspace, "part.blend"))).mtimeMs;
    const before = scenes.scene("live").state().preview?.sequence ?? 0;

    scenes.scene("live").look({ kind: "turn", yaw: 90, pitch: 10 });
    await call("blender_api", { name: "Object" });

    expect(scenes.scene("live").state().preview?.sequence ?? 0).toBeGreaterThan(
      before,
    );
    expect((await stat(join(workspace, "part.blend"))).mtimeMs).toBe(saved);
  });

  it("renders a picture into the workspace and shows the model a smaller copy", async () => {
    await call("blender_set_lighting", { preset: "studio" });
    await call("blender_set_camera", {
      frame: { direction: "three-quarter" },
      resolution: [640, 360],
    });
    const rendered = await call("blender_render", {
      output: "renders/plate.png",
      engine: "eevee",
      samples: 8,
    });

    expect(rendered.isError).toBeUndefined();
    expect(
      (await readFile(join(workspace, "renders", "plate.png")))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    expect(rendered.content.some((c) => c.type === "image")).toBe(true);
    // An EEVEE picture is said to be a draft, and what to judge by Cycles.
    expect(rendered.said).toMatch(
      /with EEVEE in [\d.]+ s, .*tone.*\. EEVEE is a quick look at layout and framing: .+ with Cycles\./,
    );
  });

  it("puts a product on a backdrop that fills the picture from every side", async () => {
    await call("blender_set_lighting", { preset: "product" });
    const darkest: Record<string, number> = {};
    for (const direction of ["front", "left", "back"]) {
      await call("blender_set_camera", {
        frame: { direction },
        resolution: [160, 90],
      });
      const output = `renders/backdrop-${direction}.png`;
      await call("blender_render", { output, engine: "eevee", samples: 1 });
      // Blender reads its own picture: the top corners, where the world
      // beyond a backdrop would show.
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          `image = bpy.data.images.load(bpy.path.abspath("//${output}"))`,
          "w, h = image.size",
          "p = image.pixels[:]",
          "lum = lambda x: 0.2126 * p[x] + 0.7152 * p[x + 1] + 0.0722 * p[x + 2]",
          "print('darkest', min(lum(((h - 2) * w + x) * 4) for x in (1, w - 2)))",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      darkest[direction] = Number(/darkest ([\d.]+)/.exec(read.said)?.[1]);
    }
    // The world beyond the backdrop renders at about 0.07; the backdrop's
    // shaded wall at 0.2 or more.
    const scene = (await call("blender_describe_scene", {})).said;
    const backdrop =
      scene.split("\n").find((l) => l.startsWith("- Backdrop:")) ?? "";

    expect(Object.keys(darkest)).toEqual(["front", "left", "back"]);
    for (const value of Object.values(darkest))
      expect(value).toBeGreaterThan(0.15);
    // The backdrop surrounds the product; it does not go into it.
    expect(backdrop).toMatch(/Backdrop/);
    expect(backdrop).not.toMatch(/into/);
  });

  it("renders with Cycles on the graphics card when there is one", async () => {
    const rendered = await call("blender_render", {
      output: "renders/cycles.png",
      engine: "cycles",
      samples: 8,
      resolution: [320, 180],
    });

    expect(rendered.isError).toBeUndefined();
    expect(rendered.said).toMatch(/with Cycles on /);
    expect(rendered.said).not.toContain("quick look");
  });

  it("exports STL for printing in millimetres, with the hole cut", async () => {
    await call("blender_export", { output: "plate.stl", objects: ["Plate"] });
    const stl = await readFile(join(workspace, "plate.stl"));
    const triangles = stl.readUInt32LE(80);
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0; t < triangles; t++)
      for (let v = 0; v < 3; v++) {
        const x = stl.readFloatLE(84 + t * 50 + 12 + v * 12);
        low = Math.min(low, x);
        high = Math.max(high, x);
      }

    expect(high - low).toBeCloseTo(80, 1);
    // A plain box has 12 triangles; the hole adds many more.
    expect(triangles).toBeGreaterThan(12);
  });

  it("writes only the file an export names, and exports a named object even when hidden", async () => {
    await call("blender_set_material", {
      objects: ["Plate"],
      material: {
        name: "Printed",
        color: "#ffffff",
        texture: { path: "renders/plate.png", projection: "front" },
      },
    });
    await mkdir(join(workspace, "out"), { recursive: true });
    await call("blender_export", {
      output: "out/plate.obj",
      objects: ["Plate"],
    });
    await call("blender_export", {
      output: "out/plate.usda",
      objects: ["Plate"],
    });
    const gltf = await call("blender_export", {
      output: "out/plate.gltf",
      objects: ["Plate"],
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Plate", hidden: true }],
    });
    const hidden = await call("blender_export", {
      output: "out/hidden.stl",
      objects: ["Plate"],
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Plate", hidden: false }],
    });

    expect((await readdir(join(workspace, "out"))).sort()).toEqual([
      "hidden.stl",
      "plate.obj",
      "plate.usda",
    ]);
    expect(gltf.isError).toBe(true);
    expect(gltf.said).toMatch(/\.glb/);
    expect(hidden.isError).toBeUndefined();
    const stl = await readFile(join(workspace, "out", "hidden.stl"));
    expect(stl.readUInt32LE(80)).toBeGreaterThan(12);
  });

  it("refuses a model that reads a picture from outside the workspace, and keeps the scene as it was", async () => {
    // A triangle whose material's picture is wherever the uri says.
    const triangle = Buffer.from(
      new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]).buffer,
    ).toString("base64");
    const model = (uri: string) =>
      JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: "Tri" }],
        meshes: [
          { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
        ],
        materials: [
          { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
        ],
        textures: [{ source: 0 }],
        images: [{ uri }],
        buffers: [
          {
            byteLength: 36,
            uri: `data:application/octet-stream;base64,${triangle}`,
          },
        ],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [0, 0, 0],
            max: [0.1, 0.1, 0],
          },
        ],
      });
    await copyFile(
      join(workspace, "renders", "plate.png"),
      join(root, "outside.png"),
    );
    await copyFile(
      join(workspace, "renders", "plate.png"),
      join(workspace, "inside.png"),
    );
    await writeFile(join(workspace, "reaching.gltf"), model("../outside.png"));
    await writeFile(join(workspace, "contained.gltf"), model("inside.png"));
    const before = await call("blender_describe_scene", {});

    const reaching = await call("blender_add_objects", {
      objects: [{ name: "Reaching", kind: "model", path: "reaching.gltf" }],
    });
    const after = await call("blender_describe_scene", {});
    const contained = await call("blender_add_objects", {
      objects: [{ name: "Contained", kind: "model", path: "contained.gltf" }],
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Contained", delete: true }],
    });

    expect(reaching.isError).toBe(true);
    expect(reaching.said).toMatch(/outside the workspace/);
    expect(after.said).toBe(before.said);
    expect(contained.isError).toBeUndefined();
  });

  /**
   * A model file can name other files for its importer to read: a glTF its
   * geometry, an OBJ its materials, a USD file other scenes. Those reads leave
   * no picture behind to find afterwards, so they are refused as they would
   * happen, before the importer reads outside the folder.
   */
  it("refuses a model whose geometry, materials or parts are read from outside the workspace", async () => {
    const triangle = Buffer.from(
      new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]).buffer,
    );
    await writeFile(join(root, "outside.bin"), triangle);
    await writeFile(
      join(workspace, "geometry.gltf"),
      JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: "Tri" }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        buffers: [{ byteLength: 36, uri: "../outside.bin" }],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [0, 0, 0],
            max: [0.1, 0.1, 0],
          },
        ],
      }),
    );
    await writeFile(join(root, "outside.mtl"), "newmtl Red\nKd 1 0 0\n");
    await writeFile(
      join(workspace, "materials.obj"),
      "mtllib ../outside.mtl\nv 0 0 0\nv 0.1 0 0\nv 0 0.1 0\nusemtl Red\nf 1 2 3\n",
    );
    await writeFile(
      join(root, "outside.usda"),
      '#usda 1.0\ndef Mesh "Tri" {\n  point3f[] points = [(0, 0, 0), (0.1, 0, 0), (0, 0.1, 0)]\n  int[] faceVertexCounts = [3]\n  int[] faceVertexIndices = [0, 1, 2]\n}\n',
    );
    await writeFile(
      join(workspace, "parts.usda"),
      '#usda 1.0\ndef Xform "Root" (\n  references = @../outside.usda@</Tri>\n) {\n}\n',
    );
    const before = await call("blender_describe_scene", {});

    const refused = [];
    for (const path of ["geometry.gltf", "materials.obj", "parts.usda"])
      refused.push(
        await call("blender_add_objects", {
          objects: [{ name: "Reaching", kind: "model", path }],
        }),
      );
    const after = await call("blender_describe_scene", {});

    for (const answer of refused) {
      expect(answer.isError).toBe(true);
      expect(answer.said).toMatch(/outside the workspace/);
    }
    expect(after.said).toBe(before.said);
  });

  /**
   * The same reads, named the other ways a file can name a file: by a whole
   * path, through a folder link inside the workspace that leads out of it,
   * and through a material file in the workspace whose picture is not.
   */
  it("refuses a model that reaches outside by a whole path, a folder link, or its material file's picture", async () => {
    const outer = join(root, "outer");
    await mkdir(outer, { recursive: true });
    const triangle = Buffer.from(
      new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]).buffer,
    );
    await writeFile(join(outer, "far.bin"), triangle);
    await writeFile(join(outer, "far.mtl"), "newmtl Red\nKd 1 0 0\n");
    await writeFile(
      join(outer, "far.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    await symlink(outer, join(workspace, "linked"), "junction");
    const whole = (name: string) => join(outer, name).replaceAll("\\", "/");
    const obj = (library: string) =>
      `mtllib ${library}\nv 0 0 0\nv 0.1 0 0\nv 0 0.1 0\nusemtl Red\nf 1 2 3\n`;
    await writeFile(
      join(workspace, "whole.gltf"),
      JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: "Tri" }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        buffers: [{ byteLength: 36, uri: whole("far.bin") }],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [0, 0, 0],
            max: [0.1, 0.1, 0],
          },
        ],
      }),
    );
    await writeFile(join(workspace, "whole.obj"), obj(whole("far.mtl")));
    await writeFile(join(workspace, "linked.obj"), obj("linked/far.mtl"));
    await writeFile(
      join(workspace, "pictured.mtl"),
      "newmtl Red\nKd 1 0 0\nmap_Kd ../outer/far.png\n",
    );
    await writeFile(join(workspace, "pictured.obj"), obj("pictured.mtl"));
    const before = await call("blender_describe_scene", {});

    const answers: Record<string, Awaited<ReturnType<typeof call>>> = {};
    for (const path of [
      "whole.gltf",
      "whole.obj",
      "linked.obj",
      "pictured.obj",
    ])
      answers[path] = await call("blender_add_objects", {
        objects: [{ name: "Reaching", kind: "model", path }],
      });
    const after = await call("blender_describe_scene", {});

    for (const [path, answer] of Object.entries(answers)) {
      expect(answer.isError, path).toBe(true);
      expect(answer.said, path).toMatch(/outside the workspace/);
    }
    expect(after.said).toBe(before.said);
    await unlink(join(workspace, "linked"));
  });

  it("brings in a USD text file whose parts are in the workspace, and refuses binary USD it cannot check", async () => {
    await writeFile(
      join(workspace, "part.usda"),
      '#usda 1.0\ndef Mesh "Tri" {\n  point3f[] points = [(0, 0, 0), (0.1, 0, 0), (0, 0.1, 0)]\n  int[] faceVertexCounts = [3]\n  int[] faceVertexIndices = [0, 1, 2]\n}\n',
    );
    await writeFile(
      join(workspace, "assembly.usda"),
      '#usda 1.0\ndef Xform "Root" (\n  references = @./part.usda@</Tri>\n) {\n}\n',
    );
    await writeFile(join(workspace, "binary.usd"), "PXR-USDC\0\0\0\0");

    const contained = await call("blender_add_objects", {
      objects: [{ name: "Assembly", kind: "model", path: "assembly.usda" }],
    });
    const binary = await call("blender_add_objects", {
      objects: [{ name: "Binary", kind: "model", path: "binary.usd" }],
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Assembly", delete: true }],
    });

    expect(contained.isError).toBeUndefined();
    expect(binary.isError).toBe(true);
    expect(binary.said).toMatch(/binary USD/);
  });

  it("leaves the scene as it was when a render is refused", async () => {
    const before = await call("blender_describe_scene", {
      objects: ["Plate"],
    });
    const refused = await call("blender_render", {
      output: "renders/see-through.jpg",
      background: "transparent",
      engine: "eevee",
      resolution: [320, 240],
    });
    // A change saves the scene, settings and all.
    await call("blender_edit_objects", {
      edits: [{ object: "Plate", move_by: [0, 0, 0] }],
    });
    const after = await call("blender_describe_scene", { objects: ["Plate"] });

    expect(refused.isError).toBe(true);
    expect(after.said.split("\n")[1]).toBe(before.said.split("\n")[1]);
  });

  it("names the files outside the workspace that a scene it opens reads", async () => {
    // A copy of the scene whose material shows a picture from outside.
    await call("blender_run_script", {
      code: [
        "import bpy",
        `image = bpy.data.images.load(r"${join(root, "outside.png")}")`,
        "material = bpy.data.materials.new('Elsewhere')",
        "material.use_nodes = True",
        "material.node_tree.nodes.new('ShaderNodeTexImage').image = image",
        "plate = bpy.data.objects['Plate']",
        "plate.data.materials.append(material)",
        `bpy.ops.wm.save_as_mainfile(filepath=r"${join(workspace, "elsewhere.blend")}", copy=True)`,
        "plate.data.materials.pop()",
        "bpy.data.materials.remove(material)",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });

    const opened = await call("blender_open_scene", {
      path: "elsewhere.blend",
    });
    await call("blender_open_scene", { path: "part.blend" });

    expect(opened.isError).toBeUndefined();
    expect(opened.said).toMatch(/outside the workspace[^\n]*outside\.png/);
  });

  it("ends a command that runs past its limit, then opens the scene again in a new Blender", async () => {
    const session = scenes.scene("live");
    const stuck = await session.run(
      "script",
      { code: "import time\ntime.sleep(60)" },
      { timeoutMs: 3_000 },
    );
    expect(stuck).toMatchObject({ ok: false });
    expect(stuck.ok ? "" : stuck.reason).toContain("The change was not made");

    const described = await call("blender_describe_scene", {
      objects: ["Plate"],
    });
    expect(described.isError).toBeUndefined();
    expect(described.said).toContain("Plate");
  });

  it("keeps its settings in Zhiyin's data, and never runs a script saved in the scene file", async () => {
    const marker = join(root, "ran.txt").replaceAll("\\", "/");
    const saved = await call("blender_run_script", {
      code: [
        "import bpy",
        "print(bpy.utils.user_resource('CONFIG'))",
        "text = bpy.data.texts.new('startup.py')",
        `text.write("open('${marker}', 'w').write('ran')")`,
        "text.use_module = True",
      ].join("\n"),
    });
    expect(saved.isError).toBeUndefined();
    expect(saved.said.toLowerCase()).toContain(
      scenes.directory("live").toLowerCase(),
    );

    // A new Blender opens the scene, with the script registered to run on load.
    await scenes.close("live");
    const reopened = await call("blender_describe_scene", {
      objects: ["Plate"],
    });

    expect(reopened.said).toContain("Plate");
    await expect(stat(marker)).rejects.toThrow();
  });

  it("ignores Blender's own variables in Zhiyin's environment, which could run scripts at startup", async () => {
    const marker = join(root, "startup-ran.txt").replaceAll("\\", "/");
    const scripts = join(root, "system-scripts");
    await mkdir(join(scripts, "startup"), { recursive: true });
    await writeFile(
      join(scripts, "startup", "planted.py"),
      `open('${marker}', 'w').write('ran')\n`,
    );
    process.env["BLENDER_SYSTEM_SCRIPTS"] = scripts;
    try {
      await scenes.close("live");
      const started = await call("blender_describe_scene", {
        objects: ["Plate"],
      });
      expect(started.said).toContain("Plate");
    } finally {
      delete process.env["BLENDER_SYSTEM_SCRIPTS"];
    }

    await expect(stat(marker)).rejects.toThrow();
  });

  it("runs Blender below normal priority, so a long render leaves the desktop responsive", async () => {
    const asked = await call("blender_run_script", {
      code: [
        "import ctypes",
        "kernel = ctypes.windll.kernel32",
        "kernel.GetCurrentProcess.restype = ctypes.c_void_p",
        "kernel.GetPriorityClass.argtypes = [ctypes.c_void_p]",
        "print('class', kernel.GetPriorityClass(kernel.GetCurrentProcess()))",
      ].join("\n"),
    });

    // BELOW_NORMAL_PRIORITY_CLASS
    expect(asked.said).toContain(`class ${0x4000}`);
  });

  it("says plainly when Blender is installed too deep to load its own files, before starting it", async () => {
    // A junction gives Blender's folder a deep name without copying it, so
    // Blender's own deepest files lie well past 260 characters.
    let deep = join(root, "deep");
    while (deep.length < 180) deep = join(deep, "a-folder-with-a-long-name");
    await mkdir(deep, { recursive: true });
    const installed = join(deep, "blender");
    await symlink(dirname(blender ?? ""), installed, "junction");
    const far = new ConversationScenes({
      blender: async () => join(installed, basename(blender ?? "")),
      directory: join(root, "far-data"),
      launch: containedSessionLaunch(
        { open: openProcessContainer },
        openToLowIntegrity,
      ),
      script: sessionScript,
    });
    try {
      const farTools = sceneAutomation(far.scene("far"), {
        workspaceRoot: () => workspace,
        blender: async () => join(installed, basename(blender ?? "")),
        directory: far.directory("far"),
        openToBlender: workspaceOpening(openToLowIntegrity),
      });
      const run = async (name: string, args: Record<string, unknown>) =>
        (await farTools.callTool(name, args)) as Result;

      const opened = await run("blender_open_scene", {
        path: "far.blend",
        create: true,
      });
      const said = opened.content.map((c) => c.text ?? "").join("\n");

      expect(opened.isError).toBe(true);
      expect(said).toMatch(
        /Blender cannot run from .+: some of its own files there have paths of \d+ characters, longer than the 260 characters Blender can open\./,
      );
      // Refused before Blender started: nothing it printed is passed on.
      expect(said).not.toContain("Traceback");
      expect(far.scene("far").state()).toMatchObject({ status: "failed" });
    } finally {
      await far.closeAll();
      // Only the junction goes; the Blender it points at stays.
      await unlink(installed);
    }
  });

  // A saucer whose well is 6 mm up from its foot, rising to a 16.5 mm rim, and
  // a mug whose 35 mm foot fits inside the well.
  const saucer = {
    name: "Saucer",
    kind: "revolve",
    profile: [
      [0, 0],
      [0.026, 0],
      [0.026, 0.0025],
      [0.032, 0.004],
      [0.07, 0.0145],
      [0.075, 0.0165],
      [0.073, 0.0165],
      [0.068, 0.014],
      [0.045, 0.0075],
      [0.04, 0.006],
      [0, 0.006],
    ],
  };
  const mugProfile = [
    [0, 0],
    [0.035, 0],
    [0.042, 0.095],
    [0.038, 0.095],
    [0.032, 0.006],
    [0, 0.006],
  ];

  it("keeps a turned profile at the heights it was drawn, sets a mug down in a saucer's well, and says where each one is", async () => {
    await call("blender_open_scene", { path: "mug.blend", create: true });

    const plate = await call("blender_add_objects", { objects: [saucer] });
    const mug = await call("blender_add_objects", {
      objects: [
        {
          name: "Mug",
          kind: "revolve",
          profile: mugProfile,
          location: [0, 0, 0.05],
          rest_on: "Saucer",
        },
      ],
    });
    const sunk = await call("blender_edit_objects", {
      edits: [{ object: "Mug", location: [0, 0, -0.01] }],
    });

    expect(plate.said).toMatch(/Added Saucer .*from 0 mm to 16\.5 mm high/);
    // Lowered onto the saucer it lands on the well, not at the rim's height.
    expect(mug.said).toMatch(/Added Mug .*from 6 mm to 101 mm high\.$/);
    expect(sunk.said).toMatch(
      /Mug: moved; now .*from -10 mm to 85 mm high, goes (?:[\d.]+ mm )?into Saucer/,
    );
  });

  it("says a shape goes into another only when it does, and draws round shapes smooth", async () => {
    await call("blender_edit_objects", {
      edits: [{ object: "Mug", rest_on: "Saucer" }],
    });
    // A grip a millimetre clear of the mug's wall: their boxes overlap, the
    // shapes do not.
    await call("blender_add_objects", {
      objects: [
        {
          name: "Grip",
          kind: "tube",
          points: [
            [0.046, 0, 0.03],
            [0.066, 0, 0.05],
            [0.046, 0, 0.07],
          ],
          radius: 0.004,
        },
      ],
    });
    const described = await call("blender_describe_scene", {
      objects: ["Mug", "Grip", "Saucer"],
    });
    const line = (name: string) =>
      described.said.split("\n").find((l) => l.startsWith(`- ${name}:`)) ?? "";

    expect(line("Mug")).not.toMatch(/into/);
    expect(line("Grip")).not.toMatch(/into/);
    expect(line("Mug")).toContain("smooth-shaded");
    expect(line("Grip")).toContain("smooth-shaded");
  });

  it("draws a tube as a smooth curve through its points unless its corners are sharp", async () => {
    // Seven points on a half circle 40 mm across from its centre.
    const arc = (y: number) =>
      Array.from({ length: 7 }, (_, i) => {
        const angle = (Math.PI * i) / 6;
        return [0.2 + 0.04 * Math.cos(angle), y, 0.05 + 0.04 * Math.sin(angle)];
      });
    await call("blender_add_objects", {
      objects: [
        { name: "Handle", kind: "tube", points: arc(0), radius: 0.004 },
        {
          name: "Pipe",
          kind: "tube",
          points: arc(0.2),
          radius: 0.004,
          corners: "sharp",
        },
      ],
    });
    // The tube's inner surface, found by looking out from the half circle's
    // centre all along it: a curve through the points stays at 36 mm; straight
    // runs between them cut inside, to about 34.6 mm.
    const nearest = await call("blender_run_script", {
      code: [
        "import bpy, math",
        "from mathutils import Vector",
        "for name, y in (('Handle', 0), ('Pipe', 0.2)):",
        "    o = bpy.data.objects[name]",
        "    centre = Vector((0.2, y, 0.05))",
        "    hits = []",
        "    for step in range(2, 35):",
        "        a = math.radians(step * 5)",
        "        found, where, _, _ = o.ray_cast(centre, Vector((math.cos(a), 0, math.sin(a))))",
        "        if found: hits.append((where - centre).length)",
        "    print(name, min(hits))",
      ].join("\n"),
    });
    const inner = (name: string) =>
      Number(new RegExp(`${name} ([\\d.]+)`).exec(nearest.said)?.[1]) * 1000;

    expect(inner("Handle")).toBeGreaterThan(35.5);
    expect(inner("Pipe")).toBeLessThan(35);
  });

  it("aims at an object's middle, keeps the focus there when it moves, and says what the picture shows", async () => {
    const aimed = await call("blender_set_camera", {
      location: [0, -0.5, 0.3],
      look_at_object: "Mug",
      lens: 50,
      resolution: [400, 400],
      depth_of_field: { focus_object: "Mug", aperture: 2 },
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Mug", location: [0, 0.1, 0.006] }],
    });
    const measured = await call("blender_run_script", {
      code: [
        "import bpy",
        "from mathutils import Vector",
        "camera = bpy.context.scene.camera",
        "forward = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))",
        "mug = bpy.data.objects['Mug']",
        "corners = [mug.matrix_world @ Vector(c) for c in mug.bound_box]",
        "middle = sum(corners, Vector()) / 8",
        "print('focus', camera.data.dof.focus_distance, 'expected', (middle - camera.location).dot(forward))",
      ].join("\n"),
    });

    expect(aimed.said).toMatch(/looking at the middle of Mug/);
    expect(aimed.said).toMatch(/shows [^.;]*Mug[^.;]* whole/);
    const [, focus, expected] =
      /focus ([\d.]+) expected ([\d.]+)/.exec(measured.said) ?? [];
    expect(Number(focus)).toBeCloseTo(Number(expected), 4);
  });

  it("lists each material's and step's values, and sets a whole material each time", async () => {
    await call("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Glaze", color: "#122a63", roughness: 0.12, coat: 0.6 },
    });
    await call("blender_shape_objects", {
      object: "Mug",
      operations: [{ kind: "bevel", width: 0.0012, segments: 3 }],
    });
    const coated = await call("blender_describe_scene", { objects: ["Mug"] });
    await call("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Glaze", color: "#122a63", roughness: 0.25 },
    });
    const plain = await call("blender_describe_scene", { objects: ["Mug"] });

    expect(coated.said).toContain(
      "material Glaze (#122a63, roughness 0.12, coat 0.6)",
    );
    expect(coated.said).toContain("steps: Bevel (1.2 mm, 3 segments)");
    // Left out of the second call, the coat went back to none.
    expect(plain.said).toContain("material Glaze (#122a63, roughness 0.25)");

    await call("blender_set_material", {
      objects: ["Mug"],
      material: {
        name: "Glaze",
        color: "#122a63",
        roughness: 0.1,
        specular: 0.2,
        coat: 0.5,
        coat_roughness: 0.2,
      },
    });
    const tuned = await call("blender_describe_scene", { objects: ["Mug"] });
    expect(tuned.said).toContain(
      "material Glaze (#122a63, roughness 0.1, specular 0.2, coat 0.5, coat roughness 0.2)",
    );
  });

  it("frames a round shape by its outline, not its box, and looks from the elevation asked", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Disc",
          kind: "cylinder",
          size: [0.2, 0.2, 0.01],
          location: [1, 0, 0.005],
        },
      ],
    });
    const framed = await call("blender_set_camera", {
      frame: { objects: ["Disc"], direction: "three-quarter", margin: 0 },
      resolution: [400, 400],
    });
    const spanned = await call("blender_run_script", {
      code: [
        "import bpy",
        "from bpy_extras.object_utils import world_to_camera_view",
        "s = bpy.context.scene",
        "d = bpy.data.objects['Disc']",
        "seen = [world_to_camera_view(s, s.camera, d.matrix_world @ v.co) for v in d.data.vertices]",
        "print('span', max(p.x for p in seen) - min(p.x for p in seen), max(p.y for p in seen) - min(p.y for p in seen))",
      ].join("\n"),
    });
    await call("blender_set_camera", {
      frame: { objects: ["Disc"], direction: "front", elevation: 10 },
    });
    const pitched = await call("blender_run_script", {
      code: [
        "import bpy, math",
        "from mathutils import Vector",
        "c = bpy.context.scene.camera",
        "f = c.matrix_world.to_quaternion() @ Vector((0, 0, -1))",
        "print('down', math.degrees(math.asin(-f.z)))",
      ].join("\n"),
    });
    const camera = await call("blender_describe_scene", {
      objects: ["Camera"],
    });

    // With no margin, the disc's outline reaches the picture's edges.
    const [, across, up] = /span ([\d.]+) ([\d.]+)/.exec(spanned.said) ?? [];
    expect(Math.max(Number(across), Number(up))).toBeGreaterThan(0.97);
    // Its box's corners lie outside the picture, but the disc is all in it.
    expect(framed.said).toMatch(/shows [^.;]*Disc[^.;]* whole/);
    expect(Number(/down ([\d.-]+)/.exec(pitched.said)?.[1])).toBeCloseTo(10, 1);
    // Angles are said without the arithmetic left in them.
    expect(camera.said).not.toMatch(/\de-\d/);
  });

  it("says a floor wider than the picture is cut off, not missed", async () => {
    await call("blender_add_objects", {
      objects: [
        { name: "Floor", kind: "plane", size: [6, 6], location: [1, 0, 0] },
      ],
    });
    const seen = await call("blender_set_camera", {
      frame: { objects: ["Disc"], direction: "front", elevation: 30 },
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Floor", delete: true }],
    });

    // Every corner of the floor is outside the picture, yet it fills it.
    expect(seen.said).toMatch(/cuts off part of [^.;]*Floor/);
  });

  it("keeps the product backdrop white in the picture while brightening it in reflections, when asked", async () => {
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Deep", color: "#0a2a80", roughness: 0.09, coat: 0.35 },
    });
    await call("blender_set_camera", {
      frame: { objects: ["Mug"], direction: "front", margin: 0.3 },
      resolution: [200, 200],
    });
    // Blender reads its own picture: how saturated the mug's middle is, which
    // white reflections wash out, and how bright the backdrop is in a corner.
    const measure = async (output: string) => {
      await call("blender_render", { output, engine: "cycles", samples: 16 });
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          `image = bpy.data.images.load(bpy.path.abspath("//${output}"))`,
          "w, h = image.size",
          "p = image.pixels[:]",
          "patch = [(y * w + x) * 4 for x in range(w // 2 - 15, w // 2 + 15) for y in range(h // 2 - 15, h // 2 + 15)]",
          "rgb = [sum(p[i + c] for i in patch) / len(patch) for c in range(3)]",
          "corner = (lambda i: 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2])(((h - 4) * w + 3) * 4)",
          "print('saturation', (max(rgb) - min(rgb)) / max(rgb), 'corner', corner)",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      const [, saturation, corner] =
        /saturation ([\d.]+) corner ([\d.]+)/.exec(read.said) ?? [];
      return { saturation: Number(saturation), corner: Number(corner) };
    };

    const deep = await measure("renders/reflections-default.png");
    const brightened = await call("blender_set_lighting", {
      backdrop_reflections: 1,
    });
    const bright = await measure("renders/reflections-full.png");
    const described = await call("blender_describe_scene", {
      objects: ["Backdrop"],
    });

    expect(brightened.said).toContain(
      "the backdrop at 100% of its brightness in reflections",
    );
    // The blue greys over as the backdrop brightens in it; the backdrop in the
    // picture does not change.
    expect(deep.saturation).toBeGreaterThan(bright.saturation + 0.1);
    expect(bright.corner).toBeCloseTo(deep.corner, 1);
    expect(described.said).toContain("100% as bright in reflections");
  });

  it("shows a product's own colour under the product lighting, in Cycles and close to it in EEVEE", async () => {
    const lit = await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Grey", color: "#777777", roughness: 0.6 },
    });
    await call("blender_set_camera", {
      frame: { objects: ["Mug"], direction: "three-quarter", margin: 0.3 },
      resolution: [200, 200],
    });
    // Blender reads its own picture: the mug's middle, and the backdrop in a
    // top corner, where nothing else in the scene reaches.
    const measure = async (engine: string) => {
      const output = `renders/grey-${engine}.png`;
      await call("blender_render", { output, engine, samples: 16 });
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          `image = bpy.data.images.load(bpy.path.abspath("//${output}"))`,
          "w, h = image.size",
          "p = image.pixels[:]",
          "patch = [(y * w + x) * 4 for x in range(w // 2 - 6, w // 2 + 6) for y in range(h // 2 - 6, h // 2 + 6)]",
          "grey = sum(p[i] + p[i + 1] + p[i + 2] for i in patch) / (3 * len(patch))",
          "backdrop = sum(p[((h - 3) * w + 2) * 4 + c] for c in range(3)) / 3",
          "print('grey', grey * 255, 'backdrop', backdrop * 255)",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      const [, grey, backdrop] =
        /grey ([\d.]+) backdrop ([\d.]+)/.exec(read.said) ?? [];
      return { grey: Number(grey), backdrop: Number(backdrop) };
    };
    const cycles = await measure("cycles");
    const eevee = await measure("eevee");
    const camera = await call("blender_describe_scene", {
      objects: ["Camera"],
    });

    expect(lit.said).toMatch(/neutral tone/);
    expect(camera.said).toMatch(/neutral tone/);
    // #777777 is 119: within about half a stop of it, on a white backdrop.
    expect(cycles.grey).toBeGreaterThan(96);
    expect(cycles.grey).toBeLessThan(144);
    expect(cycles.backdrop).toBeGreaterThan(215);
    expect(eevee.backdrop).toBeGreaterThan(215);
    // EEVEE, which gathers little of the backdrop's light, stays close.
    expect(eevee.grey).toBeGreaterThan(cycles.grey * 0.85);
    expect(eevee.grey).toBeLessThan(cycles.grey * 1.15);
  });

  it("keeps a glossy product's deep colour under the product lighting, as it is set up", async () => {
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Glaze", color: "#14307a", roughness: 0.1, coat: 0.5 },
    });
    await call("blender_set_camera", {
      frame: { objects: ["Mug"], direction: "three-quarter", margin: 0.3 },
      resolution: [200, 200],
    });
    await call("blender_render", {
      output: "renders/glaze.png",
      engine: "cycles",
      samples: 16,
    });
    // Blender reads the mug's middle from its own picture.
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//renders/glaze.png'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "patch = [(y * w + x) * 4 for x in range(w // 2 - 6, w // 2 + 6) for y in range(h // 2 - 6, h // 2 + 6)]",
        "print('glaze', *[sum(p[i + c] for i in patch) / len(patch) * 255 for c in range(3)])",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const [red, green, blue] = (/glaze (.+)/.exec(read.said)?.[1] ?? "")
      .split(" ")
      .map(Number) as [number, number, number];
    const saturation =
      (Math.max(red, green, blue) - Math.min(red, green, blue)) /
      Math.max(red, green, blue);

    // #14307a is 20, 48, 122, saturated 0.84. The white backdrop seen in the
    // glaze at full strength greys it to about 0.34.
    expect(blue).toBeGreaterThan(Math.max(red, green));
    expect(saturation).toBeGreaterThan(0.5);
  });

  it("sets the picture's tone and exposure, and says them back", async () => {
    const set = await call("blender_set_camera", {
      tone: "standard",
      exposure: 0.5,
    });
    const described = await call("blender_describe_scene", {
      objects: ["Camera"],
    });
    const rendered = await call("blender_render", {
      output: "renders/toned.png",
      engine: "eevee",
      samples: 4,
      resolution: [160, 90],
    });

    expect(set.said).toMatch(/exposure \+0\.5, standard tone/);
    expect(described.said).toMatch(/standard tone, exposure \+0\.5/);
    // A picture says the tone and exposure it was made with.
    expect(rendered.said).toMatch(/ s, standard tone, exposure \+0\.5\. /);
  });

  it("runs a script in the workspace, so a workspace path opens as it is", async () => {
    await mkdir(join(workspace, "notes"), { recursive: true });
    await writeFile(
      join(workspace, "notes", "hello.txt"),
      "from the workspace",
    );
    const read = await call("blender_run_script", {
      code: "print(open('notes/hello.txt').read())",
    });

    expect(read.said).toContain("from the workspace");
  });

  describe("an assembly of parts", () => {
    // Blender reads an object's box with its parts, leaving out cutters.
    const boundsOf = async (name: string) => {
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "from mathutils import Vector",
          `o = bpy.data.objects['${name}']`,
          "parts = [p for p in [o, *o.children_recursive] if p.type in {'MESH', 'CURVE', 'FONT'} and not any(c.name == 'Cutters' for c in p.users_collection)]",
          "corners = [p.matrix_world @ Vector(c) for p in parts for c in p.bound_box]",
          "print('bounds', *[min(c[i] for c in corners) for i in range(3)], *[max(c[i] for c in corners) for i in range(3)])",
        ].join("\n"),
      });
      const n = (/bounds (.+)/.exec(read.said)?.[1] ?? "")
        .split(" ")
        .map(Number);
      return {
        centre: [0, 1, 2].map((i) => ((n[i] ?? 0) + (n[i + 3] ?? 0)) / 2),
        size: [0, 1, 2].map((i) => (n[i + 3] ?? 0) - (n[i] ?? 0)),
      };
    };
    const line = async (name: string) =>
      (await call("blender_describe_scene", { objects: [name] })).said
        .split("\n")
        .find((l) => l.startsWith(`- ${name}:`)) ?? "";
    const volume = async (name: string) =>
      Number(/([\d.]+) cm³/.exec(await line(name))?.[1]);

    it("places a drawing and a model where asked, at the depth asked", async () => {
      await call("blender_open_scene", {
        path: "assembly.blend",
        create: true,
      });
      await writeFile(
        join(workspace, "offset.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect x="300" y="40" width="100" height="20"/></svg>',
      );
      await call("blender_add_objects", {
        objects: [{ name: "Source", kind: "cube", size: [0.2, 0.1, 0.05] }],
      });
      await call("blender_export", {
        output: "source.glb",
        objects: ["Source"],
      });
      await call("blender_edit_objects", {
        edits: [{ object: "Source", delete: true }],
      });

      await call("blender_add_objects", {
        objects: [
          {
            name: "Badge",
            kind: "svg",
            path: "offset.svg",
            width: 0.1,
            depth: 0.005,
            location: [1, 0, 0.5],
          },
          {
            name: "Imported",
            kind: "model",
            path: "source.glb",
            size: [0.1, 0.1, 0.1],
            location: [0.9, 0, 0.3],
          },
        ],
      });
      const badge = await boundsOf("Badge");
      const imported = await boundsOf("Imported");

      expect(badge.centre[0]).toBeCloseTo(1, 3);
      expect(badge.centre[1]).toBeCloseTo(0, 3);
      expect(badge.size[0]).toBeCloseTo(0.1, 3);
      expect(badge.size[2]).toBeCloseTo(0.005, 4);
      expect(imported.centre[0]).toBeCloseTo(0.9, 3);
      expect(imported.centre[2]).toBeCloseTo(0.3, 3);
      expect(Math.max(...imported.size)).toBeCloseTo(0.1, 3);
    });

    it("attaches a part added in the same call where it was asked", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Frame",
            kind: "cube",
            size: [0.5, 0.5, 0.5],
            location: [16, 0, 1],
            rotation: [0, 0, 45],
          },
          {
            name: "Peg",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [16.5, 0, 1],
            parent: "Frame",
          },
        ],
      });

      expect(await line("Peg")).toContain("at (16.5, 0, 1 m)");
    });

    it("keeps a hole with its object when it moves or is copied", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Bracket",
            kind: "cube",
            size: [0.1, 0.1, 0.01],
            location: [3, 0, 0.005],
          },
        ],
      });
      await call("blender_shape_objects", {
        object: "Bracket",
        operations: [
          {
            kind: "boolean",
            cutter: {
              shape: "cylinder",
              diameter: 0.02,
              depth: 0.05,
              location: [3, 0, 0.005],
            },
          },
        ],
      });
      const holed = await volume("Bracket");
      await call("blender_edit_objects", {
        edits: [
          { object: "Bracket", move_by: [0.5, 0, 0] },
          {
            object: "Bracket",
            duplicate: { count: 1, offset: [0, 0.3, 0] },
          },
        ],
      });

      expect(holed).toBeLessThan(99);
      expect(await volume("Bracket")).toBeCloseTo(holed, 1);
      expect(await volume("Bracket 2")).toBeCloseTo(holed, 1);
    });

    it("copies, hides and deletes what is attached along with it", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Body",
            kind: "cube",
            size: [0.2, 0.2, 0.2],
            location: [6, 0, 0.1],
          },
          {
            name: "Knob",
            kind: "sphere",
            size: [0.05, 0.05, 0.05],
            location: [6, 0, 0.225],
            parent: "Body",
          },
        ],
      });

      const copied = await call("blender_edit_objects", {
        edits: [{ object: "Body", duplicate: { offset: [0.5, 0, 0] } }],
      });
      expect(copied.said).toMatch(/Knob 2/);
      expect(await line("Knob 2")).toMatch(
        /at \(6\.5, 0, 0\.225 m\).*attached to Body 2/,
      );

      await call("blender_edit_objects", {
        edits: [{ object: "Body 2", hidden: true }],
      });
      expect(await line("Knob 2")).toMatch(/hidden/);

      const deleted = await call("blender_edit_objects", {
        edits: [{ object: "Body 2", delete: true }],
      });
      expect(deleted.said).toMatch(/Knob 2/);
      expect((await call("blender_describe_scene", {})).said).not.toMatch(
        /Knob 2/,
      );
    });

    it("moves and turns an attached part in the world's terms, and resizes a part without its attachments", async () => {
      await call("blender_edit_objects", {
        edits: [{ object: "Body", rotation: [0, 0, 45] }],
      });
      await call("blender_edit_objects", {
        edits: [{ object: "Knob", location: [6.1, 0, 0.3] }],
      });
      const placed = await line("Knob");
      await call("blender_edit_objects", {
        edits: [
          { object: "Knob", move_by: [0, 0.1, 0] },
          { object: "Knob", rotation: [0, 0, 90] },
        ],
      });
      const moved = await line("Knob");
      await call("blender_edit_objects", {
        edits: [{ object: "Body", size: [0.4, 0.4, 0.2] }],
      });

      expect(placed).toContain("at (6.1, 0, 0.3 m)");
      expect(moved).toContain("at (6.1, 0.1, 0.3 m)");
      expect(moved).toMatch(/turned \(0°, 0°, 90°\)/);
      expect(await line("Knob")).toContain("50 × 50 × 50 mm");
    });

    it("draws outlines flat with crisp corners, and a tube flat when asked", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Wall",
            kind: "outline",
            points: [
              [0, 0],
              [1, 0],
              [1, 0.1],
              [0, 0.1],
            ],
            height: 0.5,
            location: [8, 0, 0],
          },
          {
            name: "Pipe",
            kind: "tube",
            points: [
              [8, 1, 0.1],
              [8.5, 1, 0.3],
              [9, 1, 0.1],
            ],
            radius: 0.02,
            smooth: false,
          },
        ],
      });

      expect(await line("Wall")).toMatch(/flat-shaded/);
      expect(await line("Pipe")).toMatch(/flat-shaded/);
    });

    it("names a picture, a type and a focus as they are", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Card",
            kind: "plane",
            size: [0.2, 0.1],
            location: [12, 0, 0],
            rotation: [90, 0, 0],
          },
        ],
      });
      await call("blender_set_material", {
        objects: ["Card"],
        material: {
          name: "Printed card",
          texture: { path: "renders/plate.png", projection: "front" },
        },
      });
      await call("blender_set_camera", {
        location: [12, -1, 0.2],
        look_at_object: "Card",
        depth_of_field: { focus_object: "Card", aperture: 2 },
      });
      await call("blender_edit_objects", {
        edits: [{ object: "Card", rename: "Sign" }],
      });
      const api = await call("blender_api", { name: "Object" });

      expect(await line("Sign")).toMatch(/picture plate\.png/);
      // Turned upright, its thickness is nothing, not arithmetic.
      expect(await line("Sign")).not.toMatch(/\de-\d/);
      expect(await line("Camera")).toMatch(/focused on Sign/);
      expect(api.said).toMatch(/^bpy\.types\.Object /);
    });

    it("refuses an input a shape does not take, and says what it takes", async () => {
      const wrong = await call("blender_add_objects", {
        objects: [
          {
            name: "Rod",
            kind: "cylinder",
            diameter: 0.04,
            height: 0.7,
            location: [20, 0, 0.35],
          },
        ],
      });

      expect(wrong.isError).toBe(true);
      expect(wrong.said).toMatch(/cylinder takes[^.]*size/);
      expect(wrong.said).toMatch(/diameter/);
    });

    it("refuses a kind of object or of operation it does not have, and names every one it has", async () => {
      const shape = await call("blender_add_objects", {
        objects: [{ name: "Wedge", kind: "wedge", location: [24, 0, 0] }],
      });
      await call("blender_add_objects", {
        objects: [
          {
            name: "Slab to shape",
            kind: "box",
            size: [0.3, 0.3, 0.1],
            location: [24, 0, 0.05],
          },
        ],
      });
      const operation = await call("blender_shape_objects", {
        object: "Slab to shape",
        operations: [{ kind: "twist" }],
      });

      expect(shape.isError).toBe(true);
      expect(shape.said).toContain(
        "kind must be one of cube, cylinder, cone, sphere, plane, torus, revolve, outline, tube, text, image, svg or model.",
      );
      expect(await call("blender_describe_scene", {})).not.toMatchObject({
        said: expect.stringContaining("Wedge"),
      });
      expect(operation.isError).toBe(true);
      expect(operation.said).toContain(
        "An operation's kind is boolean, bevel, array, mirror, solidify, subdivision, smooth or remove.",
      );
    });

    it("gives every cutter a size, and says it", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Block",
            kind: "cube",
            size: [0.3, 0.3, 0.3],
            location: [22, 0, 0.15],
          },
        ],
      });
      const sizeless = await call("blender_shape_objects", {
        object: "Block",
        operations: [
          { kind: "boolean", cutter: { shape: "box", location: [22, 0, 0.3] } },
        ],
      });
      const sphere = await call("blender_shape_objects", {
        object: "Block",
        operations: [
          {
            kind: "boolean",
            cutter: { shape: "sphere", diameter: 0.1, location: [22, 0, 0.3] },
          },
        ],
      });

      expect(sizeless.isError).toBe(true);
      expect(sizeless.said).toMatch(/size/);
      expect(sphere.isError).toBeUndefined();
      expect(sphere.said).toMatch(/100 mm/);
      // A ball's dent out of the top of a 27 L block, not the whole block.
      const litres = Number(/([\d.]+) L\b/.exec(await line("Block"))?.[1]);
      expect(litres).toBeGreaterThan(26.5);
      expect(litres).toBeLessThan(26.9);
    });

    it("keeps a material's values when it is named again with nothing else", async () => {
      await call("blender_set_material", {
        objects: ["Block"],
        material: { name: "Oak", color: "#8a5a2b", roughness: 0.7 },
      });
      await call("blender_set_material", {
        objects: ["Bracket"],
        material: { name: "Oak" },
      });

      expect(await line("Block")).toMatch(/Oak \(#8a5a2b, roughness 0\.7\)/);
      expect(await line("Bracket")).toMatch(/Oak \(#8a5a2b/);
    });

    it("gives an object's own size, turned or not, and resizes it along its own length", async () => {
      const added = await call("blender_add_objects", {
        objects: [
          {
            name: "Beam",
            kind: "cube",
            size: [2, 0.1, 0.1],
            location: [24, 0, 0.05],
            rotation: [0, 0, 45],
          },
        ],
      });
      const resized = await call("blender_edit_objects", {
        edits: [{ object: "Beam", size: [3, 0.1, 0.1] }],
      });

      expect(added.said).toContain("Beam (2 × 0.1 × 0.1 m");
      expect(resized.said).toContain("Beam (3 × 0.1 × 0.1 m");
      expect(await line("Beam")).toMatch(/3 × 0\.1 × 0\.1 m.*turned/);
    });

    it("keeps the model's own lights through a preset, the backdrop through replace, and edits a light by name", async () => {
      const made = await call("blender_set_lighting", {
        lights: [
          {
            name: "Lamp",
            kind: "point",
            location: [22, -1, 1],
            power: 40,
          },
        ],
      });
      await call("blender_set_lighting", { preset: "product" });
      const keptLamp = await line("Lamp");
      await call("blender_set_lighting", {
        replace: true,
        lights: [
          {
            name: "Key",
            kind: "area",
            location: [22, -1, 1.5],
            power: 100,
            size: 0.5,
          },
        ],
      });
      const dimmed = await call("blender_set_lighting", {
        backdrop_reflections: 0.5,
      });
      await call("blender_set_lighting", {
        lights: [{ name: "Key", power: 60 }],
      });
      const edited = await line("Key");
      await call("blender_edit_objects", {
        edits: [{ object: "Key", location: [25, -1, 1.5] }],
      });
      // Blender says where the moved light faces: its own -z, against the
      // way to the point it was aimed at.
      const facing = await call("blender_run_script", {
        code: [
          "import bpy, mathutils",
          "key = bpy.data.objects['Key']",
          "faces = key.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))",
          "towards = (mathutils.Vector((0, 0, 0)) - key.matrix_world.translation).normalized()",
          "print('facing', faces.dot(towards))",
        ].join("\n"),
      });

      // A new light is said where it was put.
      expect(made.said).toContain("Lamp (point light, 40 W) at (22, -1, 1 m)");
      expect(keptLamp).toMatch(/point light, 40 W/);
      expect(dimmed.isError).toBeUndefined();
      expect(edited).toMatch(/area light, 60 W.*500 mm across/);
      expect(edited).toContain("at (22, -1, 1.5 m)");
      expect(edited).toMatch(/aimed at \(0, 0, 0 m?m\)/);
      expect(await line("Key")).toMatch(/aimed at \(0, 0, 0 m?m\)/);
      expect(Number(/facing ([\d.-]+)/.exec(facing.said)?.[1])).toBeGreaterThan(
        0.999,
      );
    });

    it("renders a see-through background around a product on the backdrop", async () => {
      await call("blender_set_lighting", { preset: "product" });
      await call("blender_set_camera", {
        frame: { objects: ["Block"], direction: "front", margin: 0.3 },
        resolution: [80, 80],
      });
      await call("blender_render", {
        output: "renders/cutout.png",
        engine: "eevee",
        samples: 1,
        background: "transparent",
      });
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.load(bpy.path.abspath('//renders/cutout.png'))",
          "w, h = image.size",
          "p = image.pixels[:]",
          "print('alpha', p[3], p[((h // 2) * w + w // 2) * 4 + 3])",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      const [, corner, middle] =
        /alpha ([\d.]+) ([\d.]+)/.exec(read.said) ?? [];

      expect(Number(corner)).toBeLessThan(0.05);
      expect(Number(middle)).toBeGreaterThan(0.95);
    });

    it("puts a picture on a front face the right way up", async () => {
      // Red above, blue below.
      await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.new('halves', 8, 8)",
          "image.pixels[:] = [c for y in range(8) for x in range(8) for c in ((1, 0, 0, 1) if y >= 4 else (0, 0, 1, 1))]",
          "image.filepath_raw = bpy.path.abspath('//halves.png')",
          "image.file_format = 'PNG'",
          "image.save()",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      await call("blender_add_objects", {
        objects: [
          {
            name: "Crate",
            kind: "cube",
            size: [0.4, 0.4, 0.4],
            location: [30, 0, 0.2],
          },
        ],
      });
      await call("blender_set_material", {
        objects: ["Crate"],
        material: {
          name: "Labelled",
          texture: { path: "halves.png", projection: "front" },
          emission: { color: "#ffffff", strength: 0 },
        },
      });
      await call("blender_set_lighting", { preset: "studio" });
      await call("blender_set_camera", {
        frame: {
          objects: ["Crate"],
          direction: "front",
          elevation: 0,
          margin: 0.2,
        },
        resolution: [80, 80],
      });
      await call("blender_render", {
        output: "renders/crate.png",
        engine: "eevee",
        samples: 1,
      });
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.load(bpy.path.abspath('//renders/crate.png'))",
          "w, h = image.size",
          "p = image.pixels[:]",
          "top = ((h * 3 // 4) * w + w // 2) * 4",
          "bottom = ((h // 4) * w + w // 2) * 4",
          "print('top', p[top] - p[top + 2], 'bottom', p[bottom] - p[bottom + 2])",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      const [, top, bottom] =
        /top ([\d.-]+) bottom ([\d.-]+)/.exec(read.said) ?? [];

      // Redder at the top of the face, bluer at the bottom.
      expect(Number(top)).toBeGreaterThan(0.1);
      expect(Number(bottom)).toBeLessThan(-0.1);
    });

    it("sets a shape down where it first touches, even between corners", async () => {
      const crossed = await call("blender_add_objects", {
        objects: [
          {
            name: "Log A",
            kind: "cylinder",
            size: [0.2, 0.2, 2],
            rotation: [0, 90, 0],
            location: [40, 0, 0.1],
          },
          {
            name: "Log B",
            kind: "cylinder",
            size: [0.2, 0.2, 2],
            rotation: [90, 0, 0],
            location: [40, 0, 2],
            rest_on: "Log A",
          },
          // Two cubes turned 45° about different axes meet edge to edge.
          {
            name: "Ridge",
            kind: "cube",
            size: [1, 1, 1],
            rotation: [45, 0, 0],
            location: [43, 0, 0.8],
          },
          {
            name: "Wedge",
            kind: "cube",
            size: [0.5, 0.5, 0.5],
            rotation: [0, 45, 0],
            location: [43, 0, 3],
            rest_on: "Ridge",
          },
        ],
      });
      const log = await boundsOf("Log B");
      const wedge = await boundsOf("Wedge");
      const bottom = (b: { centre: number[]; size: number[] }) =>
        (b.centre[2] ?? 0) - (b.size[2] ?? 0) / 2;

      expect(crossed.isError).toBeUndefined();
      // On top of the lower log, 0.2 m up.
      expect(bottom(log)).toBeGreaterThan(0.1995);
      expect(bottom(log)).toBeLessThan(0.202);
      // On the ridge's top edge, 0.8 + √½ m up: never sunk into it.
      expect(bottom(wedge)).toBeGreaterThan(0.8 + Math.SQRT1_2 - 0.0005);
      expect(bottom(wedge)).toBeLessThan(0.8 + Math.SQRT1_2 + 0.002);
      expect(await line("Log B")).not.toMatch(/into Log A/);
      expect(await line("Wedge")).not.toMatch(/into Ridge/);
    });

    it("says a shape goes into another only where they overlap, and how deep", async () => {
      const shelves = [0.2, 0.4, 0.6, 0.8, 1.0].map((z, i) => ({
        name: `Shelf ${i + 1}`,
        kind: "cube",
        size: [0.6, 0.4, 0.02],
        location: [50.31, 0, z],
      }));
      const added = await call("blender_add_objects", {
        objects: [
          // A pin clear of the sides of a washer's hole.
          {
            name: "Washer",
            kind: "outline",
            points: [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
            ],
            holes: [
              [
                [-0.2, -0.2],
                [0.2, -0.2],
                [0.2, 0.2],
                [-0.2, 0.2],
              ],
            ],
            height: 0.1,
            location: [46, 0, 0],
          },
          {
            name: "Pin",
            kind: "cylinder",
            size: [0.2, 0.2, 0.5],
            location: [46, 0, 0.1],
          },
          // Shelves flush between two sides.
          {
            name: "Side L",
            kind: "cube",
            size: [0.02, 0.4, 1.2],
            location: [50, 0, 0.6],
          },
          {
            name: "Side R",
            kind: "cube",
            size: [0.02, 0.4, 1.2],
            location: [50.62, 0, 0.6],
          },
          ...shelves,
          // A cube sunk 50 mm into the top of a ball.
          {
            name: "Ball",
            kind: "sphere",
            size: [1, 1, 1],
            location: [53, 0, 0.5],
          },
          {
            name: "Dice",
            kind: "cube",
            size: [0.2, 0.2, 0.2],
            location: [53, 0, 1.05],
          },
          // An upright sunk 5 mm into a base, flush with its side.
          {
            name: "Base",
            kind: "cube",
            size: [1, 1, 0.1],
            location: [56, 0, 0.05],
          },
          {
            name: "Upright",
            kind: "cube",
            size: [0.1, 0.1, 1],
            location: [56.45, 0, 0.595],
          },
        ],
      });
      const depth = async (name: string, other: string) =>
        Number(
          new RegExp(`goes ([\\d.]+) mm into ${other}`).exec(
            await line(name),
          )?.[1],
        );

      expect(added.isError).toBeUndefined();
      expect(await line("Pin")).not.toMatch(/into/);
      expect(await line("Washer")).not.toMatch(/into/);
      for (const shelf of shelves) {
        expect(await line(shelf.name)).not.toMatch(/into/);
      }
      expect(await line("Side L")).not.toMatch(/into/);
      // As deep from either side.
      expect(await depth("Dice", "Ball")).toBeGreaterThan(45);
      expect(await depth("Dice", "Ball")).toBeLessThan(55);
      expect(await depth("Ball", "Dice")).toBeGreaterThan(45);
      expect(await depth("Ball", "Dice")).toBeLessThan(55);
      expect(await depth("Upright", "Base")).toBeGreaterThan(4.5);
      expect(await depth("Upright", "Base")).toBeLessThan(5.5);
    });

    it("makes lettering and drawings shapes that can be rounded and cut", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Sign text",
            kind: "text",
            text: "ZY",
            height: 0.1,
            depth: 0.02,
            location: [62, 0, 0.05],
          },
        ],
      });
      const rounded = await call("blender_shape_objects", {
        object: "Sign text",
        operations: [{ kind: "bevel", width: 0.002 }],
      });
      const scene = (await call("blender_describe_scene", {})).said;
      const badgeParts = scene
        .split("\n")
        .filter((l) => l.includes("attached to Badge"));

      expect(rounded.isError).toBeUndefined();
      expect(await line("Sign text")).toMatch(/^- Sign text: mesh/);
      expect(await line("Sign text")).toContain("lettering “ZY”");
      expect(await line("Sign text")).toMatch(/, closed/);
      expect(badgeParts.length).toBeGreaterThan(0);
      for (const part of badgeParts) expect(part).toMatch(/^- [^:]+: mesh/);
    });

    it("measures an imported model as closed, a mirror without its overlap, and limits a bevel", async () => {
      await call("blender_export", { output: "beam.stl", objects: ["Beam"] });
      await call("blender_add_objects", {
        objects: [
          {
            name: "Reprinted",
            kind: "model",
            path: "beam.stl",
            location: [64, 0, 0.5],
          },
          // Drawn reaching 20 mm across its own x = 0.
          {
            name: "Half",
            kind: "outline",
            points: [
              [-0.02, -0.02],
              [0.04, -0.02],
              [0.04, 0.02],
              [-0.02, 0.02],
            ],
            height: 0.04,
            location: [66, 0, 0],
          },
        ],
      });
      const mirrored = await call("blender_shape_objects", {
        object: "Half",
        operations: [{ kind: "mirror", axes: ["x"] }],
      });
      const tooWide = await call("blender_shape_objects", {
        object: "Half",
        operations: [{ kind: "bevel", width: 0.5 }],
      });
      const scene = (await call("blender_describe_scene", {})).said;
      const part =
        scene.split("\n").find((l) => l.includes("attached to Reprinted")) ??
        "";

      // 3 × 0.1 × 0.1 m: 30 L, read from a file whose faces share no corners.
      expect(part).toMatch(/closed, 30(\.0+)? L/);
      // The 40 mm on its positive side, mirrored: 80 × 40 × 40 mm, not
      // 120 mm with the overlap counted twice.
      expect(mirrored.said).toContain("Now Half (80 × 40 × 40 mm)");
      expect(await line("Half")).toMatch(/closed, 128 cm³/);
      expect(tooWide.isError).toBe(true);
      expect(tooWide.said).toMatch(/the most it can round is 20 mm/);
    });

    it("says what the camera has hidden behind something, and when it is inside a shape", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Desk",
            kind: "cube",
            size: [1, 1, 0.8],
            location: [80, 5, 0.4],
          },
          {
            name: "Screen wall",
            kind: "cube",
            size: [4, 0.2, 2.5],
            location: [80, 3, 1.25],
          },
        ],
      });
      const blocked = await call("blender_set_camera", {
        location: [80, 0, 1],
        look_at_object: "Desk",
      });
      const inside = await call("blender_set_camera", {
        location: [80, 3, 1.25],
        look_at: [80, 5, 0.4],
      });
      const model = await call("blender_set_camera", {
        frame: { objects: ["Imported"], direction: "front" },
      });

      expect(blocked.said).toMatch(/has Desk hidden behind Screen wall/);
      expect(blocked.said).not.toMatch(/shows[^;]*Desk/);
      // With dozens of shapes about, it names ten it misses and counts the rest.
      expect(blocked.said).toMatch(
        /misses (?:[^,;.]+, ){9}[^,;.]+ and \d+ more/,
      );
      expect(inside.said).toMatch(/is inside Screen wall/);
      // A model's part is told with the model, not as well.
      expect(model.said).toMatch(/Imported/);
      expect(model.said).not.toMatch(/\bSource\b/);
    });

    it("frames a shape centred in the picture, from any side, and without perspective", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Ell",
            kind: "outline",
            points: [
              [0, 0],
              [0.6, 0],
              [0.6, 0.1],
              [0.1, 0.1],
              [0.1, 0.4],
              [0, 0.4],
            ],
            height: 0.3,
            location: [90, 0, 0],
          },
        ],
      });
      // Blender projects the shape's corners into the picture, 0 to 1 each way.
      const seen = async () => {
        const read = await call("blender_run_script", {
          code: [
            "import bpy, mathutils",
            "from bpy_extras.object_utils import world_to_camera_view",
            "s = bpy.context.scene",
            "o = bpy.data.objects['Ell']",
            "p = [world_to_camera_view(s, s.camera, o.matrix_world @ v.co) for v in o.data.vertices]",
            "f = s.camera.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))",
            "print('seen', min(q.x for q in p), max(q.x for q in p), min(q.y for q in p), max(q.y for q in p), f.x)",
          ].join("\n"),
        });
        const [left, right, bottom, top, forward] = (
          /seen (.+)/.exec(read.said)?.[1] ?? ""
        )
          .split(" ")
          .map(Number) as [number, number, number, number, number];
        return { left, right, bottom, top, forward };
      };
      const fits = (s: Awaited<ReturnType<typeof seen>>) => {
        expect((s.left + s.right) / 2).toBeCloseTo(0.5, 2);
        expect((s.bottom + s.top) / 2).toBeCloseTo(0.5, 2);
        // A margin of 0.1 leaves 90% for the shape on its tighter side.
        expect(Math.max(s.right - s.left, s.top - s.bottom)).toBeCloseTo(
          0.9,
          2,
        );
      };

      await call("blender_set_camera", {
        frame: { objects: ["Ell"], direction: "three-quarter" },
        resolution: [400, 300],
      });
      fits(await seen());
      const round = await call("blender_set_camera", {
        frame: { objects: ["Ell"], direction: "front", around: 90 },
      });
      const fromRight = await seen();
      fits(fromRight);
      const plan = await call("blender_set_camera", {
        orthographic: true,
        frame: { objects: ["Ell"], direction: "top" },
      });
      fits(await seen());
      const camera = await line("Camera");
      await call("blender_set_camera", { orthographic: false });

      // Where that lands, said outright: a turn adds to the direction's own.
      expect(round.said).toContain(
        "from the front, 90° round: 90° round from the front, on the right side",
      );
      // Looking from the right, toward -x.
      expect(fromRight.forward).toBeLessThan(-0.95);
      expect(plan.said).toMatch(/orthographic.*across/);
      expect(camera).toMatch(/orthographic, [\d.]+ m?m across/);
    });
  });

  it("slides the picture without turning the camera, says the shift however it was set, and still frames a shape in the middle", async () => {
    await call("blender_open_scene", { path: "shift.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Tower", kind: "cube", size: [1, 1, 4], location: [0, 0, 2] },
      ],
    });
    // Where Blender puts the tower in the picture, 0 to 1 each way: its
    // middle and its edges; and how far the camera looks up or down.
    const seen = async () => {
      const read = await call("blender_run_script", {
        code: [
          "import bpy, mathutils",
          "from bpy_extras.object_utils import world_to_camera_view",
          "s = bpy.context.scene",
          "o = bpy.data.objects['Tower']",
          "m = world_to_camera_view(s, s.camera, mathutils.Vector((0, 0, 2)))",
          "p = [world_to_camera_view(s, s.camera, o.matrix_world @ v.co) for v in o.data.vertices]",
          "f = s.camera.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))",
          "print('seen', m.x, m.y, f.z, min(q.x for q in p), max(q.x for q in p), min(q.y for q in p), max(q.y for q in p))",
        ].join("\n"),
      });
      const [x, y, tilt, left, right, bottom, top] = (
        /seen (.+)/.exec(read.said)?.[1] ?? ""
      )
        .split(" ")
        .map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      return { x, y, tilt, left, right, bottom, top };
    };
    const camera = async () =>
      (await call("blender_describe_scene", { objects: ["Camera"] })).said
        .split("\n")
        .find((l) => l.startsWith("- Camera:")) ?? "";

    await call("blender_set_camera", {
      location: [0, -10, 2],
      look_at: [0, 0, 2],
      lens: 35,
      resolution: [400, 300],
    });
    const level = await seen();
    const shifted = await call("blender_set_camera", { shift: [0, 0.1] });
    const slid = await seen();
    const zoomed = await call("blender_set_camera", { lens: 50 });
    const described = await camera();
    await call("blender_run_script", {
      code: "import bpy\nbpy.context.scene.camera.data.shift_x = -0.05",
    });
    const byScript = await camera();
    const fitted = await call("blender_set_camera", {
      frame: { objects: ["Tower"], direction: "front" },
    });
    const framed = await seen();
    await call("blender_set_camera", {
      location: [0, -10, 2],
      look_at: [0, 0, 2],
      lens: 35,
    });
    // Slid up by six tenths of the picture's width, the camera looks over the tower.
    const over = await call("blender_set_camera", { shift: [0, 0.6] });
    const none = await call("blender_set_camera", { shift: [0, 0] });
    const back = await camera();

    expect(level.x).toBeCloseTo(0.5, 3);
    expect(level.y).toBeCloseTo(0.5, 3);
    // What the camera sees slid up by a tenth of the picture's width, so the
    // tower sits that much lower in it; the camera itself stayed level.
    expect(slid.x).toBeCloseTo(0.5, 3);
    expect(slid.y).toBeCloseTo(0.5 - (0.1 * 400) / 300, 3);
    expect(slid.tilt).toBeCloseTo(0, 5);
    expect(shifted.said).toContain("lens shifted 0 across and 0.1 up");
    // Another camera call leaves the shift and says it again.
    expect(zoomed.said).toContain("lens shifted 0 across and 0.1 up");
    expect(described).toContain("lens shifted 0 across and 0.1 up");
    expect(byScript).toContain("lens shifted -0.05 across and 0.1 up");
    // Framing keeps its promise under a shift: the shape in the middle.
    expect(fitted.said).toContain("lens shifted -0.05 across and 0.1 up");
    expect((framed.left + framed.right) / 2).toBeCloseTo(0.5, 2);
    expect((framed.bottom + framed.top) / 2).toBeCloseTo(0.5, 2);
    expect(
      Math.max(framed.right - framed.left, framed.top - framed.bottom),
    ).toBeCloseTo(0.9, 2);
    expect(over.said).toContain("misses Tower");
    expect(none.said).toContain("lens not shifted");
    expect(none.said).toContain("shows Tower whole");
    expect(back).not.toContain("shifted");
  });

  it("looks straight down with +y up the picture, as a plan reads, and a turn round turns the picture", async () => {
    await call("blender_open_scene", { path: "plan.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Middle", kind: "cube", size: [1, 1, 1] },
        { name: "North", kind: "cube", size: [1, 1, 1], location: [0, 3, 0] },
        { name: "East", kind: "cube", size: [1, 1, 1], location: [3, 0, 0] },
      ],
    });
    // Where North and East are in the picture from Middle: across, then up.
    const seen = async () => {
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "from bpy_extras.object_utils import world_to_camera_view",
          "s = bpy.context.scene",
          "at = lambda name: world_to_camera_view(s, s.camera, bpy.data.objects[name].matrix_world.translation)",
          "m, n, e = at('Middle'), at('North'), at('East')",
          "print('seen', n.x - m.x, n.y - m.y, e.x - m.x, e.y - m.y)",
        ].join("\n"),
      });
      const [northAcross, northUp, eastAcross, eastUp] = (
        /seen (.+)/.exec(read.said)?.[1] ?? ""
      )
        .split(" ")
        .map(Number) as [number, number, number, number];
      return { northAcross, northUp, eastAcross, eastUp };
    };
    const northUp = (s: Awaited<ReturnType<typeof seen>>) => {
      expect(s.northUp).toBeGreaterThan(0.1);
      expect(s.northAcross).toBeCloseTo(0, 3);
      expect(s.eastAcross).toBeGreaterThan(0.1);
      expect(s.eastUp).toBeCloseTo(0, 3);
    };

    const plan = await call("blender_set_camera", {
      orthographic: true,
      resolution: [400, 300],
      frame: { direction: "top" },
    });
    northUp(await seen());
    expect(plan.said).toContain("from the top, +y up the picture");

    const turned = await call("blender_set_camera", {
      frame: { direction: "top", around: 180 },
    });
    const southUp = await seen();
    expect(southUp.northUp).toBeLessThan(-0.1);
    expect(southUp.eastAcross).toBeLessThan(-0.1);
    expect(turned.said).toContain(
      "180° round: straight from above, -y up the picture",
    );

    // A quarter turn anticlockwise comes round to the right, so -x is up.
    const quarter = await call("blender_set_camera", {
      frame: { direction: "top", around: 90 },
    });
    const westUp = await seen();
    expect(westUp.eastUp).toBeLessThan(-0.1);
    expect(westUp.northAcross).toBeGreaterThan(0.1);
    expect(quarter.said).toContain("-x up the picture");

    // Raised all the way from the front, and placed by hand above: the same.
    await call("blender_set_camera", {
      frame: { direction: "front", elevation: 90 },
    });
    northUp(await seen());
    await call("blender_set_camera", {
      orthographic: false,
      location: [0, 0, 20],
      look_at: [0, 0, 0],
    });
    northUp(await seen());
  });

  it("bends lettering round a jar, so all of it lies on the surface and it is as long along it", async () => {
    await call("blender_open_scene", { path: "jar.blend", create: true });
    const lettering = {
      kind: "text",
      text: "WILDFLOWER",
      height: 0.008,
      depth: 0.0005,
      rotation: [90, 0, 0],
    };
    const added = await call("blender_add_objects", {
      objects: [
        { name: "Jar", kind: "cylinder", size: [0.07, 0.07, 0.1] },
        {
          ...lettering,
          name: "Bent",
          location: [0, -0.035, 0],
          wrap_radius: 0.035,
        },
        { ...lettering, name: "Flat", location: [0, -0.035, 0.03] },
        // Its back on the surface: the middle of its depth half of it out.
        {
          ...lettering,
          name: "On it",
          location: [0, -0.03525, -0.03],
          wrap_radius: 0.035,
        },
      ],
    });
    const saidOf = (name: string) =>
      added.said.split("\n").find((l) => l.startsWith(`Added ${name} `)) ?? "";
    // How far each is from the jar's axis, nearest and furthest, how wide it
    // is across, and the angle it covers round the axis.
    const measured = async (name: string) => {
      const read = await call("blender_run_script", {
        code: [
          "import bpy, math",
          `o = bpy.data.objects['${name}']`,
          "p = [o.matrix_world @ v.co for v in o.data.vertices]",
          "r = [math.hypot(q.x, q.y) for q in p]",
          "a = [math.atan2(q.x, -q.y) for q in p]",
          "print('seen', min(r), max(r), max(q.x for q in p) - min(q.x for q in p), max(a) - min(a))",
        ].join("\n"),
      });
      const [nearest, furthest, across, angle] = (
        /seen (.+)/.exec(read.said)?.[1] ?? ""
      )
        .split(" ")
        .map(Number) as [number, number, number, number];
      return { nearest, furthest, across, angle };
    };
    const bent = await measured("Bent");
    const flat = await measured("Flat");
    const tooLong = await call("blender_add_objects", {
      objects: [
        {
          ...lettering,
          name: "Too long",
          text: "WILDFLOWER HONEY FROM THE HILLS",
          wrap_radius: 0.01,
        },
      ],
    });
    const notText = await call("blender_add_objects", {
      objects: [
        { name: "Box", kind: "cube", size: [0.1, 0.1, 0.1], wrap_radius: 0.1 },
      ],
    });
    const described = (await call("blender_describe_scene", {})).said;

    // Flat lettering stands off the jar at its ends, by millimetres.
    expect(flat.furthest - 0.035).toBeGreaterThan(0.004);
    // Bent, its back is on the surface and its face a letter's depth out.
    expect(bent.nearest).toBeGreaterThan(0.035 - 0.0003);
    expect(bent.furthest).toBeLessThan(0.035 + 0.0006);
    // As long along the surface as it was flat.
    expect(bent.angle * 0.035).toBeCloseTo(flat.across, 3);
    expect(added.said).toMatch(/Added Bent .*bent round a 35 mm radius/);
    // Half a millimetre thick and placed by its middle, it is a quarter of a
    // millimetre into the jar, and is said to be about that deep, not deeper
    // than it is thick. Lying on the jar, it does not go into it.
    const sunk = Number(/goes ([\d.]+) mm into Jar/.exec(saidOf("Bent"))?.[1]);
    expect(sunk).toBeGreaterThan(0.15);
    expect(sunk).toBeLessThan(0.4);
    expect(saidOf("On it")).toContain("bent round");
    expect(saidOf("On it")).not.toContain("into");
    expect(described).toMatch(/- Bent: .*bent round a 35 mm radius/);
    expect(tooLong.isError).toBe(true);
    expect(tooLong.said).toMatch(/longer than the way round/);
    expect(notText.isError).toBe(true);
    expect(notText.said).toContain("wrap_radius is for text");
  });

  it("turns a profile that stays off the axis into a solid band, which lies on a jar without going into it", async () => {
    await call("blender_open_scene", { path: "band.blend", create: true });
    // A label 0.15 mm thick round a jar of 32 mm radius, by its four corners.
    const corners = [
      [0.032, 0.018],
      [0.03215, 0.018],
      [0.03215, 0.058],
      [0.032, 0.058],
    ];
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Jar",
          kind: "cylinder",
          size: [0.064, 0.064, 0.08],
          segments: 96,
          location: [0, 0, 0.04],
        },
        { name: "Band", kind: "revolve", profile: corners, segments: 96 },
        // Ended on its first point, it is the same band.
        {
          name: "Ended",
          kind: "revolve",
          profile: [...corners, corners[0]],
          segments: 96,
          location: [1, 0, 0],
        },
        {
          name: "Sheet",
          kind: "revolve",
          profile: corners,
          closed: false,
          location: [2, 0, 0],
        },
        // Its ends on the axis are joined by the axis: asked to be closed,
        // it is the solid it would have been.
        {
          name: "Turned",
          kind: "revolve",
          profile: [
            [0, 0],
            [0.02, 0],
            [0.02, 0.03],
            [0, 0.03],
          ],
          closed: true,
          location: [4, 0, 0],
        },
        // Two points have nothing to enclose: paper with no thickness.
        {
          name: "Paper",
          kind: "revolve",
          profile: [corners[1], corners[2]],
          location: [3, 0, 0],
        },
      ],
    });
    const described = (await call("blender_describe_scene", {})).said;
    const lineOf = (name: string) =>
      described.split("\n").find((l) => l.startsWith(`- ${name}:`)) ?? "";
    const saidOf = (name: string) =>
      added.said.split("\n").find((l) => l.startsWith(`Added ${name} `)) ?? "";

    // 2π × 32.075 mm round, 0.15 mm thick and 40 mm high: 1.2 cm³.
    expect(lineOf("Band")).toMatch(/, closed, 1\.2\d* cm³/);
    expect(lineOf("Ended")).toMatch(/, closed, 1\.2\d* cm³/);
    expect(lineOf("Sheet")).toMatch(/, open/);
    // π × 20² × 30 mm³.
    expect(lineOf("Turned")).toMatch(/, closed, 37\.\d+ cm³/);
    expect(lineOf("Paper")).toMatch(/, open/);
    // Against the jar's side all the way round, it is not in it.
    expect(saidOf("Band")).not.toContain("into");
    expect(saidOf("Jar")).not.toContain("into Band");
  });

  it("measures lettering attached to a jar by its own thickness, so the label under it goes into nothing", async () => {
    await call("blender_open_scene", { path: "attached.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Jar",
          kind: "cylinder",
          size: [0.064, 0.064, 0.08],
          segments: 96,
          location: [0, 0, 0.04],
        },
        // A label half a millimetre thick, against the jar all the way round.
        {
          name: "Label",
          kind: "revolve",
          profile: [
            [0.032, 0.018],
            [0.0325, 0.018],
            [0.0325, 0.058],
            [0.032, 0.058],
          ],
          segments: 96,
        },
        // Lettering 0.3 mm deep with its back on the label, a part of the jar.
        {
          name: "Lettering",
          kind: "text",
          text: "HONEY",
          height: 0.008,
          depth: 0.0003,
          rotation: [90, 0, 0],
          location: [0, -0.03265, 0.038],
          wrap_radius: 0.0325,
          parent: "Jar",
        },
      ],
    });
    const described = (await call("blender_describe_scene", {})).said;
    const lineOf = (name: string) =>
      described.split("\n").find((l) => l.startsWith(`- ${name}:`)) ?? "";

    expect(lineOf("Lettering")).toContain("attached to Jar");
    expect(lineOf("Label")).not.toContain("into");
    expect(lineOf("Jar")).not.toContain("into");
    expect(lineOf("Lettering")).not.toContain("into");
  });

  it("draws a quick picture in the objects' own colours while the view turns, and leaves the scene as it was", async () => {
    await call("blender_open_scene", { path: "quick.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Brick", kind: "cube", size: [0.1, 0.1, 0.1] }],
    });
    await call("blender_set_material", {
      objects: ["Brick"],
      material: { name: "Brick red", color: "#c81e1e", roughness: 0.6 },
    });
    await call("blender_set_lighting", { preset: "product" });
    const settings =
      "import bpy\ns = bpy.context.scene\nm = bpy.data.materials['Brick red']\nprint('settings', s.render.engine, s.display.shading.color_type, s.render.resolution_percentage, tuple(round(c, 3) for c in m.diffuse_color), tuple(round(c, 3) for c in s.world.color), [o.hide_render for o in s.objects])";
    const before = (await call("blender_run_script", { code: settings })).said;

    const session = scenes.scene("live");
    // The change's own picture is drawn before the view turns.
    await call("blender_api", { name: "Object" });
    const pictures: ScenePreview[] = [];
    const known = session.state().preview?.sequence ?? 0;
    const stop = session.onState((state) => {
      const latest = pictures.at(-1)?.sequence ?? known;
      if (state.preview && state.preview.sequence > latest)
        pictures.push(state.preview);
    });
    session.look({ kind: "turn", yaw: 20, pitch: 0 });
    for (let tries = 0; tries < 300 && pictures.length < 2; tries++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    const [quick, full] = pictures;
    await writeFile(
      join(workspace, "quick.jpg"),
      Buffer.from(quick!.data, "base64"),
    );
    // Blender reads the middle of the quick picture, where the brick is.
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//quick.jpg'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "patch = [(y * w + x) * 4 for x in range(w // 2 - 4, w // 2 + 4) for y in range(h // 2 - 4, h // 2 + 4)]",
        "print('brick', *[sum(p[i + c] for i in patch) / len(patch) for c in range(3)])",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const [red, green, blue] = (/brick (.+)/.exec(read.said)?.[1] ?? "")
      .split(" ")
      .map(Number) as [number, number, number];
    const after = (await call("blender_run_script", { code: settings })).said;

    expect(quick?.quick).toBe(true);
    expect(full?.quick).toBeUndefined();
    expect(red).toBeGreaterThan(Math.max(green, blue) * 1.8);
    expect(after.match(/settings .+/)?.[0]).toBe(
      before.match(/settings .+/)?.[0],
    );
  });

  it("says a preview of a scene with nothing in it is empty", async () => {
    await call("blender_open_scene", { path: "nothing.blend", create: true });
    const session = scenes.scene("live");
    session.look({ kind: "turn", yaw: 10, pitch: 0 });
    await call("blender_api", { name: "Object" });
    expect(session.state().preview?.empty).toBe(true);

    await call("blender_add_objects", {
      objects: [{ name: "Something", kind: "cube" }],
    });
    await call("blender_api", { name: "Object" });
    expect(session.state().preview?.empty).toBeUndefined();
  });

  it("gives a box walls as thick as asked, keeping its outside", async () => {
    await call("blender_open_scene", { path: "walls.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Case", kind: "cube", size: [0.1, 0.1, 0.1] }],
    });
    await call("blender_shape_objects", {
      object: "Case",
      operations: [{ kind: "solidify", thickness: 0.005 }],
    });
    const said = (await call("blender_describe_scene", { objects: ["Case"] }))
      .said;

    // 100 mm outside and 90 mm inside: 1000 - 729 = 271 cm³ of wall.
    expect(Number(/closed, ([\d.]+) cm³/.exec(said)?.[1])).toBeCloseTo(271, 0);
    expect(said).toContain("100 × 100 × 100 mm");
  });

  it("shows what is inside glass in the full preview, as a render does", async () => {
    await call("blender_open_scene", { path: "bottle.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Bottle", kind: "cube", size: [0.08, 0.08, 0.1] },
        {
          name: "Perfume",
          kind: "cube",
          size: [0.07, 0.07, 0.07],
          location: [0, 0, 0.005],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Bottle"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0,
      },
    });
    await call("blender_set_material", {
      objects: ["Perfume"],
      material: {
        name: "Amber",
        color: "#e07020",
        transmission: 1,
        roughness: 0,
        ior: 1.33,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Bottle"], direction: "front", margin: 0.3 },
    });
    const session = scenes.scene("live");
    session.look({ kind: "view", view: "camera" });
    // The quick picture, then the full one once the view is still.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await call("blender_api", { name: "Object" });
    const preview = session.state().preview;
    await writeFile(
      join(workspace, "bottle.jpg"),
      Buffer.from(preview!.data, "base64"),
    );
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//bottle.jpg'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "patch = [(y * w + x) * 4 for x in range(w // 2 - 4, w // 2 + 4) for y in range(h // 2 - 4, h // 2 + 4)]",
        "print('inside', *[sum(p[i + c] for i in patch) / len(patch) for c in range(3)])",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const [red, , blue] = (/inside (.+)/.exec(read.said)?.[1] ?? "")
      .split(" ")
      .map(Number) as [number, number, number];

    expect(preview?.quick).toBeUndefined();
    // Amber through clear glass: far more red than blue.
    expect(red).toBeGreaterThan(blue * 1.6);
  });

  it("keeps the full picture of a slow see-through scene far quicker than drawing it to the end, and leaves its settings as they were", async () => {
    await call("blender_open_scene", { path: "slow.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Jar", kind: "cube", size: [0.1, 0.1, 0.1] },
        { name: "Smoke", kind: "cube", size: [0.08, 0.08, 0.08] },
      ],
    });
    await call("blender_set_material", {
      objects: ["Jar"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Jar"], direction: "front", margin: 0.3 },
    });
    // Smoke that light scatters through many times: slow to draw however
    // few samples a picture takes.
    await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "s.cycles.volume_bounces = 128",
        "s.cycles.max_bounces = 128",
        "s.cycles.volume_step_rate = 0.05",
        "m = bpy.data.materials.new('Smoke')",
        "m.use_nodes = True",
        "t = m.node_tree",
        "t.nodes.remove(t.nodes['Principled BSDF'])",
        "scatter = t.nodes.new('ShaderNodeVolumeScatter')",
        "noise = t.nodes.new('ShaderNodeTexNoise')",
        "noise.inputs['Scale'].default_value = 40",
        "density = t.nodes.new('ShaderNodeMath')",
        "density.operation = 'MULTIPLY'",
        "density.inputs[1].default_value = 40000",
        "t.links.new(noise.outputs['Fac'], density.inputs[0])",
        "t.links.new(density.outputs[0], scatter.inputs['Density'])",
        "t.links.new(scatter.outputs[0], t.nodes['Material Output'].inputs['Volume'])",
        "bpy.data.objects['Smoke'].data.materials.append(m)",
      ].join("\n"),
    });
    const limit =
      "import bpy\nprint('limit', bpy.context.scene.cycles.time_limit)";
    const before = (await call("blender_run_script", { code: limit })).said;
    const session = scenes.scene("live");
    await call("blender_api", { name: "Object" });
    let full: ScenePreview | undefined;
    const known = session.state().preview?.sequence ?? 0;
    const stop = session.onState((state) => {
      if (
        state.preview &&
        state.preview.sequence > known &&
        !state.preview.quick
      )
        full ??= state.preview;
    });
    const began = Date.now();
    session.look({ kind: "view", view: "camera" });
    while (!full && Date.now() - began < 60_000)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const took = Date.now() - began;
    stop();
    const after = (await call("blender_run_script", { code: limit })).said;
    // The same scene at the full picture's size and samples, drawn to the
    // end. Whatever else is using the graphics card slows both, so the full
    // picture is held against this one rather than against the clock alone.
    const toTheEnd = await call("blender_render", {
      output: "renders/slow.png",
      engine: "cycles",
      samples: 16,
      resolution: [480, 270],
    });
    const drawing = Number(/ in ([\d.]+) s/.exec(toTheEnd.said)?.[1]) * 1000;

    expect(full).toBeDefined();
    // The wait before it, a second of drawing, and Blender's own preparation.
    expect(took).toBeLessThan(drawing / 2);
    expect(took).toBeLessThan(30_000);
    expect(after.match(/limit .+/)?.[0]).toBe(before.match(/limit .+/)?.[0]);
  });

  it("shows the product backdrop through clear glass as bright as beside it", async () => {
    await call("blender_open_scene", { path: "pane.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Pane", kind: "cube", size: [0.08, 0.01, 0.1] }],
    });
    await call("blender_set_material", {
      objects: ["Pane"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Pane"], direction: "front", margin: 0.4 },
      resolution: [200, 200],
    });
    await call("blender_render", {
      output: "renders/pane.png",
      engine: "cycles",
      samples: 16,
    });
    // Blender reads its own picture: through the pane's middle, and the
    // backdrop beside it at the same height.
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//renders/pane.png'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "bright = lambda x: sum(p[((h // 2 + dy) * w + x) * 4 + c] for c in range(3) for dy in range(-4, 5)) / 27",
        "print('through', bright(w // 2) * 255, 'beside', bright(8) * 255)",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const [, through, beside] =
      /through ([\d.]+) beside ([\d.]+)/.exec(read.said) ?? [];

    // Clear glass hides nothing behind it: no grey, smoked look.
    expect(Number(through)).toBeGreaterThan(Number(beside) * 0.9);
  });

  it("renders a glass that stands on the backdrop as it does one a hair above it", async () => {
    await call("blender_open_scene", { path: "standing.blend", create: true });
    // A jar 65 mm across with walls 3 mm and a base 5 mm thick.
    await call("blender_add_objects", {
      objects: [
        {
          name: "Jar",
          kind: "revolve",
          profile: [
            [0, 0],
            [0.0325, 0],
            [0.0325, 0.08],
            [0.0295, 0.08],
            [0.0295, 0.005],
            [0, 0.005],
          ],
          segments: 96,
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Jar"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0,
        ior: 1.45,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: {
        objects: ["Jar"],
        direction: "front",
        elevation: 25,
        margin: 0.1,
      },
      resolution: [500, 500],
    });
    // Blender reads its own picture: up the front of the jar's base from
    // where it meets the floor, and the darkest it gets there.
    const darkest = async (output: string) => {
      await call("blender_render", { output, engine: "cycles", samples: 64 });
      const read = await call("blender_run_script", {
        code: [
          "import bpy, mathutils",
          "from bpy_extras.object_utils import world_to_camera_view",
          "scene = bpy.context.scene",
          "at = world_to_camera_view(scene, scene.camera, mathutils.Vector((0, -0.0325, 0)))",
          `image = bpy.data.images.load(bpy.path.abspath('//${output}'))`,
          "w, h = image.size",
          "p = image.pixels[:]",
          "x0, y0 = int(at.x * w), int(at.y * h)",
          "across = lambda y: sum(p[(y * w + x0 + dx) * 4 + c] for c in range(3) for dx in range(-6, 7)) / 39 * 255",
          "column = [across(y0 + dy) for dy in range(-2, 16)]",
          "print('darkest', min(column))",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      return Number(/darkest ([\d.]+)/.exec(read.said)?.[1]);
    };

    const standing = await darkest("renders/standing.png");
    await call("blender_edit_objects", {
      edits: [{ object: "Jar", move_by: [0, 0, 0.0001] }],
    });
    const lifted = await darkest("renders/lifted.png");

    // Glass on a floor is not glass fused with it: where the base meets the
    // floor it shows what one a tenth of a millimetre above it shows.
    // Fused, it is 17 levels of 255 brighter there.
    expect(Math.abs(standing - lifted)).toBeLessThan(6);
  });

  it("says when two see-through shapes have surfaces in the same place, until one reaches into the other", async () => {
    await call("blender_open_scene", { path: "flush.blend", create: true });
    const glass = {
      name: "Glass",
      color: "#ffffff",
      transmission: 1,
      roughness: 0,
      ior: 1.45,
    };
    const amber = {
      name: "Amber",
      color: "#9a5a08",
      transmission: 1,
      ior: 1.33,
    };
    await call("blender_add_objects", {
      objects: [
        // A jar 65 mm across with walls 3 mm and a base 5 mm thick.
        {
          name: "Jar",
          kind: "revolve",
          profile: [
            [0, 0],
            [0.0325, 0],
            [0.0325, 0.08],
            [0.0295, 0.08],
            [0.0295, 0.005],
            [0, 0.005],
          ],
          segments: 96,
        },
        // A liquid standing on the jar's floor, a hair short of its walls.
        {
          name: "Liquid",
          kind: "revolve",
          profile: [
            [0, 0.005],
            [0.0291, 0.005],
            [0.0291, 0.06],
            [0, 0.06],
          ],
          segments: 96,
        },
        // A lid on the rim is in the same place as it too, and hides it.
        {
          name: "Lid",
          kind: "cylinder",
          size: [0.068, 0.068, 0.01],
          location: [0, 0, 0.085],
        },
      ],
    });
    const first = await call("blender_set_material", {
      objects: ["Jar"],
      material: glass,
    });
    const second = await call("blender_set_material", {
      objects: ["Liquid"],
      material: amber,
    });
    const described = await call("blender_describe_scene", {});

    // The liquid's bottom, π × 29.1² mm², lies in the place of the jar's floor.
    const told =
      /Jar and Liquid are both see-through and have 26\.\d+ cm² of their surfaces in the same place/;
    expect(first.said).not.toContain("same place");
    expect(second.said).toMatch(told);
    expect(described.said).toMatch(told);
    expect(described.said).not.toMatch(/Lid are both|and Lid are/);

    // Drawn again 0.2 mm into the glass, at the sides and underneath.
    await call("blender_edit_objects", {
      edits: [{ object: "Liquid", delete: true }],
    });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Liquid",
          kind: "revolve",
          profile: [
            [0, 0.0048],
            [0.0297, 0.0048],
            [0.0297, 0.06],
            [0, 0.06],
          ],
          segments: 96,
        },
      ],
    });
    const third = await call("blender_set_material", {
      objects: ["Liquid"],
      material: amber,
    });

    expect(third.said).not.toContain("same place");
    expect((await call("blender_describe_scene", {})).said).not.toContain(
      "same place",
    );
  });

  it("renders a product on exact white with its own shadow, as marketplaces ask", async () => {
    await call("blender_open_scene", { path: "white.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Box",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [0, 0, 0.05],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Box"],
      material: { name: "Grey", color: "#777777", roughness: 0.6 },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Box"], direction: "three-quarter", margin: 0.4 },
      resolution: [160, 160],
    });
    const eevee = await call("blender_render", {
      output: "renders/white-eevee.png",
      engine: "eevee",
      background: "white",
    });
    for (const [output, background] of [
      ["renders/lit.png", undefined],
      ["renders/cut-out.png", "transparent"],
      ["renders/white.png", "white"],
    ] as const)
      await call("blender_render", {
        output,
        engine: "cycles",
        samples: 16,
        ...(background ? { background } : {}),
      });
    // Blender reads the pictures: the corners of the white one, the box's
    // middle in it and in the lit one, how much of the white one is not
    // white, and how much of the cut-out the box covers.
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "def load(name):",
        "    image = bpy.data.images.load(bpy.path.abspath('//renders/' + name))",
        "    w, h = image.size",
        "    p = image.pixels[:]",
        "    bpy.data.images.remove(image)",
        "    return w, h, p",
        "w, h, white = load('white.png')",
        "_, _, lit = load('lit.png')",
        "_, _, cut = load('cut-out.png')",
        "corners = min(white[i * 4 + c] for i in (0, w - 1, w * (h - 1), w * h - 1) for c in range(3))",
        "middle = lambda p: sum(p[((h // 2) * w + w // 2) * 4 + c] for c in range(3)) / 3",
        "shaded = sum(1 for i in range(w * h) if sum(white[i * 4:i * 4 + 3]) / 3 < 0.98)",
        "covered = sum(1 for i in range(w * h) if cut[i * 4 + 3] > 0.5)",
        "print('white', corners, middle(white), middle(lit), shaded, covered)",
      ].join("\n"),
    });
    const [corners, whiteMiddle, litMiddle, shaded, covered] = (
      /white (.+)/.exec(read.said)?.[1] ?? ""
    )
      .split(" ")
      .map(Number) as [number, number, number, number, number];

    expect(eevee.isError).toBe(true);
    expect(eevee.said).toMatch(/Cycles/);
    // Exact white, 255, where the backdrop was.
    expect(corners).toBe(1);
    // The box itself as it renders on the backdrop.
    expect(whiteMiddle).toBeCloseTo(litMiddle, 1);
    // Its shadow on the floor greys more of the picture than the box covers.
    expect(shaded).toBeGreaterThan(covered * 1.05);
  });

  it("shows white through clear glass on a white background, and leaves nothing in the workspace but the picture", async () => {
    await call("blender_open_scene", {
      path: "glass-on-white.blend",
      create: true,
    });
    await call("blender_add_objects", {
      objects: [{ name: "Pane", kind: "cube", size: [0.08, 0.01, 0.1] }],
    });
    await call("blender_set_material", {
      objects: ["Pane"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Pane"], direction: "front", margin: 0.4 },
      resolution: [200, 200],
    });
    await call("blender_render", {
      output: "renders/pane-on-white.png",
      engine: "cycles",
      samples: 16,
      background: "white",
    });
    // Blender reads its own picture through the pane's middle.
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//renders/pane-on-white.png'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "print('through', sum(p[((h // 2) * w + w // 2) * 4 + c] for c in range(3)) / 3)",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const through = Number(/through ([\d.]+)/.exec(read.said)?.[1]);
    const renders = await readdir(join(workspace, "renders"));

    // Light, as clear glass on white looks, not the backdrop's grey.
    expect(through).toBeGreaterThan(0.85);
    expect(renders.filter((name) => name.startsWith("pane-on-white"))).toEqual([
      "pane-on-white.png",
    ]);
  });

  it("follows light through a glass bottle and its liquid without dark bands", async () => {
    await call("blender_open_scene", { path: "bands.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Bottle",
          kind: "cube",
          size: [0.06, 0.06, 0.11],
          location: [0, 0, 0.055],
        },
        {
          name: "Liquid",
          kind: "cube",
          size: [0.0522, 0.0522, 0.05],
          location: [0, 0, 0.035],
        },
      ],
    });
    await call("blender_shape_objects", {
      object: "Bottle",
      operations: [
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "box",
            size: [0.052, 0.052, 0.1],
            location: [0, 0, 0.057],
          },
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Bottle"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0.02,
      },
    });
    await call("blender_set_material", {
      objects: ["Liquid"],
      material: {
        name: "Amber",
        color: "#8f4f0a",
        transmission: 1,
        roughness: 0,
        ior: 1.33,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Bottle"], direction: "three-quarter", margin: 0.2 },
      resolution: [240, 240],
    });
    await call("blender_render", {
      output: "renders/bands.png",
      engine: "cycles",
      samples: 32,
    });
    // Blender reads its own picture: how much of the bottle's middle is near
    // black, as light that runs out of bounces inside glass leaves it.
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//renders/bands.png'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "middle = [(y * w + x) * 4 for x in range(w // 3, 2 * w // 3) for y in range(h // 4, 3 * h // 4)]",
        "print('dark', sum(1 for i in middle if (p[i] + p[i + 1] + p[i + 2]) / 3 < 40 / 255) / len(middle))",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const settings = await call("blender_run_script", {
      code: "import bpy\nc = bpy.context.scene.cycles\nprint('bounces', c.max_bounces, c.glossy_bounces, c.transmission_bounces)",
    });

    expect(Number(/dark ([\d.e-]+)/.exec(read.said)?.[1])).toBeLessThan(0.005);
    // The scene keeps its own settings.
    expect(settings.said).toContain("bounces 12 4 12");
  });

  it("says the colour each object shows in a render, through glass too", async () => {
    await call("blender_open_scene", { path: "colours.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Brick",
          kind: "cube",
          size: [0.06, 0.06, 0.06],
          location: [-0.06, 0, 0.03],
        },
        {
          name: "Jar",
          kind: "cube",
          size: [0.06, 0.06, 0.08],
          location: [0.06, 0, 0.04],
        },
        {
          name: "Syrup",
          kind: "cube",
          size: [0.05, 0.05, 0.05],
          location: [0.06, 0, 0.03],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Brick"],
      material: { name: "Blue", color: "#1e3cc8", roughness: 0.6 },
    });
    await call("blender_set_material", {
      objects: ["Jar"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0,
      },
    });
    await call("blender_set_material", {
      objects: ["Syrup"],
      material: {
        name: "Red",
        color: "#b01010",
        transmission: 1,
        roughness: 0,
        ior: 1.33,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Brick", "Jar"], direction: "front", margin: 0.3 },
      resolution: [240, 160],
    });
    const settings =
      "import bpy\ns = bpy.context.scene\nprint('settings', s.render.engine, s.render.resolution_percentage, s.render.film_transparent, s.display.shading.light, s.display.shading.color_type, s.view_settings.view_transform, [(o.name, tuple(round(c, 3) for c in o.color), o.hide_render) for o in s.objects])";
    const before = (await call("blender_run_script", { code: settings })).said;
    const rendered = await call("blender_render", {
      output: "renders/colours.png",
      engine: "cycles",
      samples: 16,
    });
    const after = (await call("blender_run_script", { code: settings })).said;
    const colour = (name: string) => {
      const hex =
        new RegExp(`${name} #([0-9a-f]{6})`).exec(rendered.said)?.[1] ?? "";
      return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
        number,
        number,
        number,
      ];
    };
    const [brickRed, , brickBlue] = colour("Brick");
    const [syrupRed, , syrupBlue] = colour("Syrup");

    expect(brickBlue).toBeGreaterThan(brickRed * 1.5);
    expect(syrupRed).toBeGreaterThan(syrupBlue * 1.5);
    expect(rendered.said).toMatch(/Syrup #[0-9a-f]{6} through Jar/);
    expect(rendered.said).toMatch(/background #[0-9a-f]{6}/);
    expect(after.match(/settings .+/)?.[0]).toBe(
      before.match(/settings .+/)?.[0],
    );
  });

  it("says what a script left in the scene as the other tools say theirs: what it added, with heights and what goes into what, what it moved and what it removed", async () => {
    await call("blender_open_scene", { path: "scripted.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        // Its top is 740 mm high.
        {
          name: "Table",
          kind: "cube",
          size: [1.2, 0.6, 0.04],
          location: [0, 0, 0.72],
        },
        {
          name: "Mug",
          kind: "cylinder",
          size: [0.08, 0.08, 0.1],
          location: [0.4, 0, 0.79],
        },
        {
          name: "Old",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [2, 2, 0.05],
        },
      ],
    });
    const box = [
      "import bpy",
      "def box(name, size, at):",
      "    bpy.ops.mesh.primitive_cube_add(size=1, location=at)",
      "    made = bpy.context.object",
      "    made.name = name",
      "    made.scale = size",
      "    return made",
    ];

    const read = await call("blender_run_script", {
      code: "import bpy\nprint(len(bpy.context.scene.objects))",
    });
    const made = await call("blender_run_script", {
      code: [
        ...box,
        // Five millimetres into the table's top, and well above it.
        "box('Sunk', (0.1, 0.1, 0.1), (0.2, 0, 0.785))",
        "box('Floating', (0.1, 0.1, 0.1), (-0.2, 0, 0.95))",
        "bpy.data.objects['Mug'].location.x -= 0.9",
        "bpy.data.objects.remove(bpy.data.objects['Old'])",
        "print('done')",
      ].join("\n"),
    });
    const many = await call("blender_run_script", {
      code: [
        ...box,
        "for row in range(3):",
        "    for column in range(10):",
        "        box(f'Key {row * 10 + column + 1:03}', (0.018, 0.018, 0.01), (-0.3 + column * 0.02, -0.1 + row * 0.02, 0.745))",
        "box('Stray', (0.05, 0.05, 0.05), (0.5, 0.2, 1.5))",
      ].join("\n"),
    });

    // A rod down through five plates: it goes into each of them.
    const through = await call("blender_run_script", {
      code: [
        ...box,
        "for plate in range(5):",
        "    box(f'Plate {plate + 1}', (0.2, 0.2, 0.01), (3, 3, 0.1 + plate * 0.1))",
        "box('Rod', (0.02, 0.02, 0.6), (3, 3, 0.3))",
      ].join("\n"),
    });

    // A script that only looks says what it printed and no more.
    expect(read.said.trim()).toBe("3");
    // Of the many things one object goes into, the deepest three are named.
    expect(through.said).toMatch(
      /Added Rod \(.+\) at .+ high, goes [\d.]+ mm into Plate \d, goes [\d.]+ mm into Plate \d, goes [\d.]+ mm into Plate \d, goes into 2 more\./,
    );
    expect(made.said.split("\n")[0]).toBe("done");
    expect(made.said).toMatch(
      /Added Sunk \(100 × 100 × 100 mm\) at .+, from 735 mm to 835 mm high, goes 5(\.\d+)? mm into Table\./,
    );
    expect(made.said).toMatch(
      /Added Floating \(100 × 100 × 100 mm\) at .+, from 900 mm to 1 m high\./,
    );
    expect(made.said).toMatch(
      /Changed Mug \(.+\) at \(-500, 0, 790 mm\), from 740 mm to 840 mm high\./,
    );
    expect(made.said).toMatch(/Removed Old\./);
    // Past a dozen, what was made is counted by name, with how high it
    // reaches, and the answer says where the rest is told.
    expect(many.said).toMatch(
      /Added 31 objects: Key ×30, from 740 mm to 750 mm high; Stray, from 1\.475 m to 1\.525 m high\.\nblender_describe_scene with objects says of any of them where it is and what it goes into\./,
    );
    expect(made.said).not.toMatch(/blender_describe_scene/);
    expect(many.said).not.toMatch(/Added Key 001/);
  });

  /**
   * A plan picture's colour where a point of the floor plan is, as levels,
   * for a plan whose middle is at (2, 1.5).
   */
  const shown = async (picture: string, said: string, x: number, y: number) => {
    const across = Number(/, ([\d.]+) m across/.exec(said)?.[1]);
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        `image = bpy.data.images.load(bpy.path.abspath('//renders/${picture}'))`,
        "w, h = image.size",
        `column = int(w / 2 + (${x} - 2) / ${across} * w)`,
        `row = int(h / 2 + (${y} - 1.5) / ${across} * w)`,
        "at = (row * w + column) * 4",
        "print('shown', ' '.join(str(round(c * 255)) for c in image.pixels[at:at + 3]))",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    return (/shown (.+)/.exec(read.said)?.[1] ?? "").split(" ").map(Number);
  };
  const oak = [185, 138, 90];
  const near = (colour: number[], given: number[]) =>
    colour.length === 3 &&
    colour.every((level, channel) => Math.abs(level - given[channel]!) < 25);
  const dark = (colour: number[]) =>
    colour.length === 3 && colour.every((level) => level < 90);
  const light = (colour: number[]) =>
    colour.length === 3 && colour.every((level) => level > 180);

  it("cuts a plan at 1.2 m as a drawn plan is: walls are filled dark, a door shows in its opening and a window by its sill, and a wardrobe keeps its colour", async () => {
    await call("blender_open_scene", { path: "cut-plan.blend", create: true });
    const box = (name: string, size: number[], location: number[]) => ({
      name,
      kind: "cube",
      size,
      location,
    });
    await call("blender_add_objects", {
      objects: [
        box("Floor", [4.4, 3.4, 0.1], [2, 1.5, -0.05]),
        box("Wall south", [4.4, 0.2, 2.5], [2, -0.1, 1.25]),
        box("Wall north", [4.4, 0.2, 2.5], [2, 3.1, 1.25]),
        box("Wall west", [0.2, 3, 2.5], [-0.1, 1.5, 1.25]),
        box("Wall east", [0.2, 3, 2.5], [4.1, 1.5, 1.25]),
        box("Ceiling", [4.4, 3.4, 0.1], [2, 1.5, 2.55]),
        box("Wardrobe", [1, 0.6, 2], [0.6, 2.6, 1]),
        box("Table", [1, 0.6, 0.7], [3, 1.5, 0.35]),
        // The door's leaf, closed, on the outer side of its opening.
        box("Door", [0.9, 0.08, 2.1], [1, -0.15, 1.05]),
      ],
    });
    // A door 0.9 m wide and 2.1 m high, and a window from 0.9 m to 2.1 m.
    await call("blender_shape_objects", {
      object: "Wall south",
      operations: [
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "box",
            size: [0.9, 0.6, 2.1],
            location: [1, -0.1, 1.05],
          },
        },
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "box",
            size: [1.2, 0.6, 1.2],
            location: [3, -0.1, 1.5],
          },
        },
      ],
    });
    const paint = (objects: string[], name: string, color: string) =>
      call("blender_set_material", {
        objects,
        material: { name, color, roughness: 0.8 },
      });
    await paint(["Floor"], "Oak", "#b98a5a");
    await paint(
      ["Wall south", "Wall north", "Wall west", "Wall east", "Ceiling"],
      "Plaster",
      "#f0f0f0",
    );
    await paint(["Wardrobe"], "Blue", "#2040c0");
    await paint(["Table"], "Green", "#20a040");
    await paint(["Door"], "Red", "#c02020");
    const kept = [
      "import bpy",
      "s = bpy.context.scene",
      "print('kept', len(bpy.data.objects), len(bpy.data.meshes), len(bpy.data.materials), len(bpy.data.cameras), len(bpy.data.worlds),",
      "      sorted(o.name for o in s.objects if o.hide_render))",
    ].join("\n");
    const before = await call("blender_describe_scene", {});
    const keptBefore = (await call("blender_run_script", { code: kept })).said;

    const plan = await call("blender_render", {
      output: "renders/cut-plan.png",
      view: "plan",
      resolution: [440, 340],
    });
    const high = await call("blender_render", {
      output: "renders/cut-high.png",
      view: "plan",
      cut: 2.3,
      without: ["Ceiling"],
      resolution: [440, 340],
    });
    const after = await call("blender_describe_scene", {});
    const keptAfter = (await call("blender_run_script", { code: kept })).said;
    const throughCamera = await call("blender_render", {
      output: "renders/cut-camera.png",
      engine: "eevee",
      cut: 1.2,
    });

    expect(plan.isError).toBeUndefined();
    expect({
      // Under the ceiling, which stands above the cut and was not named.
      room: near(await shown("cut-plan.png", plan.said, 2, 1), oak),
      // The floor shows in the opening, beside the door's leaf.
      doorway: near(await shown("cut-plan.png", plan.said, 1, -0.04), oak),
      // Lower than the walls, the leaf and the wardrobe keep their colours.
      doorLeaf: near(
        await shown("cut-plan.png", plan.said, 1, -0.15),
        [192, 32, 32],
      ),
      windowSill: light(await shown("cut-plan.png", plan.said, 3, -0.1)),
      wall: dark(await shown("cut-plan.png", plan.said, 2, -0.1)),
      wardrobe: near(
        await shown("cut-plan.png", plan.said, 0.6, 2.6),
        [32, 64, 192],
      ),
      table: near(
        await shown("cut-plan.png", plan.said, 3, 1.5),
        [32, 160, 64],
      ),
    }).toEqual({
      room: true,
      doorway: true,
      doorLeaf: true,
      windowSill: true,
      wall: true,
      wardrobe: true,
      table: true,
    });
    expect(plan.said).toMatch(
      /The plan is cut at 1\.2 m, as a drawn plan is: Ceiling stands above it and is not drawn; Wall south, Wall north, Wall west and Wall east, the highest it passes through, are filled dark there; and Wardrobe and Door, which it passes through lower than those, are filled in their own colours\. cut sets another height\./,
    );
    expect(plan.said).not.toMatch(/lies over/);
    // Cut above the door's head, the wall over the door is filled like the rest.
    expect(high.said).toMatch(/The plan is cut at 2\.3 m/);
    expect({
      door: dark(await shown("cut-high.png", high.said, 1, -0.04)),
      windowSill: dark(await shown("cut-high.png", high.said, 3, -0.1)),
      wardrobe: near(
        await shown("cut-high.png", high.said, 0.6, 2.6),
        [32, 64, 192],
      ),
    }).toEqual({ door: true, windowSill: true, wardrobe: true });
    // Nothing made for the cut stays in the scene.
    expect(after.said).toBe(before.said);
    expect(keptAfter.match(/kept .+/)?.[0]).toBe(
      keptBefore.match(/kept .+/)?.[0],
    );
    expect(throughCamera.isError).toBe(true);
    expect(throughCamera.said).toMatch(/cut is a plan's/);
  });

  it("fills walls drawn as one outline with openings cut into it, a window's sill at the very height of the cut, and draws nothing that starts there", async () => {
    await call("blender_open_scene", {
      path: "cut-outline.blend",
      create: true,
    });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Floor",
          kind: "cube",
          size: [4.4, 3.4, 0.1],
          location: [2, 1.5, -0.05],
        },
        {
          name: "Walls",
          kind: "outline",
          points: [
            [-0.2, -0.2],
            [4.2, -0.2],
            [4.2, 3.2],
            [-0.2, 3.2],
          ],
          holes: [
            [
              [0, 0],
              [4, 0],
              [4, 3],
              [0, 3],
            ],
          ],
          height: 2.5,
          location: [0, 0, 0],
        },
        // From 1.2 m up: it starts where the plan is cut.
        {
          name: "Wall cabinet",
          kind: "cube",
          size: [1, 0.4, 0.8],
          location: [0.7, 2.8, 1.6],
        },
      ],
    });
    // A door to 2.1 m, and a window whose sill is 1.2 m up: at the cut.
    await call("blender_shape_objects", {
      object: "Walls",
      operations: [
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "box",
            size: [0.9, 0.4, 2.1],
            location: [1, -0.1, 1.05],
          },
        },
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "box",
            size: [1.2, 0.4, 0.9],
            location: [3, -0.1, 1.65],
          },
        },
      ],
    });
    const paint = (objects: string[], name: string, color: string) =>
      call("blender_set_material", {
        objects,
        material: { name, color, roughness: 0.8 },
      });
    await paint(["Floor"], "Oak", "#b98a5a");
    await paint(["Walls"], "Plaster", "#f0f0f0");
    await paint(["Wall cabinet"], "Red", "#c02020");

    const plan = await call("blender_render", {
      output: "renders/cut-outline.png",
      view: "plan",
      resolution: [440, 340],
    });

    expect(plan.isError).toBeUndefined();
    expect(plan.said).toMatch(
      /The plan is cut at 1\.2 m, as a drawn plan is: Wall cabinet stands above it and is not drawn; and Walls, the highest it passes through, is filled dark there\. cut sets another height\./,
    );
    expect({
      wall: dark(await shown("cut-outline.png", plan.said, 2, -0.1)),
      farWall: dark(await shown("cut-outline.png", plan.said, 2, 3.1)),
      doorway: near(await shown("cut-outline.png", plan.said, 1, -0.1), oak),
      windowSill: light(await shown("cut-outline.png", plan.said, 3, -0.1)),
      underTheCabinet: near(
        await shown("cut-outline.png", plan.said, 0.7, 2.8),
        oak,
      ),
    }).toEqual({
      wall: true,
      farWall: true,
      doorway: true,
      windowSill: true,
      underTheCabinet: true,
    });
  });

  it("draws a flat's plan from above in one call, floors at their colours, and leaves the scene as it was", async () => {
    await call("blender_open_scene", { path: "plan.blend", create: true });
    const wall = (name: string, size: number[], location: number[]) => ({
      name,
      kind: "cube",
      size,
      location,
    });
    await call("blender_add_objects", {
      objects: [
        wall("Floor", [4, 3, 0.1], [2, 1.5, -0.05]),
        wall("Wall south", [4.4, 0.2, 2.5], [2, -0.1, 1.25]),
        wall("Wall north", [4.4, 0.2, 2.5], [2, 3.1, 1.25]),
        wall("Wall west", [0.2, 3, 2.5], [-0.1, 1.5, 1.25]),
        wall("Wall east", [0.2, 3, 2.5], [4.1, 1.5, 1.25]),
        wall("Ceiling", [4.4, 3.4, 0.1], [2, 1.5, 2.55]),
        wall("Table", [1, 0.6, 0.7], [1.2, 1.2, 0.35]),
        // In the north-east corner, to tell which way up the picture is.
        wall("Rug", [0.6, 0.4, 0.02], [3.5, 2.6, 0.01]),
      ],
    });
    await call("blender_set_material", {
      objects: ["Floor"],
      material: { name: "Oak", color: "#b98a5a", roughness: 0.6 },
    });
    await call("blender_set_material", {
      objects: ["Rug"],
      material: { name: "Red", color: "#c02020", roughness: 0.9 },
    });
    await call("blender_set_lighting", {
      preset: "daylight",
      lights: [
        {
          name: "Lamp",
          kind: "area",
          location: [2, 1.5, 2.3],
          look_at: [2, 1.5, 0],
          power: 150,
          size: 1,
        },
      ],
    });
    await call("blender_set_camera", {
      location: [3.6, 2.6, 1.6],
      look_at: [0.6, 0.6, 1],
      lens: 28,
      resolution: [640, 400],
      exposure: 0.3,
    });
    const kept = [
      "import bpy",
      "s = bpy.context.scene",
      "print('kept', s.world.name, s.camera.name, len(bpy.data.worlds), len(bpy.data.cameras), len(bpy.data.objects),",
      "      sorted(o.name for o in s.objects if o.hide_render), s.render.film_transparent)",
    ].join("\n");
    const before = await call("blender_describe_scene", {});
    const keptBefore = (await call("blender_run_script", { code: kept })).said;

    const covered = await call("blender_render", {
      output: "renders/covered.png",
      view: "plan",
      // Above the ceiling: nothing is cut away, and what lies on top shows.
      cut: 3,
      resolution: [200, 160],
    });
    const plan = await call("blender_render", {
      output: "renders/plan.png",
      view: "plan",
      without: ["Ceiling"],
      resolution: [400, 320],
    });
    const after = await call("blender_describe_scene", {});
    const keptAfter = (await call("blender_run_script", { code: kept })).said;
    const throughCamera = await call("blender_render", {
      output: "renders/no-table.png",
      engine: "eevee",
      samples: 8,
      without: ["Table"],
    });
    const table = await call("blender_describe_scene", { objects: ["Table"] });
    const withCycles = await call("blender_render", {
      output: "renders/plan-cycles.png",
      view: "plan",
      engine: "cycles",
    });
    // Blender reads its own picture where the rug is: up and to the right.
    const corner = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//renders/plan.png'))",
        "w, h = image.size",
        "at = (int(0.79 * h) * w + int(0.82 * w)) * 4",
        "print('corner', ' '.join(str(round(c * 255)) for c in image.pixels[at:at + 3]))",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const levels = (hex: string) =>
      [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
    const floor = levels(/Floor #([0-9a-f]{6})/.exec(plan.said)?.[1] ?? "");
    const [red, green] = (/corner (.+)/.exec(corner.said)?.[1] ?? "")
      .split(" ")
      .map(Number);

    // What lies over the rooms hides them, and the answer says how to leave it out.
    expect(covered.said).toMatch(
      /Ceiling lies over the rest and hides it from above: name it in without/,
    );
    expect(plan.isError).toBeUndefined();
    expect(plan.said).toMatch(
      /Rendered plan\.png, 400×320, the plan from above with \+y up the picture, [\d.]+ m across, with EEVEE in [\d.]+ s, neutral tone, without Ceiling and the lights\./,
    );
    expect(plan.said).not.toContain("quick look");
    expect(plan.said).not.toMatch(/Ceiling #|lies over/);
    // The floor was given #b98a5a, under walls 2.5 m high.
    [185, 138, 90].forEach((given, channel) =>
      expect(Math.abs((floor[channel] ?? 0) - given)).toBeLessThan(20),
    );
    expect(red).toBeGreaterThan((green ?? 255) * 2);
    // A picture through the camera leaves objects out the same way.
    expect(throughCamera.said).not.toMatch(/Table #/);
    expect(throughCamera.said).toMatch(/without Table/);
    expect(table.said).not.toMatch(/hidden/);
    // Camera, lights, background, tone, exposure, picture size and what is hidden.
    expect(after.said).toBe(before.said);
    expect(keptAfter.match(/kept .+/)?.[0]).toBe(
      keptBefore.match(/kept .+/)?.[0],
    );
    expect(withCycles.isError).toBe(true);
    expect(withCycles.said).toMatch(/A plan is drawn with EEVEE/);
    // A preset sets the tone and says the exposure it leaves.
    expect(
      (await call("blender_set_lighting", { preset: "daylight" })).said,
    ).toMatch(/with the agx tone; the exposure stays at \+0\.3/);
  });

  it("shows a room from inside in the full preview as a render does, with no sky through its walls", async () => {
    await call("blender_open_scene", { path: "room.blend", create: true });
    const box = (name: string, size: number[], location: number[]) => ({
      name,
      kind: "cube",
      size,
      location,
    });
    await call("blender_add_objects", {
      objects: [
        box("Floor", [4, 3, 0.1], [2, 1.5, -0.05]),
        box("Ceiling", [4.4, 3.4, 0.1], [2, 1.5, 2.55]),
        box("Wall north", [4.4, 0.2, 2.5], [2, 3.1, 1.25]),
        box("Wall west", [0.2, 3, 2.5], [-0.1, 1.5, 1.25]),
        box("Wall east", [0.2, 3, 2.5], [4.1, 1.5, 1.25]),
        // A metre left open in the south wall lets the daylight in.
        box("Wall south left", [1.7, 0.2, 2.5], [0.65, -0.1, 1.25]),
        box("Wall south right", [1.7, 0.2, 2.5], [3.35, -0.1, 1.25]),
      ],
    });
    await call("blender_set_lighting", { preset: "daylight" });
    // Looking at the middle of the west wall, which no daylight falls on.
    await call("blender_set_camera", {
      location: [3.4, 2.4, 1.5],
      look_at: [0, 1.5, 1.3],
      lens: 24,
      resolution: [480, 270],
    });
    const session = scenes.scene("live");
    session.look({ kind: "view", view: "camera" });
    // The quick picture, then the full one once the view is still.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await call("blender_api", { name: "Object" });
    const preview = session.state().preview;
    await writeFile(
      join(workspace, "room.jpg"),
      Buffer.from(preview!.data, "base64"),
    );
    await call("blender_render", {
      output: "renders/room.png",
      engine: "cycles",
      samples: 64,
    });
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "for name, path in (('preview', '//room.jpg'), ('render', '//renders/room.png')):",
        "    image = bpy.data.images.load(bpy.path.abspath(path))",
        "    w, h = image.size",
        "    p = image.pixels[:]",
        "    patch = [(y * w + x) * 4 for x in range(w // 2 - 6, w // 2 + 6) for y in range(h // 2 - 6, h // 2 + 6)]",
        "    print(name, *[round(sum(p[i + c] for i in patch) / len(patch), 4) for c in range(3)])",
        "    bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const wall = (name: string) =>
      (new RegExp(`${name} (.+)`).exec(read.said)?.[1] ?? "")
        .split(" ")
        .map(Number) as [number, number, number];

    expect(preview?.quick).toBeUndefined();
    expect(preview?.view).toBe("camera");
    // The wall as the render shows it, to a tenth of the way from black to
    // white: drawn with the sky coming through the walls it is a third off.
    wall("render").forEach((channel, at) =>
      expect(Math.abs(wall("preview")[at]! - channel)).toBeLessThan(0.1),
    );
  });

  it("shows level ground under a daylight sky, which is itself near black below its horizon", async () => {
    await call("blender_open_scene", { path: "open.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Post",
          kind: "cube",
          size: [0.2, 0.2, 2],
          location: [0, 0, 1],
        },
      ],
    });
    await call("blender_set_lighting", { preset: "daylight" });
    // Level with the horizon, which crosses the middle of the picture.
    await call("blender_set_camera", {
      location: [0, -8, 1.5],
      look_at: [0, 0, 1.5],
      lens: 24,
      resolution: [320, 240],
    });
    await call("blender_render", {
      output: "renders/open.png",
      engine: "cycles",
      samples: 32,
    });
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//renders/open.png'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "for name, rows in (('ground', range(10, 30)), ('sky', range(h - 30, h - 10))):",
        "    patch = [(y * w + x) * 4 for x in range(10, 40) for y in rows]",
        "    print(name, *[round(sum(p[i + c] for i in patch) / len(patch), 4) for c in range(3)])",
      ].join("\n"),
    });
    const seen = (name: string) =>
      (new RegExp(`${name} (.+)`).exec(read.said)?.[1] ?? "")
        .split(" ")
        .map(Number) as [number, number, number];
    const [red, green, blue] = seen("ground");

    // Lit ground, not the sky's underside: that is a dark blue, a sea through
    // a window and a night behind a house seen from above.
    expect(green).toBeGreaterThan(seen("sky")[1] / 2);
    expect(blue - red).toBeLessThan(0.03);
    expect((await call("blender_describe_scene", {})).said).toMatch(
      /Surroundings: a sky with the sun 35° high, standing toward \+y and \+x \(bearing 30°\); its light travels toward -y and -x, over level ground to the horizon/,
    );
  });

  it("says when surfaces are lit past their own colours, and the exposure that shows them as they are", async () => {
    await call("blender_open_scene", { path: "yard.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Yard",
          kind: "cube",
          size: [12, 12, 0.1],
          location: [0, 0, -0.05],
        },
        { name: "Shed", kind: "cube", size: [2, 2, 2], location: [0, 0, 1] },
      ],
    });
    await call("blender_set_material", {
      objects: ["Yard"],
      material: { name: "Paving", color: "#8a8a80", roughness: 0.9 },
    });
    await call("blender_set_material", {
      objects: ["Shed"],
      material: { name: "Timber", color: "#a8773f", roughness: 0.8 },
    });
    await call("blender_set_lighting", { preset: "daylight" });
    await call("blender_set_camera", {
      location: [7, -8, 5],
      look_at: [0, 0, 1],
      lens: 35,
      resolution: [320, 240],
    });
    const picture = () =>
      call("blender_render", {
        output: "renders/yard.png",
        engine: "cycles",
        samples: 32,
      });
    const levels = (hex: string) =>
      [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));

    // Outdoors the daylight that suits a room is many times what shows a
    // surface at its own colour.
    const glaring = await picture();
    const exposure = Number(
      /an exposure of about (-[\d.]+) shows them at their colours/.exec(
        glaring.said,
      )?.[1],
    );
    await call("blender_set_camera", { exposure });
    const held = await picture();
    const yard = levels(/Yard #([0-9a-f]{6})/.exec(held.said)?.[1] ?? "");

    expect(glaring.said).toMatch(
      /Lit past their own colours, which shows them pale or glaring: Yard about [\d.]+×/,
    );
    expect(exposure).toBeLessThan(-3);
    expect(held.said).not.toMatch(/Lit past their own colours/);
    levels("8a8a80").forEach((level, at) =>
      expect(Math.abs(yard[at]! - level)).toBeLessThan(45),
    );
    // Under either studio preset a subject is lit to show near its colour,
    // and nothing is said.
    await call("blender_set_camera", {
      frame: { objects: ["Shed"], direction: "three-quarter" },
      exposure: 0,
    });
    for (const preset of ["product", "studio"]) {
      await call("blender_set_lighting", { preset });
      const studio = await picture();
      const shed = levels(/Shed #([0-9a-f]{6})/.exec(studio.said)?.[1] ?? "");

      expect(studio.said).not.toMatch(/Lit past their own colours/);
      levels("a8773f").forEach((level, at) =>
        expect(Math.abs(shed[at]! - level)).toBeLessThan(50),
      );
    }
  });

  it("says that this Blender's numpy has no random numbers, when a script asks it for them", async () => {
    await call("blender_open_scene", { path: "numbers.blend", create: true });
    const asked = await call("blender_run_script", {
      code: [
        "import numpy",
        "print(numpy.random.default_rng(3).random())",
      ].join("\n"),
    });

    // A Blender whose numpy has them runs the script; nothing then needs saying.
    if (asked.isError)
      expect(asked.said).toMatch(
        /This Blender's numpy comes without numpy\.random\. Python's own random module is here/,
      );
    expect(
      (
        await call("blender_run_script", {
          code: ["import random", "print(random.Random(3).random() < 1)"].join(
            "\n",
          ),
        })
      ).said,
    ).toMatch(/True/);
  });

  it("says which lettering shows almost the colour of what it lies on", async () => {
    await call("blender_open_scene", { path: "sign.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Board",
          kind: "cube",
          size: [0.6, 0.02, 0.3],
          location: [0, 0, 0.15],
        },
        {
          name: "Name",
          kind: "text",
          text: "HONEY",
          height: 0.12,
          depth: 0.002,
          location: [0, -0.011, 0.15],
          rotation: [90, 0, 0],
        },
      ],
    });
    const kraft = { name: "Kraft", color: "#b8925a", roughness: 0.85 };
    await call("blender_set_material", { objects: ["Board"], material: kraft });
    await call("blender_set_material", {
      objects: ["Name"],
      material: { ...kraft, name: "Same as the board" },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Board"], direction: "front" },
      resolution: [400, 240],
    });
    const picture = () =>
      call("blender_render", {
        output: "renders/sign.png",
        engine: "cycles",
        samples: 32,
      });

    const embossed = await picture();
    await call("blender_set_material", {
      objects: ["Name"],
      material: { name: "Ink", color: "#2a1a0a", roughness: 0.8 },
    });
    const inked = await picture();

    expect(embossed.said).toMatch(
      /Lettering that shows almost the colour of what it lies on, and so does not read: Name on Board\./,
    );
    expect(inked.said).not.toMatch(/Lettering that shows almost/);
  });

  it("lets the sun into a room through a window pane as through the open hole, and stops it at a block of glass", async () => {
    await call("blender_open_scene", { path: "glazed.blend", create: true });
    const box = (name: string, size: number[], location: number[]) => ({
      name,
      kind: "cube",
      size,
      location,
    });
    await call("blender_add_objects", {
      objects: [
        box("Floor", [4, 3, 0.1], [2, 1.5, -0.05]),
        box("Ceiling", [4.4, 3.4, 0.1], [2, 1.5, 2.55]),
        box("Wall north", [4.4, 0.2, 2.5], [2, 3.1, 1.25]),
        box("Wall west", [0.2, 3, 2.5], [-0.1, 1.5, 1.25]),
        box("Wall east", [0.2, 3, 2.5], [4.1, 1.5, 1.25]),
        // A metre left open in the south wall, where the sun stands.
        box("Wall south left", [1.7, 0.2, 2.5], [0.65, -0.1, 1.25]),
        box("Wall south right", [1.7, 0.2, 2.5], [3.35, -0.1, 1.25]),
      ],
    });
    await call("blender_set_lighting", {
      background: { sky: { sun_elevation: 35, sun_rotation: 180 } },
    });
    await call("blender_set_camera", {
      location: [3.6, 2.6, 2.2],
      look_at: [2, 0.8, 0],
      lens: 20,
      resolution: [320, 200],
      exposure: -2,
    });
    const picture = (name: string) =>
      call("blender_render", {
        output: `renders/${name}.png`,
        engine: "cycles",
        samples: 64,
      });
    const glass = {
      name: "Glass",
      color: "#ffffff",
      transmission: 1,
      roughness: 0,
    };

    await picture("open");
    await call("blender_add_objects", {
      objects: [
        box("Pane", [1, 0.006, 2.5], [2, -0.1, 1.25]),
        box("Block", [0.3, 0.3, 0.3], [40, 0, 0.15]),
      ],
    });
    const glazed = await call("blender_set_material", {
      objects: ["Pane", "Block"],
      material: glass,
    });
    const described = await call("blender_describe_scene", {});
    await picture("glazed");
    // The same opening closed by glass as thick as it is wide.
    await call("blender_edit_objects", {
      edits: [{ object: "Pane", size: [1, 1, 2.5], location: [2, -0.6, 1.25] }],
    });
    const thick = await call("blender_set_material", {
      objects: ["Pane"],
      material: glass,
    });
    await picture("thick");
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "for name in ('open', 'glazed', 'thick'):",
        "    image = bpy.data.images.load(bpy.path.abspath(f'//renders/{name}.png'))",
        "    p = image.pixels[:]",
        "    print(name, round(sum(p[i] + p[i + 1] + p[i + 2] for i in range(0, len(p), 4)) / (len(p) // 4 * 3), 4))",
        "    bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const bright = (name: string) =>
      Number(new RegExp(`${name} ([\\d.]+)`).exec(read.said)?.[1]);

    expect(glazed.said).toMatch(
      /Pane is a thin sheet of glass: light goes through it as through real glass, and it casts no shadow\./,
    );
    expect(glazed.said).not.toMatch(/Block is a thin sheet/);
    expect(/^- Pane: .*$/m.exec(described.said)?.[0]).toMatch(
      /casts no shadow/,
    );
    expect(/^- Block: .*$/m.exec(described.said)?.[0]).not.toMatch(
      /casts no shadow/,
    );
    // The room through the pane, to a twentieth of the way from black to
    // white: behind glass that stops the sun it is a third as bright.
    expect(Math.abs(bright("glazed") - bright("open"))).toBeLessThan(0.05);
    expect(thick.said).not.toMatch(/thin sheet/);
    expect(bright("thick")).toBeLessThan(bright("open") - 0.1);
  });

  it("shows a picture on a glowing surface, as a screen does", async () => {
    await call("blender_open_scene", { path: "screen.blend", create: true });
    // Red above, blue below.
    await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.new('halves', 8, 8)",
        "image.pixels[:] = [c for y in range(8) for x in range(8) for c in ((1, 0, 0, 1) if y >= 4 else (0, 0, 1, 1))]",
        "image.filepath_raw = bpy.path.abspath('//halves.png')",
        "image.file_format = 'PNG'",
        "image.save()",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Screen",
          kind: "cube",
          size: [0.6, 0.01, 0.34],
          location: [0, 0, 0.3],
        },
      ],
    });
    const lit = await call("blender_set_material", {
      objects: ["Screen"],
      material: {
        name: "Display",
        color: "#050505",
        texture: { path: "halves.png", projection: "front" },
        emission: { strength: 1 },
      },
    });
    // In the dark, so that all the picture shows is the screen's own light.
    await call("blender_set_lighting", {
      background: { color: "#000000", strength: 0 },
    });
    await call("blender_set_camera", {
      frame: {
        objects: ["Screen"],
        direction: "front",
        elevation: 0,
        margin: 0.2,
      },
      resolution: [120, 80],
    });
    await call("blender_render", {
      output: "renders/screen.png",
      engine: "cycles",
      samples: 16,
    });
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//renders/screen.png'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "top = ((h * 5 // 8) * w + w // 2) * 4",
        "bottom = ((h * 3 // 8) * w + w // 2) * 4",
        "print('top', p[top] - p[top + 2], 'bottom', p[bottom] - p[bottom + 2])",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const [, top, bottom] =
      /top ([\d.-]+) bottom ([\d.-]+)/.exec(read.said) ?? [];
    const described = await call("blender_describe_scene", {});

    expect(lit.said).toMatch(/glowing with its picture at 1/);
    expect(described.said).toMatch(/glowing with its picture at 1/);
    // Red where the picture is red and blue where it is blue: a white glow
    // would show both halves the same.
    expect(Number(top)).toBeGreaterThan(0.3);
    expect(Number(bottom)).toBeLessThan(-0.3);
  });

  it("takes a path without a drive from the workspace when a script hands it to Blender, wherever in it the script chose", async () => {
    await call("blender_open_scene", { path: "paths.blend", create: true });
    const folder = `chosen-${Date.now()}`;
    const within = (...parts: string[]) =>
      join(workspace, folder, ...parts).toLowerCase();
    // What Blender is handed, read back before it writes anything: left
    // alone it takes such a path from the root of the drive.
    const handed = await call("blender_run_script", {
      code: [
        "import bpy",
        "print('new scene', bpy.path.abspath(bpy.context.scene.render.filepath))",
        "image = bpy.data.images.new('swatch', 4, 4)",
        `image.filepath_raw = '${folder}/textures/swatch.png'`,
        "print('raw', image.filepath_raw)",
        "def given(**names):",
        "    print('keyword', names['filepath'], '|', names['directory'])",
        `given(filepath='/${folder}/rooted.png', directory='${folder}/exports/')`,
        `given(**{'filepath': '${folder}/unpacked.png', 'directory': '//beside the scene/'})`,
        `bpy.context.scene.render.filepath = '${folder}/frames/frame_'`,
        "print('render', bpy.context.scene.render.filepath)",
      ].join("\n"),
    });
    const said = handed.said.toLowerCase();

    expect(said).toContain(`new scene ${workspace.toLowerCase()}`);
    expect(said).toContain(`raw ${within("textures", "swatch.png")}`);
    expect(said).toContain(
      `keyword ${within("rooted.png")} | ${within("exports")}\\`,
    );
    // A path that names its own place is left as the script wrote it.
    expect(said).toContain(
      `keyword ${within("unpacked.png")} | //beside the scene/`,
    );
    expect(said).toContain(`render ${within("frames", "frame_")}`);

    // Only now is Blender asked to write and to read, each way a script has.
    const saved = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.new('swatch', 4, 4)",
        `image.filepath_raw = '${folder}/textures/swatch.png'`,
        "image.file_format = 'PNG'",
        "image.save()",
        `image.save(filepath='${folder}/by keyword.png')`,
        `image.save_render('${folder}/as rendered.png')`,
        `print('loaded', bpy.data.images.load('${folder}/textures/swatch.png').size[0])`,
      ].join("\n"),
    });

    expect(saved.said).toContain("loaded 4");
    for (const name of [
      join("textures", "swatch.png"),
      "by keyword.png",
      "as rendered.png",
    ])
      expect((await stat(join(workspace, folder, name))).size).toBeGreaterThan(
        0,
      );
    await rm(join(workspace, folder), { recursive: true, force: true });
  });

  it("says which side a sky's sun stands on, a bearing with +y as north, and its shadows fall the other way", async () => {
    await call("blender_open_scene", { path: "sundial.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Ground",
          kind: "cube",
          size: [40, 40, 0.1],
          location: [0, 0, -0.05],
        },
        {
          name: "Pole",
          kind: "cylinder",
          size: [0.3, 0.3, 2],
          location: [0, 0, 1],
        },
      ],
    });
    // From straight above, with +y up the picture and +x to its right.
    await call("blender_set_camera", {
      frame: { objects: ["Pole"], direction: "top", margin: 0.9 },
      orthographic: true,
      resolution: [96, 96],
      exposure: -5,
    });
    const sky = (sun_rotation: number) =>
      call("blender_set_lighting", {
        background: { sky: { sun_elevation: 35, sun_rotation } },
      });
    // How much darker the right of the picture is than the left, and the
    // bottom than the top: the side the pole's shadow lies on.
    const shadow = async () => {
      await call("blender_render", {
        output: "renders/sundial.png",
        engine: "cycles",
        samples: 16,
      });
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.load(bpy.path.abspath('//renders/sundial.png'))",
          "w, h = image.size",
          "p = image.pixels[:]",
          "light = lambda xs, ys: sum(p[(y * w + x) * 4] for x in xs for y in ys) / (len(xs) * len(ys))",
          // Four strips as wide as the pole, running from it to each edge.
          "near, far = range(w * 9 // 20, w * 11 // 20), w * 13 // 20",
          "print('right', light(range(0, w - far), near) - light(range(far, w), near),",
          "      'below', light(near, range(far, h)) - light(near, range(0, h - far)))",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      const [, right, below] =
        /right ([\d.e-]+) below ([\d.e-]+)/.exec(read.said) ?? [];
      return { right: Number(right), below: Number(below) };
    };

    const west = await sky(270);
    const fromWest = await shadow();
    const north = await sky(0);
    const fromNorth = await shadow();
    const between = await sky(240);
    const described = await call("blender_describe_scene", {});
    const preset = await call("blender_set_lighting", { preset: "daylight" });

    expect(west.said).toContain(
      "a sky with the sun 35° high, standing toward -x (bearing 270°); its light travels toward +x",
    );
    expect(fromWest.right).toBeGreaterThan(0.05);
    expect(Math.abs(fromWest.below)).toBeLessThan(fromWest.right / 2);
    expect(north.said).toContain(
      "standing toward +y (bearing 0°); its light travels toward -y",
    );
    expect(fromNorth.below).toBeGreaterThan(0.05);
    expect(Math.abs(fromNorth.right)).toBeLessThan(fromNorth.below / 2);
    // Between two sides, the nearer one first.
    expect(between.said).toContain(
      "standing toward -x and -y (bearing 240°); its light travels toward +x and +y",
    );
    expect(described.said).toContain(
      "Surroundings: a sky with the sun 35° high, standing toward -x and -y (bearing 240°)",
    );
    expect(preset.said).toContain(
      "the sun 35° high, standing toward +y and +x (bearing 30°)",
    );
  });

  it("gives wood a calm grain along each board's own length, in the wood's colour, and keeps it so when a board is resized", async () => {
    await call("blender_open_scene", { path: "boards.blend", create: true });
    const board = (name: string, size: number[], location: number[]) => ({
      name,
      kind: "cube",
      size,
      location,
    });
    await call("blender_add_objects", {
      objects: [
        board("Lengthwise", [1.2, 0.3, 0.03], [0, 2, 0.015]),
        board("Crosswise", [0.3, 1.2, 0.03], [4, 0, 0.015]),
        board("Bold", [1.2, 0.3, 0.03], [0, -2, 0.015]),
        board("Painted", [1.2, 0.3, 0.03], [0, -4, 0.015]),
      ],
    });
    const oak = { name: "Oak", color: "#c9a678", roughness: 0.6 };
    const made = await call("blender_set_material", {
      objects: ["Lengthwise", "Crosswise"],
      material: { ...oak, wood: 0.5 },
    });
    await call("blender_set_material", {
      objects: ["Bold"],
      material: { ...oak, name: "Pine", wood: 1 },
    });
    await call("blender_set_material", {
      objects: ["Painted"],
      material: { ...oak, name: "Paint" },
    });
    // Even light from every side, so that all a picture shows is the surface.
    await call("blender_set_lighting", {
      background: { color: "#ffffff", strength: 1 },
    });
    // A board from straight above, filling the picture: its colour, how much
    // it changes from one pixel to the next across the picture and up it,
    // and how far its light and dark are from its middle.
    const seen = async (
      name: string,
      long: "across" | "up",
      engine = "cycles",
    ) => {
      await call("blender_set_camera", {
        frame: { objects: [name], direction: "top", margin: 0 },
        orthographic: true,
        resolution: long === "across" ? [240, 60] : [60, 240],
        tone: "standard",
      });
      await call("blender_render", {
        output: "renders/board.png",
        engine,
        samples: 64,
      });
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.load(bpy.path.abspath('//renders/board.png'))",
          "w, h = image.size",
          "p = image.pixels[:]",
          "at = lambda x, y, c: p[(y * w + x) * 4 + c]",
          "xs, ys = range(w // 10, w - w // 10), range(h // 10, h - h // 10)",
          "light = lambda x, y: (at(x, y, 0) + at(x, y, 1) + at(x, y, 2)) / 3",
          "count = len(xs) * len(ys)",
          "mean = [sum(at(x, y, c) for x in xs for y in ys) / count for c in range(3)]",
          "middle = sum(mean) / 3",
          "across = sum(abs(light(x + 1, y) - light(x, y)) for x in xs for y in ys) / count",
          "up = sum(abs(light(x, y + 1) - light(x, y)) for x in xs for y in ys) / count",
          "spread = (sum((light(x, y) - middle) ** 2 for x in xs for y in ys) / count) ** 0.5 / middle",
          "print('board', *[round(v * 255, 2) for v in mean], round(across * 255, 4), round(up * 255, 4), round(spread, 4))",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      const [red, green, blue, across, up, spread] = (
        /board (.+)/.exec(read.said)?.[1] ?? ""
      )
        .split(" ")
        .map(Number) as [number, number, number, number, number, number];
      return { colour: [red, green, blue], across, up, spread };
    };

    const lengthwise = await seen("Lengthwise", "across");
    const crosswise = await seen("Crosswise", "up");
    const bold = await seen("Bold", "across");
    const painted = await seen("Painted", "across");
    const drafted = await seen("Lengthwise", "across", "eevee");
    const described = await call("blender_describe_scene", {
      objects: ["Lengthwise"],
    });
    // The same board turned into one that is long the other way.
    await call("blender_edit_objects", {
      edits: [{ object: "Lengthwise", size: [0.3, 1.2, 0.03] }],
    });
    const turned = await seen("Lengthwise", "up");

    expect(made.said).toContain("wood grain 0.5");
    expect(described.said).toMatch(
      /material Oak \(#c9a678, roughness 0\.6, wood grain 0\.5\)/,
    );
    // Streaks run the length of a board: going along one changes little,
    // going across it meets one streak after another.
    expect(lengthwise.up).toBeGreaterThan(lengthwise.across * 3);
    expect(crosswise.across).toBeGreaterThan(crosswise.up * 3);
    expect(drafted.up).toBeGreaterThan(drafted.across * 3);
    expect(turned.across).toBeGreaterThan(turned.up * 3);
    // The wood's colour is the one given, to a twentieth of the way from
    // black to white, and paint of that colour shows no grain at all.
    painted.colour.forEach((level, at) =>
      expect(Math.abs(lengthwise.colour[at]! - level)).toBeLessThan(13),
    );
    expect(painted.spread).toBeLessThan(0.01);
    // Calm: light and dark stay within a tenth of the middle, where stripes
    // drawn by hand ran to a third. Bolder when asked, and still wood.
    expect(lengthwise.spread).toBeGreaterThan(0.015);
    expect(lengthwise.spread).toBeLessThan(0.1);
    expect(bold.spread).toBeGreaterThan(lengthwise.spread * 1.4);
    expect(bold.spread).toBeLessThan(0.2);

    // Wood is still a surface with a colour of its own, so the light on it
    // is metered as on paint.
    await call("blender_set_lighting", { preset: "daylight" });
    await call("blender_set_camera", {
      frame: { objects: ["Bold"], direction: "top", margin: 0.1 },
      orthographic: true,
      resolution: [240, 80],
      tone: "agx",
    });
    const outdoors = await call("blender_render", {
      output: "renders/outdoors.png",
      engine: "cycles",
      samples: 32,
    });

    expect(outdoors.said).toMatch(/Lit past their own colours[^.]*Bold/);
  });

  it("draws the wide top of a wooden cupboard as a panel, and the end of a post as rings", async () => {
    await call("blender_open_scene", { path: "cupboard.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        // Taller than it is wide: its grain runs up it, and its top is an end.
        {
          name: "Wardrobe",
          kind: "cube",
          size: [1.2, 0.6, 2],
          location: [0, 0, 1],
        },
        {
          name: "Post",
          kind: "cube",
          size: [0.2, 0.2, 1],
          location: [4, 0, 0.5],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Wardrobe", "Post"],
      material: { name: "Oak", color: "#c9a678", roughness: 0.6, wood: 1 },
    });
    await call("blender_set_lighting", {
      background: { color: "#ffffff", strength: 1 },
    });
    // A top from straight above, filling the picture: how much it changes
    // from one pixel to the next across the picture, and up it.
    const top = async (name: string, wide: number, engine = "cycles") => {
      await call("blender_set_camera", {
        frame: { objects: [name], direction: "top", margin: 0 },
        orthographic: true,
        resolution: [wide, 120],
        tone: "standard",
      });
      await call("blender_render", {
        output: "renders/top.png",
        engine,
        samples: 64,
      });
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.load(bpy.path.abspath('//renders/top.png'))",
          "w, h = image.size",
          "p = image.pixels[:]",
          "light = lambda x, y: sum(p[(y * w + x) * 4 + c] for c in range(3)) / 3",
          "xs, ys = range(w // 10, w - w // 10), range(h // 10, h - h // 10)",
          "count = len(xs) * len(ys)",
          "across = sum(abs(light(x + 1, y) - light(x, y)) for x in xs for y in ys) / count",
          "up = sum(abs(light(x, y + 1) - light(x, y)) for x in xs for y in ys) / count",
          "print('top', round(across * 255, 4), round(up * 255, 4))",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      const [, across, up] = /top ([\d.]+) ([\d.]+)/.exec(read.said) ?? [];
      return { across: Number(across), up: Number(up) };
    };

    const wardrobe = await top("Wardrobe", 240);
    const drafted = await top("Wardrobe", 240, "eevee");
    const post = await top("Post", 120);

    // Streaks along the top's longer side, as a panel laid on it would show.
    expect(wardrobe.up).toBeGreaterThan(wardrobe.across * 3);
    expect(drafted.up).toBeGreaterThan(drafted.across * 3);
    // Rings run every way: neither side of the post's end is theirs.
    expect(post.across).toBeGreaterThan(0.2);
    expect(Math.max(post.across, post.up)).toBeLessThan(
      Math.min(post.across, post.up) * 2,
    );
  });

  it("is refused a write at the drive's root, by a path with no drive that reaches Blender unseen, and is told where it may write", async () => {
    await call("blender_open_scene", { path: "stray.blend", create: true });
    // Where Blender takes a path with no drive from: the root of Windows' drive.
    const stray = join(
      parse(process.env["SystemRoot"] ?? "C:\\Windows").root,
      `zhiyin-stray-${randomUUID()}`,
    );
    try {
      const strayed = await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.new('Stray', 8, 8)",
          "image.file_format = 'PNG'",
          // Handed over by name, which no reading of the script's text sees.
          `setattr(image, 'filepath' + '_raw', '${basename(stray)}/stray.png')`,
          "image.save()",
        ].join("\n"),
      });

      expect(existsSync(stray)).toBe(false);
      expect(strayed.isError).toBe(true);
      expect(strayed.said).toContain(
        "Blender may write only inside the workspace",
      );
    } finally {
      await rm(stray, { recursive: true, force: true });
    }
  });

  it("writes anywhere in the workspace, in folders and over files that were there before, reads what the person can read, and writes nowhere else", async () => {
    await call("blender_open_scene", { path: "inside.blend", create: true });
    await mkdir(join(workspace, "kept", "deeper"), { recursive: true });
    await writeFile(join(workspace, "kept", "notes.txt"), "the person's");
    const beside = join(root, "beside the workspace.txt");
    const readable = join(root, "kept elsewhere.txt");
    await writeFile(readable, "read from outside");

    const inside = await call("blender_run_script", {
      code: [
        "import bpy, os",
        "open('kept/deeper/made.txt', 'w').write('made')",
        "open('kept/notes.txt', 'w').write('changed')",
        "image = bpy.data.images.new('Tile', 8, 8)",
        "image.file_format = 'PNG'",
        "image.filepath_raw = 'kept/tile.png'",
        "image.save()",
        "print('kept holds', sorted(os.listdir('kept')))",
        `print(open(r'${readable}').read())`,
      ].join("\n"),
    });
    const outside = await call("blender_run_script", {
      code: `open(r'${beside}', 'w').write('x')`,
    });

    expect(inside.said).toContain(
      "kept holds ['deeper', 'notes.txt', 'tile.png']",
    );
    expect(inside.said).toContain("read from outside");
    expect(await readFile(join(workspace, "kept", "notes.txt"), "utf8")).toBe(
      "changed",
    );
    expect(existsSync(beside)).toBe(false);
    expect(outside.isError).toBe(true);
    expect(outside.said).toContain("PermissionError");
    expect(outside.said).toContain(
      "is outside the workspace, and Blender may write only inside it",
    );
  });

  it("keeps in its log why the scene could not be put back after a change that failed", async () => {
    await call("blender_open_scene", { path: "damaged.blend", create: true });

    // The scene file is damaged on disk before the script fails, so the
    // scene cannot be loaded again from it.
    const failed = await call("blender_run_script", {
      code: [
        "open('damaged.blend', 'wb').write(b'not a scene')",
        "raise ValueError('stop here')",
      ].join("\n"),
    });
    const logs = join(scenes.directory("live"), "logs");
    const kept = await Promise.all(
      (await readdir(logs))
        .filter((name) => name.endsWith(".err.txt"))
        .map((name) => readFile(join(logs, name), "utf8")),
    );

    expect(failed.isError).toBe(true);
    expect(failed.said).toContain("ValueError: stop here");
    expect(kept.join("\n")).toMatch(
      /The scene could not be put back after a change that failed:\s+Traceback/,
    );
  });
});
