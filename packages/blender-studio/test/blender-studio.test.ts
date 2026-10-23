import {
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { ConversationScenes, sceneAutomation } from "../src/index.js";
import { sceneIn } from "../src/paths.js";
import {
  pictureBytes,
  standInBlender,
  type Behaviour,
} from "./stand-in-blender.js";

const folders = new TemporaryFolders();

const started: ConversationScenes[] = [];
// Sessions are ended before their folders go: one still drawing a preview
// would be writing into a folder as it is removed. A write already under way
// when its session ends is waited out.
afterEach(async () => {
  await Promise.all(started.splice(0).map((scenes) => scenes.closeAll()));
  await folders.removeAll();
});

/** Waits for something the session does after answering, such as a preview. */
async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !condition(); tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(condition()).toBe(true);
}

async function setUp(
  behaviour?: Behaviour,
  options: {
    installed?: boolean;
    ready?: boolean;
    cannotDraw?: boolean;
    endsAtOnce?: boolean;
    endsWhenReady?: boolean;
    slowPipe?: boolean;
    previewTimeoutMs?: number;
    caseSensitive?: boolean;
  } = {},
) {
  // By its full name: Windows may give the temp folder by a short one, and
  // the tools hand Blender the folder as it really is.
  const root = await realpath(
    await (options.caseSensitive
      ? folders.makeCaseSensitive("zhiyin-studio-")
      : folders.make("zhiyin-studio-")),
  );
  const workspace = join(root, "workspace");
  const data = join(root, "data");
  await mkdir(workspace, { recursive: true });
  const blender = standInBlender(behaviour, {
    ...(options.ready === false ? { ready: false } : {}),
    ...(options.cannotDraw ? { cannotDraw: true } : {}),
    ...(options.endsAtOnce ? { endsAtOnce: true } : {}),
    ...(options.endsWhenReady ? { endsWhenReady: true } : {}),
    ...(options.slowPipe ? { slowPipe: true } : {}),
  });
  const installed = async () =>
    options.installed === false ? undefined : "C:/Blender/blender.exe";
  const scenes = new ConversationScenes({
    blender: installed,
    directory: data,
    launch: blender.launch,
    script: "C:/Zhiyin/blender-session/start.py",
    startTimeoutMs: 500,
    ...(options.previewTimeoutMs
      ? { previewTimeoutMs: options.previewTimeoutMs }
      : {}),
  });
  started.push(scenes);
  const tools = (conversation = "first") =>
    sceneAutomation(scenes.scene(conversation), {
      workspaceRoot: () => workspace,
      blender: installed,
      directory: scenes.directory(conversation),
    });
  return { workspace, data, blender, scenes, tools, installed };
}

