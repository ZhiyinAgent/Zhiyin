/**
 * A material call before Blender is reached: the approval rows for its light
 * inside, tint, texture set, height and faces; the inputs it cannot run
 * without; and the workspace pictures it reads, a texture set's folder
 * included, each checked and handed over by its absolute path.
 */

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { ConversationScenes, sceneAutomation } from "../src/index.js";
import { standInBlender } from "./stand-in-blender.js";

const folders = new TemporaryFolders();
const started: ConversationScenes[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((scenes) => scenes.closeAll()));
  await folders.removeAll();
});

async function setUp() {
  const root = await realpath(await folders.make("zhiyin-materials-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const blender = standInBlender();
  const installed = async () => "C:/Blender/blender.exe";
  const scenes = new ConversationScenes({
    blender: installed,
    directory: join(root, "data"),
    launch: blender.launch,
    script: "C:/Zhiyin/blender-session/start.py",
    startTimeoutMs: 500,
  });
  started.push(scenes);
  const tools = sceneAutomation(scenes.scene("first"), {
    workspaceRoot: () => workspace,
    blender: installed,
    directory: scenes.directory("first"),
  });
  await tools.callTool("blender_open_scene", {
    path: "scene.blend",
    create: true,
  });
  return { workspace, blender, tools };
}

describe("a material call", () => {
  it("shows its light inside, tint, texture set, height and faces in its approval", async () => {
    const { tools, workspace } = await setUp();
    await mkdir(join(workspace, "bricks"));
    await writeFile(join(workspace, "bricks", "Bricks_Color.png"), "");
    await writeFile(join(workspace, "bumps.png"), "");

    const inspected = await tools.inspect("blender_set_material", {
      objects: ["Wall"],
      faces: { facing: [0, 0, 1], within: 20, slot: "Body" },
      material: {
        name: "Skin",
        coat_tint: "#ff4040",
        coat_ior: 1.6,
        distribution: "ggx",
        subsurface: { preset: "skin", scale: 0.5 },
        transmission: 1,
        tint: { color: "#4080c0", depth: 0.01 },
        maps: { folder: "bricks", size: 1, convention: "directx" },
        height: { path: "bumps.png", depth: 0.002, method: "both" },
      },
    });

    const rows =
      inspected.ok &&
      Object.fromEntries(
        (inspected.invocation?.arguments ?? []).map((row) => [
          row.name,
          row.value,
        ]),
      );
    expect(rows).toMatchObject({
      "Coat tint": "#ff4040",
      "Coat ior": "1.6",
      Reflections: "GGX",
      "Light inside": "skin, scaled 0.5 times",
      Tint: "#4080c0 seen through 10 mm",
      "Texture set": "the pictures in bricks, 1 m a repeat, normal map DirectX",
      Height: "bumps.png, up to 2 mm, by moving the surface and bump",
      Faces: "facing (0, 0, 1) within 20° and now showing Body",
    });
  });

  it("shows each mark beyond wear and grime, and how metal is brushed, in its approval", async () => {
    const { tools } = await setUp();

    const inspected = await tools.inspect("blender_set_material", {
      objects: ["Knob"],
      material: {
        name: "Knob steel",
        finish: "brushed-metal",
        brushing: { pattern: "circular", axis: "z" },
        rust: 0.3,
        drips: 0.2,
        dust: 0.25,
        scratches: 0.4,
        fingerprints: 0.5,
      },
    });

    const rows =
      inspected.ok &&
      Object.fromEntries(
        (inspected.invocation?.arguments ?? []).map((row) => [
          row.name,
          row.value,
        ]),
      );
    expect(rows).toMatchObject({
      Rust: "0.3 on edges and corners, running down",
      "Drip streaks": "0.2 running down from edges",
      Dust: "0.25 on faces looking up",
      Scratches: "0.4 along its longest side",
      Fingerprints: "0.5 on open faces",
      Brushing: "circular, about its z axis",
    });
  });

  it("names the bake an export asks for in its approval", async () => {
    const { tools } = await setUp();

    const inspected = await tools.inspect("blender_export", {
      output: "stone.glb",
      bake: true,
      bake_size: 512,
    });

    const rows =
      inspected.ok &&
      Object.fromEntries(
        (inspected.invocation?.arguments ?? []).map((row) => [
          row.name,
          row.value,
        ]),
      );
    expect(rows).toMatchObject({
      Bake: "Looks the file cannot hold, into 512 px pictures it carries",
    });
  });

  it("asks nobody about a height given both a picture and a pattern, or a texture set given no picture", async () => {
    const { tools, blender } = await setUp();
    const sent = blender.requests.length;

    expect(
      await tools.inspect("blender_set_material", {
        objects: ["Wall"],
        material: {
          height: {
            path: "bumps.png",
            pattern: { kind: "noise", size: 0.002 },
            depth: 0.001,
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason:
        "Give exactly one of material.height.path and material.height.pattern.",
    });
    expect(
      await tools.inspect("blender_set_material", {
        objects: ["Wall"],
        material: { maps: { size: 1 } },
      }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason: "This call is missing material.maps.folder.",
    });
    expect(blender.requests.length).toBe(sent);
  });

  it("hands Blender a texture set's folder as its checked pictures, and its height picture by its absolute path", async () => {
    const { tools, workspace, blender } = await setUp();
    await mkdir(join(workspace, "bricks"));
    for (const name of [
      "Bricks_Color.png",
      "Bricks_Roughness.jpg",
      "notes.txt",
    ])
      await writeFile(join(workspace, "bricks", name), "");
    await writeFile(join(workspace, "bumps.png"), "");

    await tools.callTool("blender_set_material", {
      objects: ["Wall"],
      material: {
        maps: { folder: "bricks" },
        height: { path: "bumps.png", depth: 0.001 },
      },
    });

    expect(
      blender.requests.find((r) => r.op === "material")?.args,
    ).toMatchObject({
      material: {
        maps: {
          folder: "bricks",
          files: [
            join(workspace, "bricks", "Bricks_Color.png"),
            join(workspace, "bricks", "Bricks_Roughness.jpg"),
          ],
        },
        height: { path: join(workspace, "bumps.png") },
      },
    });
  });

  it("refuses a texture set's folder outside the workspace, or one with no pictures", async () => {
    const { tools, workspace } = await setUp();
    await mkdir(join(workspace, "empty"));

    expect(
      await tools.inspect("blender_set_material", {
        objects: ["Wall"],
        material: { maps: { folder: "../elsewhere" } },
      }),
    ).toEqual({ ok: false, reason: "../elsewhere is outside the workspace." });
    expect(
      await tools.inspect("blender_set_material", {
        objects: ["Wall"],
        material: { maps: { folder: "empty" } },
      }),
    ).toMatchObject({ ok: false, correctable: true });
  });
});
