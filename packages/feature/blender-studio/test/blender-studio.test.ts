import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  ConversationScenes,
  sceneAutomation,
  sceneLines,
  type SessionLaunchOptions,
} from "../src/index.js";
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
    endsDrawing?: (start: number) => boolean;
    endsAtOnce?: boolean;
    endsWhenReady?: boolean;
    slowPipe?: boolean;
    previewTimeoutMs?: number;
    caseSensitive?: boolean;
    /** Zhiyin's own folders, which no tool writes. */
    protect?: readonly string[];
    /** What sealed-off programs are held from for the run going on. */
    held?: (path: string) => Promise<boolean>;
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
    ...(options.endsDrawing ? { endsDrawing: options.endsDrawing } : {}),
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
  /** The videos handed over for the person to watch, as they were then. */
  const watched: { path: string; held: string }[] = [];
  const tools = (conversation = "first") =>
    sceneAutomation(scenes.scene(conversation), {
      workspaceRoot: () => workspace,
      blender: installed,
      directory: scenes.directory(conversation),
      ...(options.protect ? { protect: options.protect } : {}),
      ...(options.held ? { held: options.held } : {}),
      video: async (file) => {
        watched.push({
          path: file.relative,
          held: await readFile(file.absolute, "utf8"),
        });
      },
    });
  return { workspace, data, blender, scenes, tools, installed, watched };
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
  it("offers nothing until Blender is installed, then all twenty-five", async () => {
    const missing = await setUp(undefined, { installed: false });
    await expect(missing.tools().listTools()).rejects.toThrow(/not installed/);

    const present = await setUp();
    const names = (await present.tools().listTools()).map((tool) => tool.name);
    expect(names).toHaveLength(25);
    expect(names).toContain("blender_shape_objects");
  });

  it("names each tool for the person while a call to it is written, as its approval does", async () => {
    const { tools } = await setUp();

    expect(
      Object.fromEntries(
        (await tools().listTools()).map((tool) => [tool.name, tool.label]),
      ),
    ).toEqual({
      blender_open_scene: "Open a 3D scene",
      blender_add_objects: "Add objects to a 3D scene",
      blender_edit_objects: "Change objects in a 3D scene",
      blender_settle_objects: "Settle objects with physics in a 3D scene",
      blender_scatter: "Scatter objects over a surface in a 3D scene",
      blender_add_decal: "Add decals to objects in a 3D scene",
      blender_unwrap: "Unwrap objects for textures in a 3D scene",
      blender_bake: "Bake materials to textures in a 3D scene",
      blender_measure: "Measure distances in a 3D scene",
      blender_rig: "Rig objects in a 3D scene",
      blender_simulate: "Simulate physics in a 3D scene",
      blender_shape_objects: "Model an object in a 3D scene",
      blender_set_material: "Set a material in a 3D scene",
      blender_set_camera: "Set the camera of a 3D scene",
      blender_set_lighting: "Light a 3D scene",
      blender_render: "Render a 3D scene",
      blender_export: "Export a 3D model",
      blender_describe_scene: "Describe a 3D scene",
      blender_api: "Look up Blender's API",
      blender_run_script: "Run a Blender script in a 3D scene",
      blender_animate: "Animate a 3D scene",
      blender_frame_sheet: "Look at frames of a 3D animation",
      blender_close_ups: "Look closely at parts of a 3D scene",
      blender_look: "Look at a 3D scene from four sides",
      blender_render_video: "Render a 3D animation to a video",
    });
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

  it("refuses to write a file through a link whose target is missing, before Blender is reached", async () => {
    const { tools, blender, workspace } = await setUp();
    const elsewhere = await folders.make("zhiyin-studio-elsewhere-");
    await symlink(
      join(elsewhere, "scene.blend"),
      join(workspace, "scene.blend"),
      "file",
    );

    const inspected = await tools().inspect("blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(inspected.ok ? "" : inspected.reason).toMatch(
      /outside the workspace/,
    );
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

  it("starts Blender in the folder as the file system names it, when the app names it by its short name", async () => {
    const { workspace, scenes, installed, blender } = await setUp();
    // The short form of a folder with a long name, as a runner whose user
    // name is longer than eight characters gives its temp folder.
    const short = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${workspace}').ShortPath`,
      ],
      { encoding: "utf8" },
    ).trim();
    if (short.toLowerCase() === workspace.toLowerCase()) return;
    const studio = sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => short,
      blender: installed,
      directory: scenes.directory("first"),
      video: async () => {},
    });

    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(blender.launches.length).toBeGreaterThan(0);
    for (const launch of blender.launches)
      expect(launch.workspace).toBe(workspace);
  });

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

    expect(wrongKind).toMatchObject({
      ok: false,
      correctable: true,
      reason: "A scene file must be one of .blend, and scene.txt is not.",
    });
    expect(missingPicture).toMatchObject({
      ok: false,
      correctable: true,
      reason: "poster.png does not exist in the workspace.",
    });
    expect(wrongRender).toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringMatching(/^A render must be one of .*render\.gif/),
    });
  });

  it("looks closely at the objects named, or at how many of those the scene is mostly about, never both", async () => {
    const { tools } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "close.blend",
      create: true,
    });

    const main = await tools().inspect("blender_close_ups", { main: 4 });
    const both = await tools().inspect("blender_close_ups", {
      main: 4,
      objects: ["Mug"],
    });
    const tooMany = await tools().inspect("blender_close_ups", { main: 9 });
    const neither = await tools().inspect("blender_close_ups", {});

    expect(main).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "none" }),
    });
    expect(JSON.stringify(main)).toContain("the 4 the scene is mostly about");
    for (const refused of [both, tooMany])
      expect(refused).toMatchObject({
        ok: false,
        correctable: true,
        reason: expect.stringMatching(/^main is how many/),
      });
    expect(neither).toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringMatching(/^objects names the objects/),
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
      effects: expect.objectContaining({ changes: "none" }),
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
      "Changes to mug.blend, and new files or ones it wrote in the workspace",
    );
    expect(rendering?.key).toBe(adding?.key);
    expect(describing?.key).toBe(adding?.key);
    // Replacing a file, a script, and another scene are asked for again.
    expect(replacing).toBeUndefined();
    expect(scripting).toBeUndefined();
    expect(elsewhere?.key).not.toBe(adding?.key);
  });

  it("keeps the allowance for a render over one this conversation made, unchanged since, and runs none over a file changed after it was allowed", async () => {
    const { tools, workspace } = await setUp(async (request) => {
      if (request.op === "render") {
        await writeFile(String(request.args["output"]), "png");
        await writeFile(String(request.args["picture"]), pictureBytes);
      }
      return { ok: true, text: `did ${request.op}` };
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "mug.blend",
      create: true,
    });
    const hero = { output: "renders/hero.png" };
    await call(studio, "blender_render", hero);

    const again = await studio.inspect("blender_render", hero);
    await writeFile(join(workspace, "renders", "hero.png"), "retouched");
    const retouched = await studio.inspect("blender_render", hero);
    const ran = (await studio.callTool(
      "blender_render",
      hero,
      undefined,
      again.ok ? again.identity : undefined,
    )) as Result & { isError?: boolean };

    expect(again).toMatchObject({
      ok: true,
      changes: expect.arrayContaining([
        expect.objectContaining({
          path: "renders/hero.png",
          change: "updated",
        }),
      ]),
      allowance: {
        label:
          "Changes to mug.blend, and new files or ones it wrote in the workspace",
      },
    });
    expect(retouched.ok && retouched.allowance).toBeFalsy();
    // Allowed while it was the conversation's own, it is not replaced once retouched.
    expect(ran.isError).toBe(true);
    expect(await readFile(join(workspace, "renders", "hero.png"), "utf8")).toBe(
      "retouched",
    );
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
      effects: expect.objectContaining({ changes: "workspace" }),
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

    const cutWith = (cutter: Record<string, unknown>) =>
      tools().inspect("blender_shape_objects", {
        object: "Bracket",
        operations: [{ kind: "boolean", cutter }],
      });
    const shown = async (cutter: Record<string, unknown>) => {
      const seen = await cutWith(cutter);
      return seen.ok ? seen.invocation?.arguments[0]?.value : undefined;
    };
    expect(
      await shown({
        shape: "rounded_box",
        size: [0.02, 0.01, 0.005],
        radius: 0.002,
        location: [0, 0, 0.003],
      }),
    ).toBe("Cut a rounded box 20 × 10 × 5 mm at (0, 0, 3 mm)");
    expect(
      await shown({
        shape: "text",
        text: "ZY",
        height: 0.01,
        depth: 0.001,
        location: [0, 0, 0.006],
      }),
    ).toBe("Cut the letters “ZY”, 1 mm deep at (0, 0, 6 mm)");
    expect(
      await shown({
        shape: "outline",
        points: [
          [0, 0],
          [0.01, 0],
          [0, 0.01],
        ],
        depth: 0.002,
        location: [0, 0, 0.003],
      }),
    ).toBe("Cut an outline of 3 points, 2 mm deep at (0, 0, 3 mm)");

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

    const alone = await tools().inspect("blender_render", {
      output: "renders/piston.png",
      only: ["Piston", "Pin"],
      frame: { direction: "front" },
    });
    expect(alone.ok && alone.invocation?.arguments).toEqual(
      expect.arrayContaining([
        { name: "Only", value: "Piston, Pin", readable: true },
        {
          name: "Framed",
          value: "what it shows, from the front",
          readable: true,
        },
      ]),
    );

    // Blender refuses these; they are refused before anyone approves them.
    const planInCycles = await tools().inspect("blender_render", {
      output: "renders/plan.png",
      view: "plan",
      engine: "cycles",
    });
    expect(planInCycles).toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringMatching(/^A plan is drawn with EEVEE/),
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
      reason: expect.stringMatching(/^A plan has a white background/),
    });
    const whiteInEevee = await tools().inspect("blender_render", {
      output: "renders/main.png",
      background: "white",
      engine: "eevee",
    });
    expect(whiteInEevee).toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringMatching(/renders with Cycles/),
    });

    const material = await tools().inspect("blender_set_material", {
      objects: ["Mug", "Handle"],
      material: { name: "Glaze", color: "#122a63", roughness: 0.12, coat: 0.6 },
    });
    expect(material.ok && material.invocation?.arguments).toEqual([
      { name: "Objects", value: "Mug, Handle", readable: true },
      {
        name: "Material",
        value:
          "Glaze, as below wherever it is used; the rest kept, or the defaults if new",
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
      value:
        "Mug material, as below wherever it is used; the rest kept, or the defaults if new",
      readable: true,
    });
    // A call that gives one value claims nothing of the values it keeps.
    const rougher = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Glaze", roughness: 0.3 },
    });
    expect(rougher.ok && rougher.invocation?.arguments).toEqual([
      { name: "Objects", value: "Mug", readable: true },
      {
        name: "Material",
        value:
          "Glaze, as below wherever it is used; the rest kept, or the defaults if new",
        readable: true,
      },
      { name: "Roughness", value: "0.3", readable: true },
    ]);

    const wood = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      material: { name: "Oak", color: "#c9a678", roughness: 0.6, wood: 0.5 },
    });
    expect(wood.ok && wood.invocation?.arguments).toEqual([
      { name: "Objects", value: "Mug", readable: true },
      {
        name: "Material",
        value:
          "Oak, as below wherever it is used; the rest kept, or the defaults if new",
        readable: true,
      },
      { name: "Colour", value: "#c9a678", readable: true },
      { name: "Roughness", value: "0.6", readable: true },
      { name: "Wood grain", value: "0.5", readable: true },
    ]);

    // A finish left without a colour or roughness takes its own, and the
    // approval says so rather than naming the plain default.
    const cast = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      material: {
        name: "Block",
        finish: "cast-aluminium",
        wear: 0.3,
        grime: 0.6,
      },
    });
    expect(cast.ok && cast.invocation?.arguments).toEqual([
      { name: "Objects", value: "Mug", readable: true },
      {
        name: "Material",
        value:
          "Block, as below wherever it is used; the rest kept, or the defaults if new",
        readable: true,
      },
      { name: "Colour", value: "cast-aluminium's own", readable: true },
      { name: "Roughness", value: "cast-aluminium's own", readable: true },
      { name: "Finish", value: "cast-aluminium", readable: true },
      { name: "Wear", value: "0.3 on edges and corners", readable: true },
      { name: "Grime", value: "0.6 in recesses and corners", readable: true },
    ]);
    // A material for one group of a CAD part's surfaces says which.
    const machined = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      surface: "machined",
      material: { name: "Bright steel" },
    });
    expect(machined.ok && machined.invocation?.arguments).toEqual([
      { name: "Objects", value: "Mug", readable: true },
      { name: "Surfaces", value: "machined", readable: true },
      {
        name: "Material",
        value: "Bright steel, as it is, or new in plain grey if there is none",
        readable: true,
      },
    ]);
    const surroundings = await tools().inspect("blender_set_lighting", {
      background: { environment: "city", rotation: 90, color: "#202020" },
    });
    expect(surroundings.ok && surroundings.invocation?.arguments).toEqual([
      {
        name: "Surroundings",
        value:
          "Blender's own city, turned 90°, seen behind the scene as plain #202020",
        readable: true,
      },
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
    // A warm glow kept from being sampled as a light says both.
    const sign = await tools().inspect("blender_set_material", {
      objects: ["Mug"],
      material: {
        name: "Sign",
        emission: { strength: 3, kelvin: 2700, lights_scene: false },
      },
    });
    expect(
      sign.ok && sign.invocation?.arguments.find((row) => row.name === "Glow"),
    ).toEqual({
      name: "Glow",
      value: "#ffffff at 2700 K at 3, not sampled as a light",
      readable: true,
    });

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

  it("shows a script whole for approval and says that what it changes is copied first, to put back", async () => {
    const { tools } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    const code =
      "import bpy\nfor o in bpy.data.objects:\n    o.location.z += 1";

    const inspected = await tools().inspect("blender_run_script", { code });

    // Shown as what runs, not as words or among the other inputs.
    expect(inspected.ok && inspected.invocation?.arguments[0]).toEqual({
      name: "Code",
      value: code,
      runs: true,
    });
    // Beside the code, in words: what the script can reach besides the scene,
    // said once, so the approval does not repeat it in a sentence above.
    expect(inspected.ok && inspected.detail).toBeUndefined();
    expect(inspected.ok && inspected.invocation?.arguments[1]).toMatchObject({
      readable: true,
      value:
        "any file in the workspace, which Zhiyin copies first to put back, and nothing else of yours",
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

  it("refuses a script longer than a call takes as one the model can correct, and leaves one that changes only the workspace to be decided by what it does", async () => {
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
    expect(script).toMatchObject({ ok: true });
    expect(script).not.toHaveProperty("asksEachTime");
  });

  it("states the longest script it runs where the model reads it, and refuses a longer one with how to split it", async () => {
    const { tools } = await setUp();
    const script = (await tools().listTools()).find(
      (tool) => tool.name === "blender_run_script",
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const refused = await tools().inspect("blender_run_script", {
      code: "x".repeat(100_001),
    });

    expect(script?.inputSchema).toMatchObject({
      properties: { code: { maxLength: 100_000 } },
    });
    const reason = refused.ok ? "" : refused.reason;
    expect(reason).toMatch(/at most 100,000 characters/);
    expect(reason).toMatch(/Split the work over several calls/);
  });

  it("states in each tool's description how long one call may run", async () => {
    const { tools } = await setUp();

    const limits = Object.fromEntries(
      (await tools().listTools()).map((tool) => [
        tool.name,
        /A call may run for up to ([^.]+)\./.exec(tool.description ?? "")?.[1],
      ]),
    );

    expect(limits).toEqual({
      blender_open_scene: "3 minutes",
      blender_add_objects: "2 minutes",
      blender_edit_objects: "2 minutes",
      blender_settle_objects: "5 minutes",
      blender_scatter: "5 minutes",
      blender_add_decal: "2 minutes",
      blender_unwrap: "5 minutes",
      blender_bake: "30 minutes",
      blender_measure: "2 minutes",
      blender_rig: "5 minutes",
      blender_simulate: "30 minutes",
      blender_shape_objects: "2 minutes",
      blender_set_material: "2 minutes",
      blender_set_camera: "2 minutes",
      blender_set_lighting: "2 minutes",
      blender_animate: "2 minutes",
      blender_run_script: "5 minutes",
      blender_render: "30 minutes",
      blender_render_video: "60 minutes",
      blender_export: "5 minutes",
      blender_describe_scene: "1 minute",
      blender_api: "1 minute",
      blender_frame_sheet: "10 minutes",
      blender_close_ups: "10 minutes",
      blender_look: "5 minutes",
    });
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

  it("gives a model new shapes from a workspace file, named in its approval, and refuses one from outside", async () => {
    const { tools, workspace, blender } = await setUp();
    await writeFile(join(workspace, "engine_v2.glb"), "model");
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const inspected = await tools().inspect("blender_edit_objects", {
      edits: [{ object: "Engine", shapes_from: "engine_v2.glb" }],
    });
    await call(tools(), "blender_edit_objects", {
      edits: [{ object: "Engine", shapes_from: "engine_v2.glb" }],
    });
    const outside = await tools().inspect("blender_edit_objects", {
      edits: [{ object: "Engine", shapes_from: "../engine_v2.glb" }],
    });

    expect(inspected).toMatchObject({
      ok: true,
      action: "Change objects in a 3D scene",
    });
    expect(inspected.ok && inspected.invocation?.arguments).toContainEqual({
      name: "Engine",
      value: "new shapes from engine_v2.glb",
      readable: true,
    });
    expect(blender.requests.find((r) => r.op === "edit")).toMatchObject({
      op: "edit",
      args: {
        edits: [
          { object: "Engine", shapes_from: join(workspace, "engine_v2.glb") },
        ],
        workspace,
      },
    });
    expect(outside.ok ? "" : outside.reason).toMatch(/outside the workspace/);
  });

  it("reads a push against another's side, a point laid on another's, instances and flying in their approvals", async () => {
    const { tools } = await setUp();
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const edited = await tools().inspect("blender_edit_objects", {
      edits: [
        { object: "Shelf", against: { object: "Wall", side: "front" } },
        {
          object: "Crate",
          against: { object: "Shelf", side: "left", gap: 0.01 },
        },
        { object: "Vase", to: { object: "Table", point: "top-centre" } },
        {
          object: "Frame",
          to: { object: "Wall", point: "nearest-surface", by: "back-centre" },
        },
        { object: "Kite", flying: true },
      ],
    });
    const added = await tools().inspect("blender_add_objects", {
      objects: [
        { name: "Crate 2", kind: "instance", of: "Crates", flying: true },
      ],
    });

    const rows = (inspected: typeof edited) =>
      inspected.ok
        ? (inspected.invocation?.arguments ?? []).map((a) => [a.name, a.value])
        : [];
    expect(rows(edited)).toEqual([
      ["Shelf", "push against Wall's front side"],
      ["Crate", "push against Shelf's left side, 10 mm apart"],
      ["Vase", "move its bottom-centre onto Table's top-centre"],
      ["Frame", "move its back-centre onto Wall's nearest-surface"],
      ["Kite", "mark as flying"],
    ]);
    expect(rows(added)).toEqual([["Crate 2", "instance, of Crates, flying"]]);
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

describe("motion", () => {
  it("describes keys, paths and aims for approval in plain rows, as a change to the open scene", async () => {
    const { tools } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });

    const inspected = await studio.inspect("blender_animate", {
      duration: 4,
      keys: [
        { object: "Ball", at: 0, location: [0, 0, 1] },
        { object: "Ball", at: 1, location: [0, 0, 0.1], easing: "ease_in" },
      ],
      paths: [
        {
          object: "Camera",
          points: [
            [0, -6, 2],
            [6, 0, 3],
          ],
          from: 0,
          to: 4,
        },
      ],
      aim: [{ object: "Camera", at: "Ball" }],
    });

    expect(inspected).toMatchObject({
      ok: true,
      action: "Animate a 3D scene",
      target: "ball.blend",
      effects: expect.objectContaining({ changes: "workspace" }),
      changes: [{ path: "ball.blend", change: "updated" }],
      invocation: {
        arguments: [
          { name: "Timeline", value: "4 s long" },
          { name: "Ball at 0 s", value: "at (0, 0, 1 m)" },
          { name: "Ball at 1 s", value: "at (0, 0, 100 mm), eased in" },
          {
            name: "Camera",
            value: "along a path through 2 points, from 0 s to 4 s",
          },
          { name: "Camera aims at", value: "Ball" },
        ],
      },
    });
    expect(inspected.ok && inspected.allowance?.label).toBe(
      "Changes to ball.blend, and new files or ones it wrote in the workspace",
    );
  });

  it("says in the approval what each part follows, at what ratio or by what formula", async () => {
    const { tools } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "engine.blend",
      create: true,
    });

    const inspected = await studio.inspect("blender_animate", {
      follow: [
        {
          object: "Pulley",
          value: "turn",
          axis: "x",
          from: { object: "Crank", value: "turn", axis: "x" },
          ratio: 3,
        },
        {
          object: "Piston",
          value: "place",
          axis: "z",
          from: { object: "Crank", value: "turn", axis: "x" },
          formula: "0.04*cos(radians(v)) + 0.15",
        },
      ],
    });

    expect(inspected).toMatchObject({
      ok: true,
      action: "Animate a 3D scene",
      invocation: {
        arguments: [
          {
            name: "Pulley's turn around x",
            value: "follows Crank's turn around x, times 3",
          },
          {
            name: "Piston's place along z",
            value:
              "follows Crank's turn around x, by 0.04*cos(radians(v)) + 0.15",
          },
        ],
      },
    });
  });

  it("refuses an animation call that sets nothing before Blender is reached", async () => {
    const { tools, blender } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });
    const sent = blender.requests.length;

    const inspected = await studio.inspect("blender_animate", {});

    expect(inspected).toMatchObject({ ok: false, correctable: true });
    expect(blender.requests.length).toBe(sent);
  });

  it("says in each tool's schema what a change cannot be made without, for the check every call meets first", async () => {
    const { tools } = await setUp();
    const schemas = Object.fromEntries(
      (await tools().listTools()).map((tool) => [tool.name, tool.inputSchema]),
    );
    type Schema = {
      required?: string[];
      properties?: Record<string, Schema>;
      items?: Schema;
    };
    /** What the schema requires at a place in the call, such as `paths[].` */
    const required = (tool: string, place: string) => {
      let schema = schemas[tool] as Schema | undefined;
      for (const step of place.split(".").filter(Boolean))
        schema = step.endsWith("[]")
          ? schema?.properties?.[step.slice(0, -2)]?.items
          : schema?.properties?.[step];
      return schema?.required ?? [];
    };

    expect(required("blender_add_objects", "objects[]")).toEqual(
      expect.arrayContaining(["name", "kind"]),
    );
    expect(required("blender_add_objects", "objects[].bevel")).toContain(
      "width",
    );
    expect(required("blender_edit_objects", "edits[]")).toContain("object");
    expect(required("blender_edit_objects", "edits[].distribute")).toContain(
      "along",
    );
    expect(required("blender_edit_objects", "edits[].turn_about")).toContain(
      "angle",
    );
    expect(required("blender_settle_objects", "")).toEqual(
      expect.arrayContaining(["objects", "on"]),
    );
    expect(required("blender_shape_objects", "")).toContain("object");
    expect(required("blender_shape_objects", "operations[]")).toContain("kind");
    expect(required("blender_shape_objects", "operations[].cutter")).toContain(
      "location",
    );
    expect(required("blender_animate", "keys[]")).toEqual(
      expect.arrayContaining(["object", "at"]),
    );
    // Points or a curve, exactly one, which the check every call meets says.
    expect(required("blender_animate", "paths[]")).toEqual(
      expect.arrayContaining(["object", "from", "to"]),
    );
    expect(required("blender_animate", "aim[]")).toEqual(
      expect.arrayContaining(["object", "at"]),
    );
    expect(required("blender_animate", "follow[]")).toEqual(
      expect.arrayContaining(["object", "value", "axis", "from"]),
    );
    expect(required("blender_animate", "follow[].from")).toEqual(
      expect.arrayContaining(["object", "value", "axis"]),
    );
    expect(required("blender_animate", "belts[]")).toEqual(
      expect.arrayContaining(["object", "pulleys"]),
    );
    expect(required("blender_animate", "belts[].follows")).toContain("object");
    expect(required("blender_animate", "cad_motion")).toEqual(
      expect.arrayContaining(["file", "to"]),
    );
  });

  it("asks nobody about a change missing what its kind of change needs, and names what is missing", async () => {
    // What a tool's schema requires is checked against the schema before
    // the studio is asked; these are what one input needs of another.
    const { tools, blender } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });
    const sent = blender.requests.length;
    const belt = {
      object: "Belt",
      pulleys: [
        { at: [0, 0, 0], radius: 0.05 },
        { at: [0.3, 0, 0], radius: 0.05 },
      ],
      axis: [0, 1, 0],
    };
    const missing: [string, Record<string, unknown>, string][] = [
      [
        "blender_shape_objects",
        {
          object: "Ball",
          operations: [
            { kind: "boolean" },
            { kind: "bevel" },
            { kind: "array", offset: [1, 0, 0] },
            { kind: "solidify" },
            { kind: "remove" },
          ],
        },
        "This call is missing operations[0].with, operations[1].width, operations[2].count, operations[3].thickness and operations[4].modifier.",
      ],
      [
        "blender_set_camera",
        { depth_of_field: { aperture: 2 } },
        "This call is missing depth_of_field.focus_object.",
      ],
      [
        "blender_animate",
        { belts: [belt] },
        "Give exactly one of belts[0].speed and belts[0].follows.",
      ],
      [
        "blender_edit_objects",
        { edits: [{ object: "Ball", duplicate: { count: 2 } }] },
        "Give exactly one of edits[0].duplicate.offset and edits[0].duplicate.around.",
      ],
      [
        "blender_edit_objects",
        {
          edits: [
            {
              object: "Ball",
              duplicate: { offset: [1, 0, 0], around: { point: [0, 0, 0] } },
            },
          ],
        },
        "Give exactly one of edits[0].duplicate.offset and edits[0].duplicate.around.",
      ],
      [
        "blender_edit_objects",
        { edits: [{ object: "Ball", turn_about: { angle: 90 } }] },
        "Give exactly one of edits[0].turn_about.point and edits[0].turn_about.object.",
      ],
      [
        "blender_animate",
        {
          belts: [
            {
              ...belt,
              speed: 0.2,
              follows: { object: "Pulley", axis: "y", radius: 0.05 },
            },
          ],
        },
        "Give exactly one of belts[0].speed and belts[0].follows.",
      ],
      [
        "blender_animate",
        { paths: [{ object: "Ball", from: 0, to: 1 }] },
        "Give exactly one of paths[0].points and paths[0].curve.",
      ],
      [
        "blender_animate",
        {
          paths: [
            {
              object: "Ball",
              points: [
                [0, 0, 0],
                [1, 0, 0],
              ],
              curve: "Track",
              from: 0,
              to: 1,
            },
          ],
        },
        "Give exactly one of paths[0].points and paths[0].curve.",
      ],
    ];

    for (const [name, args, reason] of missing)
      expect(await studio.inspect(name, args)).toMatchObject({
        ok: false,
        correctable: true,
        reason,
      });
    expect(blender.requests.length).toBe(sent);
    expect(
      await studio.inspect("blender_animate", { belts: [belt] }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason: "Give exactly one of belts[0].speed and belts[0].follows.",
    });
    // Blurring the background focuses on an object or at a distance, one of them.
    expect(
      await studio.inspect("blender_set_camera", {
        depth_of_field: { focus_object: "Ball", focus_distance: 2 },
      }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason:
        "Give exactly one of depth_of_field.focus_object and depth_of_field.focus_distance.",
    });
    // Each is enough with what it needs, and turning the blur off needs nothing.
    for (const [name, args] of [
      ["blender_set_camera", { depth_of_field: { off: true } }],
      ["blender_set_camera", { depth_of_field: { focus_distance: 2 } }],
      [
        "blender_shape_objects",
        {
          object: "Ball",
          operations: [
            {
              kind: "boolean",
              cutter: { shape: "box", size: [1, 1, 1], location: [0, 0, 0] },
            },
          ],
        },
      ],
      ["blender_animate", { belts: [{ ...belt, speed: 0.2 }] }],
      [
        "blender_animate",
        {
          belts: [
            { ...belt, follows: { object: "Pulley", axis: "y", radius: 0.05 } },
          ],
        },
      ],
      ["blender_edit_objects", { edits: [{ object: "Ball", delete: true }] }],
    ] as const)
      expect(await studio.inspect(name, args)).toMatchObject({ ok: true });
  });

  it("shows the model a frame sheet as a picture kept out of the workspace, as a look that changes nothing", async () => {
    const { tools, workspace } = await setUp(async (request) => {
      if (request.op === "frames")
        await writeFile(String(request.args["picture"]), pictureBytes);
      return { ok: true, text: `did ${request.op}` };
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });

    const before = await readdir(workspace, { recursive: true });
    const inspected = await studio.inspect("blender_frame_sheet", {
      start: 0,
      every_ms: 250,
      count: 8,
    });
    const sheet = await call(studio, "blender_frame_sheet", {
      start: 0,
      every_ms: 250,
      count: 8,
    });

    expect(inspected).toMatchObject({
      ok: true,
      action: "Look at frames of a 3D animation",
      effects: expect.objectContaining({ changes: "none" }),
      invocation: {
        arguments: [
          { name: "Frames", value: "8, from 0 s, every 250 ms" },
          { name: "Seen from", value: "the scene camera" },
        ],
      },
    });
    expect(inspected.ok && inspected.changes).toBeUndefined();
    // How often to look is what the sheet is of: without it, nobody is asked.
    for (const every_ms of [undefined, 0, "250"])
      expect(
        await studio.inspect("blender_frame_sheet", { count: 8, every_ms }),
      ).toMatchObject({
        ok: false,
        correctable: true,
        reason: "every_ms is the time between frames, in milliseconds from 1.",
      });
    expect(sheet.content.find((c) => c.type === "image")?.data).toBe(
      pictureBytes.toString("base64"),
    );
    // Nothing is written to the workspace.
    expect(await readdir(workspace, { recursive: true })).toEqual(before);
    expect(studio.produced("blender_frame_sheet", {}, sheet)).toEqual([]);
  });

  it("shows the model a look from four sides as a picture kept out of the workspace, a read that runs unasked", async () => {
    const { tools, workspace } = await setUp(async (request) => {
      if (request.op === "look")
        await writeFile(String(request.args["picture"]), pictureBytes);
      return { ok: true, text: `did ${request.op}` };
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "mug.blend",
      create: true,
    });
    const before = await readdir(workspace, { recursive: true });

    const inspected = await studio.inspect("blender_look", {
      objects: ["Mug"],
      shading: "faces",
    });
    const looked = await call(studio, "blender_look", {
      objects: ["Mug"],
      shading: "faces",
    });

    expect(inspected).toMatchObject({
      ok: true,
      action: "Look at a 3D scene from four sides",
      effects: expect.objectContaining({ changes: "none" }),
      invocation: {
        arguments: [
          {
            name: "Look at",
            value: "Mug, from the front, right, top and three-quarter",
          },
          { name: "Drawn", value: "by the way each face points" },
        ],
      },
    });
    expect(inspected.ok && inspected.changes).toBeUndefined();
    expect(looked.content.find((c) => c.type === "image")?.data).toBe(
      pictureBytes.toString("base64"),
    );
    expect(await readdir(workspace, { recursive: true })).toEqual(before);
    expect(studio.produced("blender_look", {}, looked)).toEqual([]);
  });

  it("checks every frame in numbers without pictures: no spacing needed, no picture asked for, and the time it may take sent with it", async () => {
    const { tools, blender } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "gears.blend",
      create: true,
    });
    const asked = {
      pictures: false,
      start: 0,
      end: 2,
      allowed: [["Gear_A", "Gear_B"]],
    };

    const inspected = await studio.inspect("blender_frame_sheet", asked);
    const report = await call(studio, "blender_frame_sheet", asked);
    const sent = blender.requests.find((r) => r.op === "frames");

    expect(inspected).toMatchObject({
      ok: true,
      action: "Check every frame of a 3D animation",
      effects: expect.objectContaining({ changes: "none" }),
      invocation: {
        arguments: [
          {
            name: "Checks",
            value: "every frame from 0 s to 2 s, in numbers, with no pictures",
          },
          { name: "Touching by design", value: "Gear_A with Gear_B" },
        ],
      },
    });
    expect(report.content.some((c) => c.type === "image")).toBe(false);
    expect(sent?.args["picture"]).toBeUndefined();
    expect(sent?.args["limit_seconds"]).toBe(600);
  });

  it("sends every command with the seconds it may run, so Blender can fit its checks within them", async () => {
    const { tools, blender } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "timed.blend",
      create: true,
    });
    await call(studio, "blender_describe_scene", {});

    const seconds = (op: string) =>
      blender.requests.find((r) => r.op === op)?.seconds;
    // Opening may run 3 minutes and describing 1.
    expect(seconds("open")).toBe(180);
    expect(seconds("describe")).toBe(60);
  });

  it("hands over a video only when the call wrote it, not one an earlier call left while frames are still being drawn", async () => {
    const { tools, blender, workspace, watched } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });
    await mkdir(join(workspace, "videos"), { recursive: true });
    await writeFile(join(workspace, "videos", "long.mp4"), "an older video");
    // Written by an earlier call, a minute ago.
    const earlier = new Date(Date.now() - 60_000);
    await utimes(join(workspace, "videos", "long.mp4"), earlier, earlier);

    const inspected = await studio.inspect("blender_render_video", {
      output: "videos/long.mp4",
      every: 2,
      slow_motion: 1.5,
    });
    const partial = await call(studio, "blender_render_video", {
      output: "videos/long.mp4",
      every: 2,
      slow_motion: 1.5,
    });
    const sent = blender.requests.find((r) => r.op === "video");

    expect(inspected).toMatchObject({
      ok: true,
      invocation: {
        arguments: expect.arrayContaining([
          expect.objectContaining({
            name: "Draft",
            value: "every 2 frames, at its real speed",
          }),
          expect.objectContaining({
            name: "Slow motion",
            value: "1.5 times slower",
          }),
        ]),
      },
    });
    // The frames of a video too long for one call are kept by the name it was approved by.
    expect(sent?.args["video_key"]).toBe("videos/long.mp4");
    expect(watched).toEqual([]);
    expect(studio.produced("blender_render_video", {}, partial)).toEqual([]);
  });

  it("writes a video to the workspace for the person, lists it as produced, hands it over to be watched, and shows the model no picture", async () => {
    const { tools, watched } = await setUp(async (request) => {
      if (request.op === "video")
        await writeFile(String(request.args["output"]), "mp4");
      return { ok: true, text: `did ${request.op}` };
    });
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });

    const inspected = await studio.inspect("blender_render_video", {
      output: "videos/ball.mp4",
    });
    const video = await call(studio, "blender_render_video", {
      output: "videos/ball.mp4",
    });
    const gif = await studio.inspect("blender_render_video", {
      output: "videos/ball.gif",
    });
    const numbered = await studio.inspect("blender_render_video", {
      output: "videos/take#1.mp4",
    });

    expect(inspected).toMatchObject({
      ok: true,
      action: "Render a 3D animation to a video",
      target: "videos/ball.mp4",
      effects: expect.objectContaining({ changes: "workspace" }),
      changes: [{ path: "videos/ball.mp4", change: "created" }],
    });
    expect(studio.produced("blender_render_video", {}, video)).toEqual([
      { path: "videos/ball.mp4", change: "created", bytes: 3 },
    ]);
    expect(watched).toEqual([{ path: "videos/ball.mp4", held: "mp4" }]);
    expect(video.content.some((c) => c.type === "image")).toBe(false);
    expect(gif).toMatchObject({
      ok: false,
      correctable: true,
      reason: "A video must be one of .mp4, and videos/ball.gif is not.",
    });
    // Blender would write another name than the one approved.
    expect(numbered).toMatchObject({
      ok: false,
      correctable: true,
      reason:
        "A video's name cannot hold #, which Blender replaces with frame numbers.",
    });
  });

  it("says a video stopped while writing may have left an incomplete file, and hands nothing over to be watched", async () => {
    const controller = new AbortController();
    const { tools, watched } = await setUp(async (request) => {
      if (request.op === "video") {
        await writeFile(String(request.args["output"]), "half a video");
        controller.abort();
        return "silent";
      }
      return { ok: true, text: `did ${request.op}` };
    });
    await call(tools(), "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });

    const stopped = await call(
      tools(),
      "blender_render_video",
      { output: "ball.mp4" },
      controller.signal,
    );

    expect(said(stopped)).toMatch(/ball\.mp4 .*incomplete/);
    expect(watched).toEqual([]);
  });

  it("says when a frame sheet that failed part way could not put the scene back", async () => {
    const { tools } = await setUp((request) =>
      request.op === "frames"
        ? { ok: false, error: "RuntimeError: stop here", reloaded: false }
        : { ok: true, text: `did ${request.op}` },
    );
    await call(tools(), "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });

    const failed = await call(tools(), "blender_frame_sheet", {
      every_ms: 100,
    });

    expect(said(failed)).toMatch(/RuntimeError: stop here/);
    expect(said(failed)).toMatch(
      /could not put the scene back as it was saved/,
    );
  });

  it("says the moment a still is rendered at, for approval", async () => {
    const { tools } = await setUp();
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "ball.blend",
      create: true,
    });

    const inspected = await studio.inspect("blender_render", {
      output: "renders/half.png",
      time: 1.5,
    });

    expect(inspected.ok && inspected.invocation?.arguments).toContainEqual(
      expect.objectContaining({
        name: "At",
        value: "1.5 s into the animation",
      }),
    );
  });
});