type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};
const call = (
  tools: ReturnType<Awaited<ReturnType<typeof setUp>>["tools"]>,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => tools.callTool(name, args, signal) as Promise<Result>;
const said = (result: Result) =>
  result.content.map((c) => c.text ?? "").join("\n");

const can = {
  name: "Can",
  kind: "cylinder",
  size: [0.066, 0.066, 0.115],
  location: [0.15, 0, 0.0575],
};

describe("the tools", () => {
  it("offers nothing until Blender is installed, then all twelve", async () => {
    const missing = await setUp(undefined, { installed: false });
    await expect(missing.tools().listTools()).rejects.toThrow(/not installed/);

    const present = await setUp();
    const names = (await present.tools().listTools()).map((tool) => tool.name);
    expect(names).toHaveLength(12);
    expect(names).toContain("blender_shape_objects");
  });

  it("refuses to change a scene before one is open, without starting Blender", async () => {
    const { tools, blender } = await setUp();
    const inspected = await tools().inspect("blender_add_objects", {
      objects: [can],
    });

    expect(inspected).toMatchObject({ ok: false, correctable: true });
    expect(inspected.ok ? "" : inspected.reason).toMatch(/blender_open_scene/);
    expect(blender.launches).toHaveLength(0);
  });

  it("refuses a file outside the workspace before Blender is reached, as nothing the model may retry", async () => {
    const { tools, blender } = await setUp();
    for (const path of ["../elsewhere.blend", "C:/Windows/scene.blend"]) {
      const inspected = await tools().inspect("blender_open_scene", {
        path,
        create: true,
      });
      expect(inspected).toMatchObject({ ok: false });
      expect(inspected.ok ? "" : inspected.reason).toMatch(
        /outside the workspace/,
      );
      expect("correctable" in inspected && inspected.correctable).toBeFalsy();
    }
    expect(blender.launches).toHaveLength(0);
  });

  it("refuses a file named with a colon, which names a drive or a hidden stream rather than a file", async () => {
    const { tools, blender, workspace } = await setUp();
    // A drive's own letter and another's: the other reads as a path on a
    // different drive, which is refused for its colon all the same.
    const own = workspace[0]!.toUpperCase();
    const other = own === "C" ? "D" : "C";
    for (const path of [
      `${own}:scene.blend`,
      `${other}:scene.blend`,
      "scene.blend:hidden.blend",
    ]) {
      const inspected = await tools().inspect("blender_open_scene", {
        path,
        create: true,
      });
      expect(inspected).toMatchObject({ ok: false, correctable: true });
      expect(inspected.ok ? "" : inspected.reason).toMatch(/:/);
    }
    expect(blender.launches).toHaveLength(0);
  });

  it.skipIf(!TemporaryFolders.canTellCaseApart())(
    "takes no scene in a folder named like the workspace but for case as the workspace's",
    async () => {
      const parent = await realpath(
        await folders.makeCaseSensitive("zhiyin-studio-case-"),
      );
      await mkdir(join(parent, "inside"));
      await mkdir(join(parent, "INSIDE"));

      expect(
        await sceneIn(
          join(parent, "inside"),
          join(parent, "INSIDE", "a.blend"),
        ),
      ).toBeUndefined();
      expect(
        await sceneIn(
          join(parent, "inside"),
          join(parent, "inside", "a.blend"),
        ),
      ).toBe("a.blend");
    },
  );

  it.skipIf(!TemporaryFolders.canTellCaseApart())(
    "refuses a scene a link carries to a folder named like the workspace but for case",
    async () => {
      const { tools, blender, workspace } = await setUp(undefined, {
        caseSensitive: true,
      });
      const twin = join(workspace, "..", "WORKSPACE");
      await mkdir(twin);
      await writeFile(join(twin, "scene.blend"), "outside");
      await symlink(twin, join(workspace, "linked"), "junction");

      for (const path of ["linked/scene.blend", "../WORKSPACE/scene.blend"]) {
        const inspected = await tools().inspect("blender_open_scene", { path });
        expect(inspected.ok ? "" : inspected.reason).toMatch(
          /outside the workspace/,
        );
      }
      expect(blender.launches).toHaveLength(0);
    },
  );

  it("refuses files of the wrong kind and files that do not exist, as mistakes the model can correct", async () => {
    const { tools } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const wrongKind = await tools().inspect("blender_open_scene", {
      path: "scene.txt",
      create: true,
    });
    const missingPicture = await tools().inspect("blender_add_objects", {
      objects: [{ name: "Poster", kind: "image", path: "poster.png" }],
    });
    const wrongRender = await tools().inspect("blender_render", {
      output: "render.gif",
    });

    // Each names the input at fault, the one a repair may change.
    expect(wrongKind).toMatchObject({
      ok: false,
      correctable: true,
      faulty: ["path"],
    });
    expect(missingPicture).toMatchObject({
      ok: false,
      correctable: true,
      faulty: ["objects[0].path"],
    });
    expect(wrongRender).toMatchObject({
      ok: false,
      correctable: true,
      faulty: ["output"],
    });
  });

  it("opens an existing scene file without claiming to change it, and never creates over one", async () => {
    const { tools, workspace, blender } = await setUp();
    await writeFile(join(workspace, "room.blend"), "a scene");

    const opened = await tools().inspect("blender_open_scene", {
      path: "room.blend",
      create: true,
    });
    expect(opened).toMatchObject({
      ok: true,
      action: "Open a 3D scene",
      access: "read",
    });
    expect("changes" in opened && opened.changes).toBeFalsy();

    const missing = await tools().inspect("blender_open_scene", {
      path: "new.blend",
    });
    expect(missing).toMatchObject({ ok: false, correctable: true });

    await call(tools(), "blender_open_scene", {
      path: "room.blend",
      create: true,
    });
    expect(blender.requests[0]).toMatchObject({
      op: "open",
      args: { path: join(workspace, "room.blend"), create: true },
    });
  });

  it("offers every input with a single type, so a provider that reads written-out calls by type gets each value whole", async () => {
    // An input typed as "a name or a point" arrived cut off at that value from
    // three of MiMo's providers; each input is one thing now.
    const mixed: string[] = [];
    const walk = (schema: unknown, at: string) => {
      if (!schema || typeof schema !== "object") return;
      const node = schema as Record<string, unknown>;
      if (Array.isArray(node["type"]) || node["anyOf"] || node["oneOf"])
        mixed.push(at);
      const properties = node["properties"];
      if (properties && typeof properties === "object")
        for (const [key, value] of Object.entries(properties))
          walk(value, `${at}.${key}`);
      walk(node["items"], `${at}[]`);
    };
    const { tools } = await setUp();
    for (const tool of await tools().listTools())
      walk(tool.inputSchema, tool.name);

    expect(mixed).toEqual([]);
  });

  it("offers one allowance for every change to the open scene that writes only new files", async () => {
    const { tools, workspace } = await setUp();
    await mkdir(join(workspace, "renders"));
    await writeFile(join(workspace, "renders", "old.png"), "");
    await call(tools(), "blender_open_scene", {
      path: "mug.blend",
      create: true,
    });
    const allowance = async (name: string, args: Record<string, unknown>) => {
      const inspected = await tools().inspect(name, args);
      return inspected.ok ? inspected.allowance : undefined;
    };

    const adding = await allowance("blender_add_objects", { objects: [can] });
    const rendering = await allowance("blender_render", {
      output: "renders/new.png",
    });
    const describing = await allowance("blender_describe_scene", {});
    const replacing = await allowance("blender_render", {
      output: "renders/old.png",
    });
    const scripting = await allowance("blender_run_script", {
      code: "print(1)",
    });
    await call(tools(), "blender_open_scene", {
      path: "tea.blend",
      create: true,
    });
    const elsewhere = await allowance("blender_add_objects", {
      objects: [can],
    });

    expect(adding?.label).toBe(
      "Changes to mug.blend, and new files in the workspace",
    );
    expect(rendering?.key).toBe(adding?.key);
    expect(describing?.key).toBe(adding?.key);
    // Replacing a file, a script, and another scene are asked for again.
    expect(replacing).toBeUndefined();
    expect(scripting).toBeUndefined();
    expect(elsewhere?.key).not.toBe(adding?.key);
  });

  it("names a file it writes as the workspace has it, however the path was written", async () => {
    const { tools, workspace } = await setUp();
    await mkdir(join(workspace, "Pictures"));
    await writeFile(join(workspace, "Pictures", "Shot.png"), "");
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const again = await tools().inspect("blender_render", {
      output: "pictures/drafts/../shot.png",
    });
    const fresh = await tools().inspect("blender_render", {
      output: "./pictures/new.png",
    });

    expect(again).toMatchObject({ ok: true, target: "Pictures/Shot.png" });
    expect(
      again.ok && again.changes?.some((c) => c.path === "Pictures/Shot.png"),
    ).toBe(true);
    expect(fresh).toMatchObject({ ok: true, target: "Pictures/new.png" });
  });

  it("describes each change for approval in sizes a person reads, and declares the scene file so going back can restore it", async () => {
    const { tools, workspace } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scenes/product.blend",
      create: true,
    });

    const added = await tools().inspect("blender_add_objects", {
      objects: [can],
    });
    expect(added).toMatchObject({
      ok: true,
      action: "Add objects to a 3D scene",
      target: "scenes/product.blend",
      invocation: {
        name: "Add objects to a 3D scene",
        arguments: [
          {
            name: "Can",
            value: "cylinder, 66 × 66 × 115 mm, at (150, 0, 57.5 mm)",
            readable: true,
          },
        ],
      },
      access: "change",
      scope: "workspace",
      changes: [{ path: "scenes/product.blend", change: "updated" }],
    });

    const lettering = await tools().inspect("blender_add_objects", {
      objects: [
        {
          name: "Name",
          kind: "text",
          text: "HONEY",
          height: 0.013,
          location: [0, -0.035, 0.04],
          wrap_radius: 0.035,
        },
      ],
    });
    expect(lettering).toMatchObject({
      invocation: {
        arguments: [
          {
            name: "Name",
            value:
              "text, “HONEY”, bent round a 35 mm radius, at (0, -35, 40 mm)",
          },
        ],
      },
    });

    const hole = await tools().inspect("blender_shape_objects", {
      object: "Bracket",
      operations: [
        {
          kind: "boolean",
          operation: "difference",
          cutter: {
            shape: "cylinder",
            diameter: 0.005,
            depth: 0.02,
            location: [0.02, 0, 0.003],
          },
        },
      ],
    });
    expect(hole).toMatchObject({
      ok: true,
      invocation: {
        arguments: [
          {
            name: "Bracket",
            value: "Cut a 5 mm round hole, 20 mm deep at (20, 0, 3 mm)",
            readable: true,
          },
        ],
      },
    });

    const render = await tools().inspect("blender_render", {
      output: "renders/hero.png",
      engine: "cycles",
      resolution: [2000, 2000],
      samples: 256,
    });
    expect(render.ok && render.invocation?.arguments).toEqual([
      { name: "Engine", value: "Cycles", readable: true },
      { name: "Size", value: "2000 × 2000 pixels", readable: true },
      { name: "Samples", value: "256", readable: true },
      { name: "Saved as", value: "renders/hero.png", readable: true },
    ]);

    const onWhite = await tools().inspect("blender_render", {
      output: "renders/main.jpg",
      background: "white",
    });
    expect(onWhite.ok && onWhite.invocation?.arguments).toContainEqual({
      name: "Background",
      value: "exact white, with the product's shadow",
      readable: true,
    });

    const fromAbove = await tools().inspect("blender_render", {
      output: "renders/plan.png",
      view: "plan",
      cut: 2.3,
      without: ["Ceiling", "Roof"],
    });
    expect(fromAbove.ok && fromAbove.invocation?.arguments).toEqual([
      { name: "View", value: "the plan from above", readable: true },
      { name: "Cut at", value: "2.3 m", readable: true },
      { name: "Engine", value: "EEVEE", readable: true },
      { name: "Size", value: "the scene's picture size", readable: true },
      { name: "Samples", value: "64, the default", readable: true },
      { name: "Left out", value: "Ceiling, Roof", readable: true },
      { name: "Saved as", value: "renders/plan.png", readable: true },
    ]);

    // Blender refuses these; they are refused before anyone approves them.
    const planInCycles = await tools().inspect("blender_render", {
      output: "renders/plan.png",
      view: "plan",
      engine: "cycles",
    });
    expect(planInCycles).toMatchObject({
      ok: false,
      correctable: true,
      faulty: ["engine"],
    });
    const planOnWhite = await tools().inspect("blender_render", {
      output: "renders/plan.png",
      view: "plan",
      background: "white",
      engine: "eevee",
    });
    expect(planOnWhite).toMatchObject({
      ok: false,
      correctable: true,
      faulty: ["background"],
    });
    const whiteInEevee = await tools().inspect("blender_render", {
      output: "renders/main.png",
      background: "white",
      engine: "eevee",
    });
    expect(whiteInEevee).toMatchObject({
      ok: false,
      correctable: true,
      faulty: ["engine"],
    });

    const material = await tools().inspect("blender_set_material", {
      objects: ["Mug", "Handle"],
      material: { name: "Glaze", color: "#122a63", roughness: 0.12, coat: 0.6 },
    });
    expect(material.ok && material.invocation?.arguments).toEqual([
      { name: "Objects", value: "Mug, Handle", readable: true },
      {
        name: "Material",
        value: "Glaze, set as below wherever it is used",
        readable: true,
      },
      { name: "Colour", value: "#122a63", readable: true },
      { name: "Roughness", value: "0.12", readable: true },
      { name: "Clear coat", value: "0.6", readable: true },
    ]);

    // Named with nothing else, a material already in the scene goes on as it
    // is, so no colour or roughness is claimed for it.
    const reused = await tools().inspect("blender_set_material", {
      objects: ["Handle"],
      material: { name: "Glaze" },
    });
    expect(reused.ok && reused.invocation?.arguments).toEqual([
      { name: "Objects", value: "Handle", readable: true },
      {
        name: "Material",
        value: "Glaze, as it is, or new in plain grey if there is none",
        readable: true,
      },
    ]);

    // A material named by nothing takes its name from the first object, and
    // that is the name shown, whether it is reused or set.
    const blank = await tools().inspect("blender_set_material", {
      objects: ["Handle", "Mug"],
      material: { name: "" },
    });
    expect(
      blank.ok &&
        blank.invocation?.arguments.find((row) => row.name === "Material"),
    ).toEqual({
      name: "Material",
      value: "Handle material, as it is, or new in plain grey if there is none",
      readable: true,
    });
    const unnamed = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      material: { color: "#ffffff" },
    });
    expect(
      unnamed.ok &&
        unnamed.invocation?.arguments.find((row) => row.name === "Material"),
    ).toEqual({
      name: "Material",
      value: "Mug material, set as below wherever it is used",
      readable: true,
    });

    const wood = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Oak", color: "#c9a678", roughness: 0.6, wood: 0.5 },
    });
    expect(wood.ok && wood.invocation?.arguments).toEqual([
      { name: "Objects", value: "Mug", readable: true },
      {
        name: "Material",
        value: "Oak, set as below wherever it is used",
        readable: true,
      },
      { name: "Colour", value: "#c9a678", readable: true },
      { name: "Roughness", value: "0.6", readable: true },
      { name: "Wood grain", value: "0.5", readable: true },
    ]);

    // A glow with a picture and no colour of its own is the picture's.
    await writeFile(join(workspace, "wallpaper.png"), "");
    const screen = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      material: {
        name: "Display",
        texture: { path: "wallpaper.png", projection: "front" },
        emission: { strength: 1.5 },
      },
    });
    expect(
      screen.ok &&
        screen.invocation?.arguments.find((row) => row.name === "Glow"),
    ).toEqual({ name: "Glow", value: "its picture at 1.5", readable: true });

    const lighting = await tools().inspect("blender_set_lighting", {
      backdrop_reflections: 0.25,
    });
    expect(lighting.ok && lighting.invocation?.arguments).toEqual([
      {
        name: "Backdrop in reflections",
        value: "25% as bright",
        readable: true,
      },
    ]);

    const camera = await tools().inspect("blender_set_camera", {
      frame: { direction: "front", elevation: 10 },
    });
    expect(camera.ok && camera.invocation?.arguments).toEqual([
      {
        name: "Framing",
        value: "everything from the front, 10° above level, 10% margin",
        readable: true,
      },
    ]);

    const plan = await tools().inspect("blender_set_camera", {
      orthographic: true,
      frame: { direction: "front", around: 30 },
    });
    expect(plan.ok && plan.invocation?.arguments).toEqual([
      {
        name: "Framing",
        value: "everything from the front, 30° round, 10% margin",
        readable: true,
      },
      {
        name: "Projection",
        value: "orthographic: no perspective",
        readable: true,
      },
    ]);

    const shifted = await tools().inspect("blender_set_camera", {
      shift: [0, -0.07],
    });
    expect(shifted.ok && shifted.invocation?.arguments).toEqual([
      { name: "Lens shift", value: "0 across, -0.07 up", readable: true },
    ]);
    const unshifted = await tools().inspect("blender_set_camera", {
      shift: [0, 0],
    });
    expect(unshifted.ok && unshifted.invocation?.arguments).toEqual([
      { name: "Lens shift", value: "none", readable: true },
    ]);

    const toned = await tools().inspect("blender_set_camera", {
      tone: "neutral",
      exposure: -0.5,
    });
    expect(toned.ok && toned.invocation?.arguments).toEqual([
      { name: "Exposure", value: "0.5 stops darker", readable: true },
      {
        name: "Tone",
        value: "neutral: colours as given",
        readable: true,
      },
    ]);
  });

  it("shows a script whole for approval and says what going back cannot undo", async () => {
    const { tools } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    const code =
      "import bpy\nfor o in bpy.data.objects:\n    o.location.z += 1";

    const inspected = await tools().inspect("blender_run_script", { code });

    expect(inspected.ok && inspected.invocation?.arguments[0]).toEqual({
      name: "Script",
      value: code,
    });
    // Shown as code, not as words.
    expect(
      inspected.ok && inspected.invocation?.arguments[0]?.readable,
    ).toBeUndefined();
    // Beside the code, in words: what the script can reach besides the scene,
    // said once, so the approval does not repeat it in a sentence above.
    expect(inspected.ok && inspected.detail).toBeUndefined();
    expect(inspected.ok && inspected.invocation?.arguments[1]).toMatchObject({
      readable: true,
      value:
        "any file in the workspace, and nothing else of yours; only the scene file is kept for going back",
    });
    expect(inspected.ok && inspected.invocation?.arguments[2]).toEqual({
      name: "Can also reach",
      value: "nothing else of yours, and not the internet",
      readable: true,
    });
  });

  it("binds an approval to the scene it changes and to whether its file is new", async () => {
    const { tools, workspace } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "a.blend",
      create: true,
    });
    const add = { objects: [can] };
    const render = { output: "shot.png" };
    const onA = await tools().inspect("blender_add_objects", add);
    const fresh = await tools().inspect("blender_render", render);

    await writeFile(join(workspace, "shot.png"), "a picture made meanwhile");
    const overwriting = await tools().inspect("blender_render", render);
    await call(tools(), "blender_open_scene", {
      path: "b.blend",
      create: true,
    });
    const onB = await tools().inspect("blender_add_objects", add);

    const identity = (inspected: Awaited<typeof onA>) =>
      inspected.ok ? inspected.identity : undefined;
    expect(identity(onB)).not.toBe(identity(onA));
    expect(identity(overwriting)).not.toBe(identity(fresh));
    // So allowing it for the conversation is said to cover only this call.
    expect(onB.ok && onB.boundToCall).toBe(true);
  });

  it("names no input of a refused script, so a repair never rewrites its code, and asks about every script", async () => {
    const { tools } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const refused = await tools().inspect("blender_run_script", {
      code: "x".repeat(200_000),
    });
    const script = await tools().inspect("blender_run_script", {
      code: "import bpy",
    });

    expect(refused).toMatchObject({ ok: false, correctable: true });
    expect(refused).not.toHaveProperty("faulty");
    expect(script).toMatchObject({ ok: true, asksEachTime: true });
  });

  it("hands Blender checked absolute paths, never the model's own", async () => {
    const { tools, workspace, blender } = await setUp();
    await writeFile(join(workspace, "label.png"), "picture");
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    await call(tools(), "blender_set_material", {
      objects: ["Can"],
      material: {
        color: "#c0392b",
        texture: { path: "label.png", projection: "cylinder" },
      },
    });

    expect(blender.requests.find((r) => r.op === "material")).toMatchObject({
      op: "material",
      args: {
        material: {
          texture: {
            path: join(workspace, "label.png"),
            projection: "cylinder",
          },
        },
      },
    });
  });

  it("describes a call the same way each time it is looked at, so one approved after a wait still runs", async () => {
    // The agent loop looks at a call again once it is approved and runs it
    // only if nothing in that description changed.
    const { tools } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    const calls: [string, Record<string, unknown>][] = [
      ["blender_render", { output: "renders/hero.png" }],
      ["blender_export", { output: "parts/bracket.stl" }],
      ["blender_add_objects", { objects: [can] }],
      ["blender_run_script", { code: "import bpy" }],
    ];

    for (const [name, args] of calls)
      expect(await studio.inspect(name, args), name).toEqual(
        await studio.inspect(name, args),
      );
  });

  it("lists a render and an export as produced files, and shows a model the render", async () => {
    const { tools, workspace } = await setUp(async (request) => {
      if (request.op === "render") {
        await writeFile(String(request.args["output"]), "png");
        await writeFile(String(request.args["picture"]), pictureBytes);
      }
      if (request.op === "export")
        await writeFile(String(request.args["output"]), "stl");
      return { ok: true, text: `did ${request.op}` };
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const rendered = await call(studio, "blender_render", {
      output: "renders/hero.png",
    });
    const exported = await call(studio, "blender_export", {
      output: "parts/bracket.stl",
    });

    expect(studio.produced("blender_render", {}, rendered)).toEqual([
      { path: "renders/hero.png", change: "created", bytes: 3 },
    ]);
    expect(studio.produced("blender_export", {}, exported)).toEqual([
      { path: "parts/bracket.stl", change: "created", bytes: 3 },
    ]);
    expect(rendered.content.find((c) => c.type === "image")?.data).toBe(
      pictureBytes.toString("base64"),
    );
    // The reduced copy for the model is not left behind.
    expect(await readdir(workspace, { recursive: true })).not.toContain(
      "hero.jpg",
    );
  });
});

describe("a conversation's session", () => {
  it("is the conversation's own: two conversations get two Blenders", async () => {
    const { scenes, tools, blender } = await setUp();
    expect(scenes.scene("first")).toBe(scenes.scene("first"));

    await call(tools("first"), "blender_open_scene", {
      path: "a.blend",
      create: true,
    });
    await call(tools("second"), "blender_open_scene", {
      path: "b.blend",
      create: true,
    });

    expect(blender.launches).toHaveLength(2);
    expect(scenes.scene("first").scene()).toBe("a.blend");
    expect(scenes.scene("second").scene()).toBe("b.blend");
  });

  it("shows each change as a preview kept in the app's data, never in the workspace", async () => {
    const { tools, scenes, workspace } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    await call(tools(), "blender_add_objects", { objects: [can] });
    // The preview follows the answer; the next command waits for it.
    await call(tools(), "blender_describe_scene", {});

    const state = scenes.scene("first").state();
    expect(state).toMatchObject({
      status: "open",
      file: "scene.blend",
      working: false,
    });
    expect(state.preview?.data).toBe(pictureBytes.toString("base64"));
    expect(await readdir(workspace)).toEqual([]);
    // Read, then let go of: nothing piles up.
    expect(await readdir(join(scenes.directory("first"), "previews"))).toEqual(
      [],
    );
  });

  it("says what the preview it shows the model is, so it is not taken for a render", async () => {
    const { tools, scenes } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    scenes.scene("first").look({ kind: "turn", yaw: 30, pitch: 0 });
    await until(() => scenes.scene("first").state().preview !== undefined);

    const described = await call(tools(), "blender_describe_scene", {});
    const caption = described.content.findIndex((c) =>
      /quick preview of the 3D view, from the overview/.test(c.text ?? ""),
    );

    expect(caption).toBeGreaterThan(0);
    expect(described.content[caption + 1]?.type).toBe("image");
  });

  it("changes only the picture when the person turns the view", async () => {
    const { tools, scenes, blender } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    const before = scenes.scene("first").state().preview?.sequence ?? 0;

    scenes.scene("first").look({ kind: "turn", yaw: 30, pitch: -10 });
    await call(tools(), "blender_api", { name: "Object" });

    const preview = blender.requests.findLast((r) => r.op === "preview");
    expect(preview?.preview).toMatchObject({
      yaw: 30,
      pitch: -10,
      view: "overview",
    });
    expect(
      blender.ops().filter((op) => !["open", "preview", "api"].includes(op)),
    ).toEqual([]);
    expect(
      scenes.scene("first").state().preview?.sequence ?? 0,
    ).toBeGreaterThan(before);
  });

  it("draws quick pictures while the person turns the view, then a full one once they stop", async () => {
    const { tools, scenes, blender } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    await call(tools(), "blender_add_objects", {
      objects: [{ name: "Box", kind: "cube" }],
    });
    const previews = () =>
      blender.requests.filter((r) => r.op === "preview").map((r) => r.preview);
    // A change to the scene is drawn in full.
    await until(() => previews().length > 0);
    expect(previews().at(-1)).not.toHaveProperty("quick");
    const before = previews().length;

    const session = scenes.scene("first");
    session.look({ kind: "turn", yaw: 10, pitch: 0 });
    await until(() => previews().at(-1)?.quick === true);
    session.look({ kind: "turn", yaw: 10, pitch: 0 });
    await until(() => {
      const last = previews().at(-1);
      return last?.yaw === 20 && last.quick === undefined;
    });
    const looks = previews().slice(before);
    expect(looks.slice(0, -1).every((look) => look?.quick === true)).toBe(true);
  });

  it("says when the scene has nothing in it to show", async () => {
    const { tools, scenes } = await setUp(async (request) => {
      if (request.op !== "preview")
        return { ok: true, text: `did ${request.op}` };
      await writeFile(request.preview!.path, pictureBytes);
      return {
        ok: true,
        preview: {
          path: request.preview!.path,
          width: 640,
          height: 360,
          view: "overview",
          empty: true,
        },
      };
    });
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    const session = scenes.scene("first");
    session.look({ kind: "turn", yaw: 10, pitch: 0 });
    await until(() => session.state().preview?.empty === true);
  });

  it("ends Blender when a command runs past its time limit, and says what it left", async () => {
    const { tools, scenes, blender, workspace } = await setUp((request) =>
      request.op === "script" ? "silent" : { ok: true, text: "done" },
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const late = await scenes
      .scene("first")
      .run(
        "script",
        { code: "while True: pass" },
        { timeoutMs: 50, workspace },
      );

    expect(late.ok).toBe(false);
    expect(late.ok ? "" : late.reason).toMatch(/ran past its time limit/);
    expect(late.ok ? "" : late.reason).toMatch(
      /The scene file was not changed/,
    );
    expect(blender.ended[0]).toBe(true);
  });

  it("stops a command while Blender is still starting, without waiting for it", async () => {
    const { tools, blender } = await setUp(undefined, { ready: false });
    const controller = new AbortController();

    const stopping = call(
      tools(),
      "blender_open_scene",
      { path: "scene.blend", create: true },
      controller.signal,
    );
    // Stopped once the start is under way, however long the call took to
    // reach it: a stop that arrives sooner is another case, with other words.
    await until(() => blender.launches.length > 0);
    controller.abort();
    const stopped = await stopping;

    expect(stopped.isError).toBe(true);
    // Stopped, not left to fail when Blender's start runs out of time.
    expect(said(stopped)).toMatch(/stopped while Blender was starting/);
  });

  it("ends Blender when a command is stopped, says what it left, and starts again from the scene file", async () => {
    let hang = true;
    const controller = new AbortController();
    const { tools, blender } = await setUp((request) => {
      if (request.op !== "script" || !hang)
        return { ok: true, text: `did ${request.op}` };
      // Stopped once Blender has the script, which never answers.
      controller.abort();
      return "silent";
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const stuck = await call(
      studio,
      "blender_run_script",
      { code: "while True: pass" },
      controller.signal,
    );
    expect(stuck.isError).toBe(true);
    expect(said(stuck)).toMatch(/The scene file was not changed/);
    expect(blender.ended[0]).toBe(true);

    hang = false;
    await call(studio, "blender_add_objects", { objects: [can] });
    expect(blender.launches).toHaveLength(2);
    // The new Blender opens the scene file before anything else.
    const ops = blender.ops();
    expect(ops[ops.lastIndexOf("add") - 1]).toBe("open");
  });

  it("opens the scene file again before drawing the view, when a command was stopped while Blender started again", async () => {
    const { workspace, data, blender, installed } = await setUp();
    let gate: Promise<void> = Promise.resolve();
    let open: () => void = () => undefined;
    const scenes = new ConversationScenes({
      blender: installed,
      directory: data,
      launch: async (options) => {
        await gate;
        return blender.launch(options);
      },
      script: "C:/Zhiyin/blender-session/start.py",
      startTimeoutMs: 500,
    });
    started.push(scenes);
    const studio = sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => workspace,
      blender: installed,
      directory: scenes.directory("first"),
    });
    await studio.callTool("blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    await scenes.scene("first").close();

    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const controller = new AbortController();
    const stopping = studio.callTool(
      "blender_describe_scene",
      {},
      controller.signal,
    );
    await until(() => scenes.scene("first").state().status === "starting");
    controller.abort();
    await stopping;
    open();
    await until(() => scenes.scene("first").state().status === "open");
    const before = blender.requests.length;
    scenes.scene("first").look({ kind: "turn", yaw: 10, pitch: 0 });
    await until(() => blender.ops().slice(before).includes("preview"));

    // The second Blender opens the scene file before it draws anything, so
    // the view never shows Blender's own startup scene.
    const second = blender.requests.slice(before).map((r) => r.op);
    expect(second.indexOf("open")).toBeGreaterThan(-1);
    expect(second.indexOf("open")).toBeLessThan(second.indexOf("preview"));
  });

  it.each([
    ["stopped", true, undefined],
    ["timed out", false, 50],
  ])(
    "says a %s script left the scene file unchanged and the files it wrote in the workspace as they are",
    async (_, stopped, timeoutMs) => {
      const controller = new AbortController();
      const { tools, scenes, workspace } = await setUp(async (request) => {
        if (request.op !== "script") return { ok: true, text: "done" };
        await writeFile(join(workspace, "notes.txt"), "half");
        // Stopped once the script has written, and before it answers.
        if (stopped) controller.abort();
        return "silent";
      });
      await call(tools(), "blender_open_scene", {
        path: "scene.blend",
        create: true,
      });

      const ended = await scenes.scene("first").run(
        "script",
        { code: "open('notes.txt', 'w').write('half'); input()" },
        {
          timeoutMs: timeoutMs ?? 60_000,
          workspace,
          signal: controller.signal,
        },
      );

      const reason = ended.ok ? "" : ended.reason;
      expect(reason).not.toMatch(/The change was not made/);
      expect(reason).toMatch(/The scene file was not changed/);
      expect(reason).toMatch(
        /files the script wrote in the workspace before it stopped stay as they are/i,
      );
      expect(await readFile(join(workspace, "notes.txt"), "utf8")).toBe("half");
    },
  );

  it("keeps what Blender said besides the error when a command fails, and draws the scene again after loading it from disk", async () => {
    const { tools, blender, scenes } = await setUp((request) =>
      request.op === "edit"
        ? {
            ok: false,
            refused: true,
            error: "There is no object named “Lid”.",
            notes: ["scene.blend changed on disk, so it was loaded again."],
            changed: true,
          }
        : { ok: true, text: `did ${request.op}` },
    );
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    await until(() => scenes.scene("first").state().preview !== undefined);
    const before = blender.requests.length;

    const failed = await call(studio, "blender_edit_objects", {
      edits: [{ object: "Lid", location: [0, 0, 1] }],
    });

    expect(failed.isError).toBe(true);
    expect(said(failed)).toMatch(/There is no object named “Lid”/);
    expect(said(failed)).toMatch(
      /scene\.blend changed on disk, so it was loaded again/,
    );
    await until(() => blender.ops().slice(before).includes("preview"));
  });

  it("says when a change that failed could not be taken back out of the scene", async () => {
    const { tools } = await setUp((request) =>
      request.op === "edit"
        ? { ok: false, error: "ValueError: stop here", reloaded: false }
        : { ok: true, text: `did ${request.op}` },
    );
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const failed = await call(studio, "blender_edit_objects", {
      edits: [{ object: "Can", location: [0, 0, 1] }],
    });

    expect(said(failed)).toMatch(/ValueError: stop here/);
    expect(said(failed)).toMatch(
      /could not put the scene back as it was saved/,
    );
  });

  it("puts its scene away when going back removed the turn that opened it", async () => {
    const { tools, scenes } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    expect(scenes.scene("first").state().file).toBe("scene.blend");

    await scenes.putAway("first", "nothing");

    const state = scenes.scene("first").state();
    expect(state.status).toBe("closed");
    expect(state.file).toBeUndefined();
    expect(state.preview).toBeUndefined();
    expect(scenes.scene("first").scene()).toBeUndefined();
  });

  it("after going back put files back, ends Blender, drops the picture and opens the restored file on the next command", async () => {
    const opened: string[] = [];
    const { tools, scenes } = await setUp((request) => {
      if (request.op === "open") opened.push(String(request.args?.path));
      return { ok: true, text: `did ${request.op}` };
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    await scenes.putAway("first", "file");

    const state = scenes.scene("first").state();
    expect(state.status).toBe("closed");
    expect(state.file).toBe("scene.blend");
    expect(state.preview).toBeUndefined();
    await call(studio, "blender_describe_scene", {});
    expect(opened).toHaveLength(2);
  });

  it("says why the scene file could not be opened again in a Blender started anew", async () => {
    let opens = 0;
    const { tools, scenes } = await setUp((request) => {
      if (request.op === "open" && ++opens > 1)
        return { ok: false, error: "File format is not supported" };
      return { ok: true, text: `did ${request.op}` };
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    await scenes.scene("first").close();

    const described = await call(studio, "blender_describe_scene", {});

    expect(described.isError).toBe(true);
    expect(said(described)).toMatch(/could not be opened again/);
    expect(said(described)).toMatch(/File format is not supported/);
    expect(scenes.scene("first").scene()).toBeUndefined();
    expect(scenes.scene("first").state().file).toBeUndefined();
  });

  it("says on the next command why the scene file could not be opened again, when the view was drawn first", async () => {
    let opens = 0;
    const { workspace, data, blender, installed } = await setUp();
    let gate: Promise<void> = Promise.resolve();
    let open: () => void = () => undefined;
    const answers = standInBlender((request) => {
      if (request.op === "open" && ++opens > 1)
        return { ok: false, error: "File format is not supported" };
      return { ok: true, text: `did ${request.op}` };
    });
    const scenes = new ConversationScenes({
      blender: installed,
      directory: data,
      launch: async (options) => {
        await gate;
        return answers.launch(options);
      },
      script: "C:/Zhiyin/blender-session/start.py",
      startTimeoutMs: 500,
    });
    started.push(scenes);
    const studio = sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => workspace,
      blender: installed,
      directory: scenes.directory("first"),
    });
    await studio.callTool("blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    await scenes.scene("first").close();
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const controller = new AbortController();
    const stopping = studio.callTool(
      "blender_describe_scene",
      {},
      controller.signal,
    );
    await until(() => scenes.scene("first").state().status === "starting");
    controller.abort();
    await stopping;
    open();
    await until(() => scenes.scene("first").state().status === "open");
    const before = answers.requests.length;
    scenes.scene("first").look({ kind: "turn", yaw: 10, pitch: 0 });
    await until(() => answers.ops().slice(before).includes("preview"));

    const next = (await studio.callTool("blender_add_objects", {
      objects: [can],
    })) as Result;

    expect(said(next)).toMatch(
      /scene\.blend could not be opened again: File format is not supported/,
    );
    void blender;
  });

  it("opens the file asked for first in a Blender started anew, not the one open before", async () => {
    const { tools, blender, scenes } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", { path: "a.blend", create: true });
    await scenes.scene("first").close();
    const before = blender.requests.length;

    await call(studio, "blender_open_scene", { path: "b.blend", create: true });

    const opened = blender.requests
      .slice(before)
      .filter((request) => request.op === "open")
      .map((request) => String(request.args["path"]));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/b\.blend$/);
  });

  it("says nothing of putting the scene back when a command that changes nothing fails", async () => {
    const { tools } = await setUp((request) =>
      request.op === "describe"
        ? {
            ok: false,
            error: "There is no object named “Lid”.",
            reloaded: false,
          }
        : { ok: true, text: `did ${request.op}` },
    );
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const failed = await call(studio, "blender_describe_scene", {
      objects: ["Lid"],
    });

    expect(said(failed)).toMatch(/There is no object named “Lid”/);
    expect(said(failed)).not.toMatch(/could not put the scene back/);
  });

  it("still says a stopped change other than a script was not made", async () => {
    const { tools, scenes, workspace } = await setUp((request) =>
      request.op === "add" ? "silent" : { ok: true, text: "done" },
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const late = await scenes
      .scene("first")
      .run("add", { objects: [can] }, { timeoutMs: 50, workspace });

    expect(late.ok ? "" : late.reason).toMatch(/The change was not made/);
  });

  it("starts a conversation's Blender again from its scene file on the next command once it was closed", async () => {
    const { tools, blender, scenes } = await setUp((request) => ({
      ok: true,
      text: `did ${request.op}`,
    }));
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    await scenes.close("first");
    const after = await call(tools(), "blender_add_objects", {
      objects: [can],
    });

    expect(after.isError).toBeUndefined();
    expect(blender.launches).toHaveLength(2);
    const ops = blender.ops();
    expect(ops[ops.lastIndexOf("add") - 1]).toBe("open");
  });

  it("answers a change before drawing its preview, so a preview that hangs takes nothing back", async () => {
    const { tools, scenes } = await setUp(
      (request) =>
        request.op === "preview"
          ? "silent"
          : { ok: true, text: `did ${request.op}`, changed: true },
      { previewTimeoutMs: 50 },
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const added = await call(tools(), "blender_add_objects", {
      objects: [can],
    });

    expect(added.isError).toBeUndefined();
    expect(said(added)).toBe("did add");
    // The preview runs on, and ends Blender when it hangs.
    await until(() => scenes.scene("first").state().status === "closed");
  });

  it("says a change Blender saved before it was stopped is in the scene file", async () => {
    let scenePath = "";
    const controller = new AbortController();
    const { tools } = await setUp(async (request) => {
      if (request.op === "open") scenePath = String(request.args["path"]);
      if (request.op === "script") {
        await writeFile(scenePath, "saved by the script");
        // Stopped once the script has saved, and before it answers.
        controller.abort();
        return "silent";
      }
      return { ok: true, text: `did ${request.op}` };
    });
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const stopped = await call(
      tools(),
      "blender_run_script",
      { code: "save_and_hang()" },
      controller.signal,
    );

    expect(stopped.isError).toBe(true);
    expect(said(stopped)).toMatch(/saved before Blender stopped/);
    expect(said(stopped)).not.toMatch(/not made/);
  });

  it("says a render stopped while writing may have left an incomplete file", async () => {
    const controller = new AbortController();
    const { tools } = await setUp(async (request) => {
      if (request.op === "render") {
        await writeFile(String(request.args["output"]), "half a picture");
        // Stopped once part of the picture is on disk.
        controller.abort();
        return "silent";
      }
      return { ok: true, text: `did ${request.op}` };
    });
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const stopped = await call(
      tools(),
      "blender_render",
      { output: "shot.png" },
      controller.signal,
    );

    expect(said(stopped)).toMatch(/shot\.png .*incomplete/);
  });

  it("reads and lets go of only the preview file it asked Blender for", async () => {
    const { tools, workspace } = await setUp((request) =>
      request.op === "preview"
        ? {
            ok: true,
            text: "",
            preview: {
              path: join(workspace, "keep.txt"),
              width: 10,
              height: 10,
              view: "overview",
            },
          }
        : { ok: true, text: `did ${request.op}`, changed: true },
    );
    await writeFile(join(workspace, "keep.txt"), "the person's file");
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    await call(tools(), "blender_add_objects", { objects: [can] });
    await call(tools(), "blender_describe_scene", {});

    expect(await readFile(join(workspace, "keep.txt"), "utf8")).toBe(
      "the person's file",
    );
  });

  it("reports a Blender that stops on its own, with what it printed, and starts a new one next time", async () => {
    let crash = true;
    const { tools, scenes, blender } = await setUp((request) =>
      request.op === "shape" && crash
        ? "exit"
        : { ok: true, text: `did ${request.op}` },
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const crashed = await call(tools(), "blender_shape_objects", {
      object: "Can",
      operations: [{ kind: "smooth" }],
    });
    expect(said(crashed)).toMatch(/Blender stopped while working/);
    expect(said(crashed)).toMatch(/Blender's last words/);
    expect(scenes.scene("first").state()).toMatchObject({ status: "failed" });

    crash = false;
    const again = await call(tools(), "blender_shape_objects", {
      object: "Can",
      operations: [{ kind: "smooth" }],
    });
    expect(again.isError).toBeUndefined();
    expect(blender.launches).toHaveLength(2);
    expect(scenes.scene("first").state()).toMatchObject({ status: "open" });
  });

  it("says Blender did not start when it never becomes ready", async () => {
    const { tools, scenes } = await setUp(undefined, { ready: false });

    const result = await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(result.isError).toBe(true);
    expect(said(result)).toMatch(/Blender did not start/);
    expect(scenes.scene("first").state()).toMatchObject({
      status: "failed",
      reason: "Blender did not start.",
    });
  });

  it.each([
    ["", false],
    [", its end seen before its last words", true],
  ])(
    "says the 3D tools cannot work when Blender ends while drawing its warm-up picture%s, and offers them in no conversation after",
    async (_when, slowPipe) => {
      const { tools, scenes, blender } = await setUp(undefined, {
        cannotDraw: true,
        slowPipe,
      });
      const why = "Blender cannot draw on this PC's graphics card";

      const opened = await call(tools(), "blender_open_scene", {
        path: "scene.blend",
        create: true,
      });

      expect(opened.isError).toBe(true);
      expect(said(opened)).toContain(why);
      expect(scenes.scene("first").state()).toMatchObject({
        status: "failed",
        reason: expect.stringContaining(why),
      });
      await expect(tools("second").listTools()).rejects.toThrow(why);
      await expect(
        tools("second").inspect("blender_open_scene", {
          path: "other.blend",
          create: true,
        }),
      ).resolves.toMatchObject({
        ok: false,
        reason: expect.stringContaining(why),
      });
      expect(blender.launches).toHaveLength(1);
    },
  );

  it("takes a Blender that said it was ready for one that drew, though its end is seen before that line", async () => {
    const { tools, scenes } = await setUp(undefined, {
      endsWhenReady: true,
      slowPipe: true,
    });

    const opened = await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(opened.isError).toBe(true);
    expect(said(opened)).not.toContain("graphics card");
    expect(scenes.scene("first").state()).toMatchObject({
      status: "failed",
      reason: "Blender stopped unexpectedly.",
    });
    await expect(tools("second").listTools()).resolves.not.toHaveLength(0);
  });

  it("says only that Blender did not start, and keeps offering the tools, when it ends before drawing anything", async () => {
    const { tools, blender } = await setUp(undefined, { endsAtOnce: true });

    const result = await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(said(result)).toMatch(/Blender did not start/);
    expect(said(result)).not.toContain("graphics card");
    await expect(tools().listTools()).resolves.not.toHaveLength(0);
    expect(blender.launches).toHaveLength(1);
  });

  it("passes on Blender's refusal as one the model can act on, and keeps going", async () => {
    const { tools } = await setUp((request) =>
      request.op === "edit"
        ? {
            ok: false,
            refused: true,
            reloaded: true,
            error: "There is no object named “Nope”.",
          }
        : { ok: true, text: `did ${request.op}` },
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const refused = await call(tools(), "blender_edit_objects", {
      edits: [{ object: "Nope", delete: true }],
    });
    const next = await call(tools(), "blender_describe_scene", {});

    expect(said(refused)).toBe("There is no object named “Nope”.");
    expect(next.isError).toBeUndefined();
  });

  it("lets go of a forgotten conversation's Blender and its folder", async () => {
    const { tools, scenes, blender } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    await scenes.forget("first");

    expect(blender.ended[0]).toBe(true);
    await expect(readdir(scenes.directory("first"))).rejects.toThrow();
  });

  it("ends a Blender still starting when its conversation is forgotten, before letting go", async () => {
    const { workspace, data, blender, installed } = await setUp();
    let entered!: () => void;
    const launching = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const scenes = new ConversationScenes({
      blender: installed,
      directory: data,
      launch: async (options) => {
        entered();
        await gate;
        return blender.launch(options);
      },
      script: "C:/Zhiyin/blender-session/start.py",
      startTimeoutMs: 500,
    });
    started.push(scenes);
    const session = scenes.scene("first");
    const opening = sceneAutomation(session, {
      workspaceRoot: () => workspace,
      blender: installed,
      directory: scenes.directory("first"),
    }).callTool("blender_open_scene", { path: "scene.blend", create: true });
    await launching;

    const forgetting = scenes.forget("first");
    open();
    await forgetting;

    // What the start made is ended before the conversation's container and
    // folder are let go, so nothing it starts outlives them.
    expect(blender.launches).toHaveLength(1);
    expect(blender.ended[0]).toBe(true);
    await opening;
    // And the scene says it is closed, not still starting.
    expect(session.state().status).toBe("closed");
  });
});

describe("the workspace Blender works in", () => {
  it("starts Blender with the workspace the call works in", async () => {
    const { tools, blender, workspace } = await setUp();

    await call(tools(), "blender_open_scene", {
      path: "a.blend",
      create: true,
    });

    expect(blender.launches.map((launch) => launch.workspace)).toEqual([
      workspace,
    ]);
  });

  it("starts Blender again in the new workspace when the conversation's folder changes, and only then", async () => {
    const { scenes, blender, workspace, installed } = await setUp();
    const other = join(workspace, "..", "other");
    await mkdir(other);
    const folder = { root: workspace };
    const tools = sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => folder.root,
      blender: installed,
      directory: scenes.directory("first"),
    });
    const open = { path: "a.blend", create: true };

    await call(tools, "blender_open_scene", open);
    await call(tools, "blender_open_scene", open);
    folder.root = other;
    const moved = await call(tools, "blender_open_scene", open);

    expect(moved.isError).toBeUndefined();
    expect(blender.launches.map((launch) => launch.workspace)).toEqual([
      workspace,
      other,
    ]);
    expect(blender.ended).toEqual([true, false]);
  });
});

describe("a conversation whose folder changes while its scene is open", () => {
  async function sessionWithFolder() {
    const { scenes, blender, workspace, installed } = await setUp();
    const other = join(workspace, "..", "other");
    await mkdir(other);
    const folder = { root: workspace };
    const tools = sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => folder.root,
      blender: installed,
      directory: scenes.directory("first"),
    });
    await call(tools, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    return { tools, blender, workspace, other, folder };
  }

  it("changes nothing in a scene left in the folder before, and says no scene is open", async () => {
    const { tools, blender, workspace, other, folder } =
      await sessionWithFolder();

    folder.root = other;
    const inspected = await tools.inspect("blender_add_objects", {
      objects: [can],
    });
    const sent = blender.ops().length;
    const called = await call(tools, "blender_add_objects", {
      objects: [can],
    });

    expect(inspected).toMatchObject({ ok: false });
    expect(inspected.ok ? "" : inspected.reason).toMatch(/No scene is open/);
    expect(called.isError).toBe(true);
    expect(blender.ops()).toHaveLength(sent);

    folder.root = workspace;
    expect(
      await tools.inspect("blender_add_objects", { objects: [can] }),
    ).toMatchObject({
      ok: true,
      target: "scene.blend",
      changes: [expect.objectContaining({ path: "scene.blend" })],
    });
  });

  it("names the scene as the folder it is now in has it", async () => {
    const { tools, workspace, folder } = await sessionWithFolder();

    folder.root = join(workspace, "..");

    expect(
      await tools.inspect("blender_add_objects", { objects: [can] }),
    ).toMatchObject({
      ok: true,
      target: "workspace/scene.blend",
      changes: [expect.objectContaining({ path: "workspace/scene.blend" })],
    });
  });
});