describe("a conversation's session", () => {
  it("is the conversation's own: two conversations get two Blenders", async () => {
    const { scenes, tools, blender, workspace } = await setUp();
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
    expect(await scenes.scene("first").sceneIn(workspace)).toBe("a.blend");
    expect(await scenes.scene("second").sceneIn(workspace)).toBe("b.blend");
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
      request.op === "add" ? "silent" : { ok: true, text: "done" },
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const late = await scenes
      .scene("first")
      .run("add", { objects: [can] }, { timeoutMs: 50, workspace });

    expect(late.ok).toBe(false);
    expect(late.ok ? "" : late.reason).toMatch(/ran past its time limit/);
    expect(late.ok ? "" : late.reason).toMatch(/The change was not made/);
    expect(blender.ended[0]).toBe(true);
  });

  it("ends only the Blender running a script when the script runs past its time limit, and the session carries on", async () => {
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
    const next = await call(tools(), "blender_describe_scene", {});

    expect(late.ok).toBe(false);
    expect(late.ok ? "" : late.reason).toMatch(/ran past its time limit/);
    expect(late.ok ? "" : late.reason).toMatch(
      /The scene file was not changed/,
    );
    // The first Blender is the session's, the second the script's own.
    expect(blender.ended).toEqual([false, true]);
    expect(said(next)).toMatch(/^done/);
    expect(blender.launches).toHaveLength(2);
  });

  it("names the time limit a command ran past, and how to finish within it", async () => {
    const { tools, scenes, workspace } = await setUp((request) =>
      request.op === "add" ? "silent" : { ok: true, text: "done" },
    );
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const late = await scenes
      .scene("first")
      .run("add", { objects: [can] }, { timeoutMs: 1_000, workspace });

    const reason = late.ok ? "" : late.reason;
    expect(reason).toMatch(/ran past its time limit of 1 second/);
    expect(reason).toMatch(
      /do less in one call \(fewer objects, frames or samples, or a smaller resolution\), or split the work over several calls/,
    );
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
      if (request.op !== "edit" || !hang)
        return { ok: true, text: `did ${request.op}` };
      // Stopped once Blender has the change, which never answers.
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
      "blender_edit_objects",
      { edits: [{ object: "Can", location: [1, 0, 0] }] },
      controller.signal,
    );
    expect(stuck.isError).toBe(true);
    expect(said(stuck)).toMatch(/The change was not made/);
    expect(blender.ended[0]).toBe(true);

    hang = false;
    await call(studio, "blender_add_objects", { objects: [can] });
    expect(blender.launches).toHaveLength(2);
    // The new Blender opens the scene file before anything else.
    const ops = blender.ops();
    expect(ops[ops.lastIndexOf("add") - 1]).toBe("open");
  });

  describe("a script", () => {
    /** A stand-in whose every request is kept with the Blender, counted from 0, it reached. */
    async function sealedSetUp(
      answer: (request: Parameters<Behaviour>[0]) => Record<string, unknown>,
    ) {
      const reached: {
        op: string;
        blender: number | undefined;
        request: unknown;
      }[] = [];
      const set = await setUp((request, blender) => {
        reached.push({ op: request.op, blender, request });
        return answer(request);
      });
      await call(set.tools(), "blender_open_scene", {
        path: "scene.blend",
        create: true,
      });
      return { ...set, reached };
    }

    it("runs in a Blender of its own, which opens the saved scene, runs it and is ended; the session then answers for what it saved", async () => {
      const set = await sealedSetUp((request) =>
        request.op === "script"
          ? { ok: true, text: "printed 1" }
          : request.op === "after_script"
            ? { ok: true, text: `${String(request.args["ran"])}\nAdded Box.` }
            : { ok: true, text: `did ${request.op}` },
      );

      const ran = await call(set.tools(), "blender_run_script", {
        code: "print(1)",
      });

      expect(ran.isError, said(ran)).toBeUndefined();
      expect(said(ran)).toContain("printed 1\nAdded Box.");
      // The previews the person's view asks for are drawn by the session alone.
      expect(
        set.reached
          .filter(({ op }) => op !== "preview")
          .map(({ op, blender }) => [op, blender])
          .slice(1),
      ).toEqual([
        ["before_script", 0],
        ["script", 1],
        ["after_script", 0],
      ]);
      expect(set.blender.launches[1]).toMatchObject({ sealed: true });
      expect(set.blender.launches[1]).not.toHaveProperty("warm");
      const sent = set.reached.find(({ op }) => op === "script")?.request as {
        args: Record<string, unknown>;
      };
      expect(sent.args["scene"]).toBe(join(set.workspace, "scene.blend"));
      expect(sent.args["code"]).toBe("print(1)");
      expect(set.blender.ended).toEqual([false, true]);
    });

    it("that fails ends only its own Blender, and the session is not asked to answer for it", async () => {
      const set = await sealedSetUp((request) =>
        request.op === "script"
          ? { ok: false, error: "NameError: name 'cube' is not defined" }
          : { ok: true, text: `did ${request.op}` },
      );

      const failed = await call(set.tools(), "blender_run_script", {
        code: "cube.scale.x = 2",
      });

      expect(failed.isError).toBe(true);
      expect(said(failed)).toContain("NameError: name 'cube' is not defined");
      expect(set.reached.map(({ op }) => op)).not.toContain("after_script");
      expect(set.blender.ended).toEqual([false, true]);
    });

    it("starts no Blender of its own when the session has no scene to run it in", async () => {
      const set = await sealedSetUp((request) =>
        request.op === "before_script"
          ? {
              ok: false,
              refused: true,
              error:
                "No scene is open. Open or create one with blender_open_scene first.",
            }
          : { ok: true, text: `did ${request.op}` },
      );

      const refused = await call(set.tools(), "blender_run_script", {
        code: "print(1)",
      });

      expect(refused.isError).toBe(true);
      expect(said(refused)).toContain("No scene is open.");
      expect(set.blender.launches).toHaveLength(1);
    });

    it("keeps part of the call's time for what the session does after it", async () => {
      const set = await sealedSetUp((request) => ({
        ok: true,
        text: `did ${request.op}`,
      }));

      await set.scenes
        .scene("first")
        .run(
          "script",
          { code: "print(1)" },
          { timeoutMs: 10_000, workspace: set.workspace },
        );

      const seconds = (op: string) =>
        (
          set.reached.find((one) => one.op === op)?.request as {
            seconds: number;
          }
        ).seconds;
      // A fifth of a call this short is kept back from the script, and the
      // session's step after it has what the script left of the rest.
      expect(seconds("script")).toBeLessThanOrEqual(8);
      expect(seconds("script")).toBeGreaterThan(7);
      expect(seconds("after_script")).toBeGreaterThan(2);
    });

    it("that fails after it ran says the scene file keeps what it did", async () => {
      const set = await sealedSetUp((request) =>
        request.op === "after_script"
          ? { ok: false, error: "OSError: the disk is full", reloaded: true }
          : { ok: true, text: `did ${request.op}` },
      );

      const failed = await call(set.tools(), "blender_run_script", {
        code: "print(1)",
      });

      expect(failed.isError).toBe(true);
      expect(said(failed)).toContain(
        "The script ran, and the scene file keeps what it did; then this failed:\nOSError: the disk is full",
      );
    });
  });

  it("ends only the Blender running a script when the script is stopped, and the session carries on with the scene as saved", async () => {
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
    hang = false;
    const added = await call(studio, "blender_add_objects", {
      objects: [can],
    });

    expect(stuck.isError).toBe(true);
    expect(said(stuck)).toMatch(/The script was stopped/);
    expect(said(stuck)).toMatch(/The scene file was not changed/);
    // The first Blender is the session's, the second the script's own.
    expect(blender.ended).toEqual([false, true]);
    expect(said(added)).toBe("did add");
    expect(blender.launches).toHaveLength(2);
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

  it("says when a measure that failed part way could not put the scene back", async () => {
    const { tools } = await setUp((request) =>
      request.op === "measure"
        ? { ok: false, error: "RuntimeError: stop here", reloaded: false }
        : { ok: true, text: `did ${request.op}` },
    );
    const studio = tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    const failed = await call(studio, "blender_measure", {
      between: ["Can", "Lid"],
    });

    expect(said(failed)).toMatch(/RuntimeError: stop here/);
    expect(said(failed)).toMatch(
      /could not put the scene back as it was saved, so it may still hold the time or settings the failed command moved/,
    );
  });

  it("puts its scene away when going back removed the turn that opened it", async () => {
    const { tools, scenes, workspace } = await setUp();
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
    expect(await scenes.scene("first").sceneIn(workspace)).toBeUndefined();
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
    const { tools, scenes, workspace } = await setUp((request) => {
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
    expect(await scenes.scene("first").sceneIn(workspace)).toBeUndefined();
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

  /** How each Blender was started: drawing on the graphics card, finding out whether it can, or on the processor. */
  const startedAs = (launches: readonly SessionLaunchOptions[]) =>
    launches.map((launch) =>
      launch.probe
        ? "to find out"
        : launch.sealed
          ? "sealed"
          : launch.processor
            ? "on the processor"
            : "on the graphics card",
    );
  const onProcessor =
    "This computer's graphics card cannot draw Blender's pictures, so Blender draws them on the processor, which takes longer.";

  it.each([
    ["", false],
    [", its end seen before its last words", true],
  ])(
    "draws on the processor when Blender ends while drawing its warm-up picture%s and so does a Blender started to find out, saying so once",
    async (_when, slowPipe) => {
      const { tools, scenes, blender } = await setUp(undefined, {
        cannotDraw: true,
        slowPipe,
      });

      const opened = await call(tools(), "blender_open_scene", {
        path: "scene.blend",
        create: true,
      });
      const added = await call(tools(), "blender_add_objects", {
        objects: [can],
      });

      expect(opened.isError, said(opened)).toBeFalsy();
      expect(said(opened)).toContain(onProcessor);
      expect(added.isError, said(added)).toBeFalsy();
      expect(said(added)).not.toContain(onProcessor);
      expect(scenes.scene("first").state()).toMatchObject({
        status: "open",
        note: onProcessor,
      });
      // Started once more, then once to find out, before it draws on the processor.
      expect(startedAs(blender.launches)).toEqual([
        "on the graphics card",
        "on the graphics card",
        "to find out",
        "on the processor",
      ]);
    },
  );

  it("starts every Blender after on the processor, in every conversation, without finding out again", async () => {
    const { tools, scenes, blender } = await setUp(undefined, {
      cannotDraw: true,
    });
    await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    await expect(tools("second").listTools()).resolves.not.toHaveLength(0);
    const second = await call(tools("second"), "blender_open_scene", {
      path: "other.blend",
      create: true,
    });
    const script = await call(tools("second"), "blender_run_script", {
      code: "print('hello')",
    });

    expect(second.isError, said(second)).toBeFalsy();
    expect(said(second)).toContain(onProcessor);
    expect(script.isError, said(script)).toBeFalsy();
    expect(scenes.scene("second").state()).toMatchObject({
      status: "open",
      note: onProcessor,
    });
    expect(startedAs(blender.launches).slice(4)).toEqual([
      "on the processor",
      "sealed",
    ]);
    expect(blender.launches[5]?.processor).toBe(true);
  });

  it("finds out once for conversations that start at the same time", async () => {
    const { tools, blender } = await setUp(undefined, { cannotDraw: true });

    const opened = await Promise.all(
      ["first", "second"].map((conversation) =>
        call(tools(conversation), "blender_open_scene", {
          path: `${conversation}.blend`,
          create: true,
        }),
      ),
    );

    for (const answer of opened)
      expect(answer.isError, said(answer)).toBeFalsy();
    expect(
      startedAs(blender.launches).filter((how) => how === "to find out"),
    ).toHaveLength(1);
    expect(
      startedAs(blender.launches).filter((how) => how === "on the processor"),
    ).toHaveLength(2);
  });

  it("takes a Blender started to find out that draws for a PC that draws: only that start failed, and the next draws on the graphics card", async () => {
    const { tools, scenes, blender } = await setUp(undefined, {
      endsDrawing: (start) => start < 2,
    });

    const failed = await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    const again = await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(failed.isError).toBe(true);
    expect(said(failed)).toContain(
      "Blender ended while drawing its first picture",
    );
    expect(said(failed)).not.toContain("processor");
    expect(again.isError, said(again)).toBeFalsy();
    expect(scenes.scene("first").state()).toMatchObject({ status: "open" });
    expect(scenes.scene("first").state()).not.toHaveProperty("note");
    expect(startedAs(blender.launches)).toEqual([
      "on the graphics card",
      "on the graphics card",
      "to find out",
      "on the graphics card",
    ]);
  });

  it("starts Blender once more when one ends while drawing its warm-up picture, and works when that one draws", async () => {
    const { tools, scenes, blender } = await setUp(undefined, {
      endsDrawing: (start) => start === 0,
    });

    const opened = await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(opened.isError, said(opened)).toBeFalsy();
    expect(blender.launches).toHaveLength(2);
    expect(scenes.scene("first").state()).toMatchObject({ status: "open" });
  });

  it("takes a Blender that ends while drawing, after one has drawn on this PC, for a failed start, and keeps the tools", async () => {
    const { tools, scenes } = await setUp(undefined, {
      endsDrawing: (start) => start > 0,
    });
    const drew = await call(tools(), "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    expect(drew.isError, said(drew)).toBeFalsy();

    const second = await call(tools("second"), "blender_open_scene", {
      path: "other.blend",
      create: true,
    });

    expect(second.isError).toBe(true);
    expect(said(second)).not.toContain("cannot draw on this PC");
    expect(said(second)).toContain(
      "Blender ended while drawing its first picture",
    );
    expect(scenes.scene("second").state()).toMatchObject({ status: "failed" });
    await expect(tools("third").listTools()).resolves.not.toHaveLength(0);
  });

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
    // As Blender confined to the workspace it started in: it opens no file
    // outside it.
    let confined = (): string | undefined => undefined;
    const { scenes, blender, workspace, installed } = await setUp((request) => {
      const inside = confined();
      return request.op === "open" &&
        inside !== undefined &&
        !String(request.args["path"]).startsWith(inside)
        ? { ok: false, error: "Blender cannot read that file." }
        : { ok: true, text: `did ${request.op}` };
    });
    confined = () => blender.launches.at(-1)?.workspace;
    const other = join(workspace, "..", "other");
    await mkdir(other);
    const folder = { root: workspace };
    const tools = sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => folder.root,
      blender: installed,
      directory: scenes.directory("first"),
    });
    const lines = sceneLines(
      scenes.scene("first"),
      scenes.directory("first"),
      installed,
    );
    await call(tools, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    return { tools, lines, blender, workspace, other, folder };
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

  it("names the scene for a drawing as the folder it is now in has it", async () => {
    const { lines, workspace, folder } = await sessionWithFolder();

    folder.root = join(workspace, "..");

    expect(await lines.open(folder.root)).toBe("workspace/scene.blend");
  });

  it("draws nothing of a scene left in the folder before, answers what needs no scene, and finds the scene again back in its folder", async () => {
    const { tools, lines, blender, workspace, other, folder } =
      await sessionWithFolder();
    const views = [{ view: "top" }];

    folder.root = other;
    const drawing = await lines.lines({ views }, { workspace: other });
    const looked = await call(tools, "blender_api", { name: "Object" });

    expect(await lines.open(other)).toBeUndefined();
    expect(drawing).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/No 3D scene is open/),
    });
    expect(blender.requests.some((request) => request.op === "lines")).toBe(
      false,
    );
    expect(looked.isError, said(looked)).toBeUndefined();
    expect(said(looked)).toBe("did api");

    folder.root = workspace;
    const before = blender.requests.length;
    const added = await call(tools, "blender_add_objects", { objects: [can] });

    expect(await lines.open(workspace)).toBe("scene.blend");
    expect(added.isError, said(added)).toBeUndefined();
    // The Blender started back in its folder opened the scene again first.
    expect(
      blender.requests
        .slice(before)
        .map((request) => request.op)
        .filter((op) => op !== "preview"),
    ).toEqual(["open", "add"]);
  });
});

describe("a drawing's lines", () => {
  const views = [
    { view: "top" },
    { section: "A", looking: "front", through: [0, 0, 1200] },
  ];

  it("says whether Blender is installed", async () => {
    const { scenes } = await setUp();
    const at = (blender: string | undefined) =>
      sceneLines(
        scenes.scene("first"),
        scenes.directory("first"),
        async () => blender,
      ).installed();

    expect(await at("C:/Blender/blender.exe")).toBe(true);
    expect(await at(undefined)).toBe(false);
  });

  it("asks for nothing while no scene is open, and says so", async () => {
    const { blender, scenes, workspace } = await setUp();
    const lines = sceneLines(
      scenes.scene("first"),
      scenes.directory("first"),
      async () => "blender.exe",
    );

    expect(await lines.open(workspace)).toBeUndefined();
    expect(await lines.lines({ views }, { workspace })).toEqual({
      ok: false,
      reason:
        "No 3D scene is open in this conversation. Open one with blender_open_scene first.",
    });
    expect(blender.requests).toEqual([]);
  });

  it("asks Blender for the lines of the views, and gives what it wrote, keeping no file", async () => {
    const { blender, scenes, tools, workspace } = await setUp(
      async (request) => {
        if (request.op === "lines")
          await writeFile(
            String(request.args["output"]),
            '{"views": {"top": {}}}',
          );
        return { ok: true, text: `did ${request.op}` };
      },
    );
    await call(tools(), "blender_open_scene", {
      path: "flat.blend",
      create: true,
    });
    const lines = sceneLines(
      scenes.scene("first"),
      scenes.directory("first"),
      async () => "blender.exe",
    );

    const found = await lines.lines(
      { objects: ["Walls"], views },
      { workspace },
    );

    expect(await lines.open(workspace)).toBe("flat.blend");
    expect(found).toEqual({ ok: true, lines: '{"views": {"top": {}}}' });
    const asked = blender.requests.find((request) => request.op === "lines");
    expect(asked?.args).toMatchObject({ objects: ["Walls"], views });
    // Written in the conversation's own data, not the workspace, and gone after.
    expect(
      String(asked?.args["output"]).startsWith(scenes.directory("first")),
    ).toBe(true);
    expect(await readdir(join(scenes.directory("first"), "lines"))).toEqual([]);
  });

  it("says why Blender could not find the lines", async () => {
    const { scenes, tools, workspace } = await setUp(async (request) =>
      request.op === "lines"
        ? { ok: false, error: "There is no object called Sofa.", refused: true }
        : { ok: true, text: `did ${request.op}` },
    );
    await call(tools(), "blender_open_scene", {
      path: "flat.blend",
      create: true,
    });
    const lines = sceneLines(
      scenes.scene("first"),
      scenes.directory("first"),
      async () => "blender.exe",
    );

    expect(
      await lines.lines({ objects: ["Sofa"], views }, { workspace }),
    ).toEqual({
      ok: false,
      reason: "There is no object called Sofa.",
    });
  });
});

describe("a file written outside the workspace", () => {
  /** A scene open, a folder outside the workspace, and Zhiyin's own folder. */
  async function outside(
    behaviour?: Behaviour,
    held?: (path: string) => Promise<boolean>,
  ) {
    const own = await realpath(await folders.make("zhiyin-studio-own-"));
    const set = await setUp(
      behaviour ??
        (async (request) => {
          // As Blender writes what it is asked to, where it is told.
          if (["export", "render", "video"].includes(request.op))
            await writeFile(String(request.args["output"]), `${request.op}d`);
          return { ok: true, text: `did ${request.op}` };
        }),
      { protect: [own], ...(held ? { held } : {}) },
    );
    const elsewhere = await realpath(
      await folders.make("zhiyin-studio-elsewhere-"),
    );
    const studio = set.tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    return { ...set, studio, elsewhere, own };
  }

  it("is approved by its whole real path, said to be outside the folder chosen, and lands there without Blender being given that folder", async () => {
    const { studio, elsewhere, blender, data, workspace, scenes } =
      await outside();
    const output = join(elsewhere, "prints", "part.stl");

    const inspected = await studio.inspect("blender_export", { output });
    const exported = await call(studio, "blender_export", { output });

    expect(inspected).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "elsewhere" }),
      target: output,
      changes: [{ path: output, change: "created" }],
      detail: expect.stringContaining(
        "written outside the folder you selected",
      ),
    });
    expect(exported.isError, said(exported)).toBeUndefined();
    expect(await readFile(output, "utf8")).toBe("exportd");
    expect(studio.produced("blender_export", { output }, exported)).toEqual([
      { path: output, change: "created", bytes: 7 },
    ]);
    // Blender wrote in the conversation's own folder, and was confined to
    // the workspace as ever.
    const asked = blender.requests.find((request) => request.op === "export");
    expect(String(asked?.args["output"]).startsWith(data)).toBe(true);
    expect(blender.launches.map((launch) => launch.workspace)).toEqual([
      workspace,
    ]);
    expect(
      await readdir(join(scenes.directory("first"), "staging"), {
        recursive: true,
      }).catch(() => []),
    ).toEqual([]);
  });

  it("writes a render and a video outside the same way, and replaces a file there that is as it was approved", async () => {
    const { studio, elsewhere } = await outside();
    const picture = join(elsewhere, "shot.png");
    const video = join(elsewhere, "turn.mp4");
    await writeFile(picture, "an older picture");

    const inspected = await studio.inspect("blender_render", {
      output: picture,
    });
    const rendered = await call(studio, "blender_render", { output: picture });
    const filmed = await call(studio, "blender_render_video", {
      output: video,
    });

    expect(inspected).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "elsewhere" }),
      // The scene keeps the render's settings, so it is backed up too.
      changes: [
        { path: picture, change: "updated" },
        { path: "scene.blend", change: "updated" },
      ],
    });
    expect(rendered.isError, said(rendered)).toBeUndefined();
    expect(await readFile(picture, "utf8")).toBe("renderd");
    expect(filmed.isError, said(filmed)).toBeUndefined();
    expect(await readFile(video, "utf8")).toBe("videod");
  });

  it("refuses a place in Zhiyin's own folders before Blender is asked", async () => {
    const { studio, own, blender } = await outside();
    const sent = blender.requests.length;

    const inspected = await studio.inspect("blender_export", {
      output: join(own, "approvals.glb"),
    });
    const called = await call(studio, "blender_export", {
      output: join(own, "approvals.glb"),
    });

    expect(inspected).toMatchObject({
      ok: false,
      reason: expect.stringContaining(
        "is in a folder Zhiyin keeps for itself, which no tool writes",
      ),
    });
    expect(called.isError).toBe(true);
    expect(blender.requests.length).toBe(sent);
    expect(await readdir(own)).toEqual([]);
  });

  it("answers a place in Zhiyin's own folders to the model, which can choose another", async () => {
    const { studio, own } = await outside();
    const output = join(own, "approvals.glb");

    expect(await studio.inspect("blender_export", { output })).toEqual({
      ok: false,
      correctable: true,
      reason: `${output} is in a folder Zhiyin keeps for itself, which no tool writes. Choose another place for the file.`,
    });
  });

  it("does not replace a file that changed, or appeared, while Blender was writing, and keeps nothing it wrote", async () => {
    let elsewhereFolder = "";
    const { studio, elsewhere, scenes } = await outside(async (request) => {
      if (request.op === "export") {
        const output = String(request.args["output"]);
        await writeFile(output, "the new export");
        // Meanwhile, another program changes the file there, or makes one.
        await writeFile(
          join(elsewhereFolder, basename(output)),
          basename(output) === "kept.glb" ? "changed by hand" : "made by hand",
        );
      }
      return { ok: true, text: `did ${request.op}` };
    });
    elsewhereFolder = elsewhere;
    const kept = join(elsewhere, "kept.glb");
    await writeFile(kept, "as approved");

    const replaced = await call(studio, "blender_export", { output: kept });
    const created = await call(studio, "blender_export", {
      output: join(elsewhere, "new.glb"),
    });

    expect(replaced.isError).toBe(true);
    expect(said(replaced)).toContain("it changed while Blender wrote it");
    expect(await readFile(kept, "utf8")).toBe("changed by hand");
    expect(created.isError).toBe(true);
    expect(said(created)).toContain("a file appeared there");
    expect(await readFile(join(elsewhere, "new.glb"), "utf8")).toBe(
      "made by hand",
    );
    expect(
      await readdir(join(scenes.directory("first"), "staging"), {
        recursive: true,
      }).catch(() => []),
    ).toEqual([]);
  });

  it("lets a script write folders outside the workspace it names, which Zhiyin copies first and the person may allow it by, by moving what it made there when it ends", async () => {
    const { studio, elsewhere, scenes } = await outside(async (request) => {
      if (request.op === "script") {
        // As a script writes into the folder it was told to use.
        const [given] = request.args["outside"] as {
          folder: string;
          staging: string;
        }[];
        await mkdir(join(given!.staging, "sub"), { recursive: true });
        await writeFile(join(given!.staging, "sub", "a.txt"), "from Blender");
      }
      return { ok: true, text: `did ${request.op}` };
    });
    const args = { code: "print(1)", outside_folders: [elsewhere] };

    const inspected = await studio.inspect("blender_run_script", args);
    const ran = await call(studio, "blender_run_script", args);

    expect(inspected).toMatchObject({
      ok: true,
      changesAnyFile: { outside: [elsewhere] },
    });
    expect(inspected).not.toHaveProperty("asksEachTime");
    expect(
      inspected.ok &&
        inspected.invocation?.arguments.find(
          (row) => row.name === "Can also change",
        )?.value,
    ).toContain(`${elsewhere}, outside the folder you selected`);
    expect(ran.isError, said(ran)).toBeUndefined();
    expect(await readFile(join(elsewhere, "sub", "a.txt"), "utf8")).toBe(
      "from Blender",
    );
    expect(said(ran)).toContain(join("sub", "a.txt"));
    expect(
      await readdir(join(scenes.directory("first"), "staging"), {
        recursive: true,
      }).catch(() => []),
    ).toEqual([]);
  });

  it("does not move what a script made to a place held from scripts for the run, and says so", async () => {
    const { studio, elsewhere } = await outside(
      async (request) => {
        if (request.op === "script") {
          const [given] = request.args["outside"] as {
            folder: string;
            staging: string;
          }[];
          await mkdir(join(given!.staging, ".git", "hooks"), {
            recursive: true,
          });
          await writeFile(
            join(given!.staging, ".git", "hooks", "pre-commit"),
            "a hook",
          );
          await writeFile(join(given!.staging, "fine.txt"), "fine");
        }
        return { ok: true, text: `did ${request.op}` };
      },
      // As Git's folder is held for the run.
      async (path) => path.split(/[\\/]/).includes(".git"),
    );
    await mkdir(join(elsewhere, ".git"));

    const ran = await call(studio, "blender_run_script", {
      code: "print(1)",
      outside_folders: [elsewhere],
    });

    expect(await readFile(join(elsewhere, "fine.txt"), "utf8")).toBe("fine");
    expect(await readdir(join(elsewhere, ".git"))).toEqual([]);
    expect(said(ran)).toContain("may only be read for this run");
  });

  it("may name a file it could not copy in its outside folder by its whole path, which is then changed for good", async () => {
    const { studio, elsewhere } = await outside();
    const big = join(elsewhere, "huge.exr");

    expect(
      await studio.inspect("blender_run_script", {
        code: "print(1)",
        outside_folders: [elsewhere],
        change_locked: [big],
      }),
    ).toMatchObject({
      ok: true,
      effects: { changes: "workspace-for-good" },
      changesAnyFile: { writable: [big], outside: [elsewhere] },
    });
  });

  it("refuses a script's outside folder that is Zhiyin's own before Blender is asked", async () => {
    const { studio, own, blender } = await outside();
    const sent = blender.requests.length;

    expect(
      await studio.inspect("blender_run_script", {
        code: "print(1)",
        outside_folders: [own],
      }),
    ).toMatchObject({ ok: false });
    expect(blender.requests.length).toBe(sent);
  });
});

describe("what a call declares it does", () => {
  const nothing = {
    reads: "none",
    changes: "none",
    sends: "none",
    actsAsPerson: "none",
    runs: "none",
    lasting: false,
    brings: "none",
  } as const;
  /** Blender working on the scene open, which changes it and what it writes, all kept to put back. */
  const typedChange = {
    ...nothing,
    reads: "workspace",
    changes: "workspace",
    runs: "sealed",
  } as const;

  async function withScene() {
    const own = await realpath(await folders.make("zhiyin-studio-own-"));
    const set = await setUp(undefined, { protect: [own] });
    const studio = set.tools();
    await call(studio, "blender_open_scene", {
      path: "scene.blend",
      create: true,
    });
    const effectsOf = async (name: string, args: Record<string, unknown>) => {
      const inspected = await studio.inspect(name, args);
      return inspected.ok ? inspected.effects : inspected.reason;
    };
    return { ...set, studio, effectsOf };
  }

  it("opening a scene reads it from the workspace; creating one changes the workspace by the new file", async () => {
    const { effectsOf, workspace } = await withScene();
    await writeFile(join(workspace, "kept.blend"), "a scene");

    expect(
      await effectsOf("blender_open_scene", { path: "kept.blend" }),
    ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      await effectsOf("blender_open_scene", {
        path: "new.blend",
        create: true,
      }),
    ).toEqual(typedChange);
  });

  it("looking at the scene reads the workspace and changes nothing", async () => {
    const { effectsOf } = await withScene();

    for (const [name, args] of [
      ["blender_describe_scene", {}],
      ["blender_frame_sheet", { start: 0, every_ms: 250, count: 8 }],
      ["blender_close_ups", { objects: ["Can"] }],
    ] as const)
      expect(await effectsOf(name, args), name).toEqual({
        ...nothing,
        reads: "workspace",
      });
  });

  it("looking up Blender's API reads only the Blender Zhiyin installed", async () => {
    const { effectsOf } = await withScene();

    expect(await effectsOf("blender_api", { name: "Object" })).toEqual({
      ...nothing,
      reads: "app",
    });
  });

  it("a typed change runs sealed and changes the workspace by what it declares, kept to put back", async () => {
    const { effectsOf } = await withScene();

    for (const [name, args] of [
      ["blender_add_objects", { objects: [can] }],
      [
        "blender_edit_objects",
        { edits: [{ object: "Can", location: [0, 0, 1] }] },
      ],
      [
        "blender_set_material",
        { objects: ["Can"], material: { color: "#c0392b" } },
      ],
      ["blender_set_camera", { view: "front" }],
      ["blender_set_lighting", { preset: "studio" }],
      ["blender_render", { output: "renders/hero.png" }],
      ["blender_render_video", { output: "renders/turn.mp4" }],
      ["blender_export", { output: "parts/can.stl" }],
    ] as const)
      expect(await effectsOf(name, args), name).toEqual(typedChange);
  });

  it("a render, video or export to a file outside the workspace changes elsewhere", async () => {
    const { effectsOf } = await withScene();
    const elsewhere = await realpath(
      await folders.make("zhiyin-studio-elsewhere-"),
    );

    for (const [name, file] of [
      ["blender_render", "hero.png"],
      ["blender_render_video", "turn.mp4"],
      ["blender_export", "can.stl"],
    ] as const)
      expect(
        await effectsOf(name, { output: join(elsewhere, file) }),
        name,
      ).toEqual({ ...typedChange, changes: "elsewhere" });
  });

  it("a script runs sealed and can change any file in the workspace, which is copied first to put back", async () => {
    const { effectsOf } = await withScene();

    expect(
      await effectsOf("blender_run_script", { code: "import bpy" }),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace",
      runs: "sealed",
    });
  });

  it("a script that writes outside the workspace reads and changes elsewhere", async () => {
    const { effectsOf } = await withScene();
    const elsewhere = await realpath(
      await folders.make("zhiyin-studio-elsewhere-"),
    );

    expect(
      await effectsOf("blender_run_script", {
        code: "import bpy",
        outside_folders: [elsewhere],
      }),
    ).toEqual({
      ...nothing,
      reads: "elsewhere",
      changes: "elsewhere",
      runs: "sealed",
    });
  });

  it("a script let change a file Zhiyin could not copy changes the workspace for good, naming the file", async () => {
    const { effectsOf, studio } = await withScene();
    const call = { code: "import bpy", change_locked: ["renders/huge.exr"] };

    expect(await effectsOf("blender_run_script", call)).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace-for-good",
      runs: "sealed",
    });
    expect(await studio.inspect("blender_run_script", call)).toMatchObject({
      ok: true,
      detail: expect.stringContaining("renders/huge.exr"),
      changesAnyFile: { writable: ["renders/huge.exr"] },
    });
  });

  it("a script names the open scene as a file it always changes, since every script saves it", async () => {
    const { studio } = await withScene();

    expect(
      await studio.inspect("blender_run_script", { code: "import bpy" }),
    ).toMatchObject({
      ok: true,
      changesAnyFile: { saves: [expect.stringMatching(/.blend$/)] },
    });
  });
});
