/**
 * What the 3D studio knows beyond its tools, as the catalog reads it: its
 * own pages, the API changes since earlier Blenders, and Blender's API read
 * from the installed Blender once and kept (ADR 0024); and the answers that
 * point to them.
 */

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { ConversationScenes, sceneAutomation } from "../src/index.js";
import { standInBlender, type Behaviour } from "./stand-in-blender.js";

const folders = new TemporaryFolders();
const started: ConversationScenes[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((scenes) => scenes.closeAll()));
  await folders.removeAll();
});

/** What a Blender 5.2 gives when its API is read, cut down to two pages. */
const builtApi = JSON.stringify({
  version: "5.2.2 LTS",
  series: "5.2",
  pages: [
    {
      name: "bpy.types.Object",
      summary: "Object data-block defining an object in a scene",
      text: "bpy.types.Object, as Blender 5.2.2 LTS has it.\nProperties:\n- location (float[3]): Location of the object",
      terms: ["location"],
    },
    {
      name: "bpy.ops.mesh",
      summary: "Blender's mesh operators",
      text: "bpy.ops.mesh, as Blender 5.2.2 LTS has it.\n- bpy.ops.mesh.bevel(offset=0.0)",
      terms: ["bevel"],
    },
  ],
});

const readsApi: Behaviour = (request) =>
  request.op === "reference"
    ? { ok: true, text: builtApi }
    : { ok: true, text: `did ${request.op}` };

async function setUp(behaviour: Behaviour = readsApi) {
  const root = await realpath(await folders.make("zhiyin-knowledge-"));
  const workspace = join(root, "workspace");
  const data = join(root, "data");
  const executable = join(root, "blender.exe");
  await mkdir(workspace, { recursive: true });
  await writeFile(executable, "Blender 5.2.2");
  const blender = standInBlender(behaviour);
  const studio = () => {
    const scenes = new ConversationScenes({
      blender: async () => executable,
      directory: data,
      launch: blender.launch,
      script: "C:/Zhiyin/blender-session/start.py",
      startTimeoutMs: 500,
    });
    started.push(scenes);
    return scenes;
  };
  return { workspace, executable, blender, studio };
}

const ids = (entries: readonly { readonly id: string }[]) =>
  entries.map((entry) => entry.id);

describe("the 3D studio's knowledge", () => {
  it("lists its own pages, the API changes and one entry for Blender's API, without starting Blender", async () => {
    const { blender, studio } = await setUp();

    const entries = await studio().knowledge().entries();

    expect(ids(entries)).toEqual(
      expect.arrayContaining([
        "doc:3d-rendering/materials",
        "doc:3d-rendering/animation",
        "break:blender/5.2/slotted-actions",
        "doc:blender/api",
      ]),
    );
    expect(ids(entries).filter((id) => id.startsWith("doc:blender/"))).toEqual([
      "doc:blender/api",
    ]);
    expect(blender.launches).toHaveLength(0);
  });

  it("lists each function of the zhiyin library scripts reach, and opens it with its call, an example and what it reports", async () => {
    const { blender, studio } = await setUp();
    const knowledge = studio().knowledge();

    const entries = await knowledge.entries();
    const pick = await knowledge.page("function:3d-rendering/zhiyin.pick");

    expect(
      entries.filter((entry) => entry.kind === "function").map((e) => e.id),
    ).toEqual(
      expect.arrayContaining([
        "function:3d-rendering/zhiyin.pick",
        "function:3d-rendering/zhiyin.picked",
      ]),
    );
    expect(pick?.entry).toMatchObject({
      kind: "function",
      title: "zhiyin.pick",
      plugin: "3d-rendering",
    });
    expect(pick?.text).toContain("zhiyin.pick(obj, kind=");
    expect(pick?.text).toContain('zhiyin.pick("Jar", facing="+z"');
    expect(pick?.text).toContain("Reports:");
    expect(blender.launches).toHaveLength(0);
  });

  it("declares its toolkits and its API changes", async () => {
    const { studio } = await setUp();

    const knowledge = studio().knowledge();

    expect(knowledge.plugin).toBe("3d-rendering");
    expect(knowledge.toolkits.map((toolkit) => toolkit.id)).toEqual([
      "modelling",
      "surfacing",
      "light-and-camera",
      "motion",
      "scatter",
      "decals",
      "unwrap",
      "bake",
      "measure",
      "rig",
      "simulate",
      "output",
    ]);
    expect(knowledge.breaks.length).toBeGreaterThan(10);
  });

  it("opens its own pages and the API changes as written, without starting Blender", async () => {
    const { blender, studio } = await setUp();
    const knowledge = studio().knowledge();

    const materials = await knowledge.page("doc:3d-rendering/materials");
    const change = await knowledge.page("break:blender/5.2/slotted-actions");

    expect(materials?.text).toContain("heat-tinted-steel");
    expect(change?.entry.kind).toBe("break");
    expect(change?.text).toContain(
      "Written for an earlier Blender: obj.animation_data.action.fcurves",
    );
    expect(change?.text).toContain(
      "In Blender 5.2: from bpy_extras import anim_utils",
    );
    expect(change?.text).toContain("doc:blender/5.2/bpy_extras.anim_utils");
    expect(blender.launches).toHaveLength(0);
  });

  it("reads Blender's API the first time a page of it is opened, in a Blender of its own that ends once it has read it", async () => {
    const { blender, studio } = await setUp();
    const knowledge = studio().knowledge();

    const object = await knowledge.page("doc:blender/5.2/bpy.types.Object");
    const entries = await knowledge.entries();

    expect(object?.text).toContain("- location (float[3])");
    expect(object?.entry).toMatchObject({
      id: "doc:blender/5.2/bpy.types.Object",
      kind: "doc",
      plugin: "3d-rendering",
    });
    expect(blender.ops()).toEqual(["reference"]);
    expect(blender.ended).toEqual([true]);
    expect(ids(entries)).toEqual(
      expect.arrayContaining([
        "doc:blender/5.2",
        "doc:blender/5.2/bpy.types.Object",
        "doc:blender/5.2/bpy.ops.mesh",
      ]),
    );
    expect(ids(entries)).not.toContain("doc:blender/api");
  });

  it("opens the entry that reads the API as the index of what was read", async () => {
    const { studio } = await setUp();

    const index = await studio().knowledge().page("doc:blender/api");

    expect(index?.entry.id).toBe("doc:blender/5.2");
    expect(index?.text).toContain("Blender 5.2.2 LTS's Python API");
    expect(index?.text).toContain("doc:blender/5.2/<name>");
  });

  it("keeps what it read for the next run of the app, which lists and opens it without starting Blender", async () => {
    const { blender, studio } = await setUp();
    await studio().knowledge().page("doc:blender/5.2/bpy.types.Object");

    const later = studio().knowledge();
    const entries = await later.entries();
    const mesh = await later.page("doc:blender/5.2/bpy.ops.mesh");

    expect(ids(entries)).toContain("doc:blender/5.2/bpy.ops.mesh");
    expect(mesh?.text).toContain("bpy.ops.mesh.bevel(offset=0.0)");
    expect(blender.launches).toHaveLength(1);
  });

  it("reads the API again once Blender is updated", async () => {
    const { blender, executable, studio } = await setUp();
    const knowledge = studio().knowledge();
    await knowledge.page("doc:blender/5.2/bpy.types.Object");

    await writeFile(executable, "Blender 5.2.3, a little larger");
    const listed = await knowledge.entries();
    await knowledge.page("doc:blender/5.2/bpy.types.Object");

    expect(ids(listed).filter((id) => id.startsWith("doc:blender/"))).toEqual([
      "doc:blender/api",
    ]);
    expect(blender.ops()).toEqual(["reference", "reference"]);
  });

  it("reads the API once when two pages are opened at once", async () => {
    const { blender, studio } = await setUp();
    const knowledge = studio().knowledge();

    const [object, mesh] = await Promise.all([
      knowledge.page("doc:blender/5.2/bpy.types.Object"),
      knowledge.page("doc:blender/5.2/bpy.ops.mesh"),
    ]);

    expect(object?.text).toContain("location");
    expect(mesh?.text).toContain("bevel");
    expect(blender.ops()).toEqual(["reference"]);
  });

  it("says why when the API cannot be read, and tries again the next time", async () => {
    let fails = true;
    const { blender, studio } = await setUp((request) =>
      request.op === "reference" && fails
        ? { ok: false, error: "Blender ran out of memory." }
        : readsApi(request),
    );
    const knowledge = studio().knowledge();

    const failed = await knowledge.page("doc:blender/5.2/bpy.types.Object");
    fails = false;
    const read = await knowledge.page("doc:blender/5.2/bpy.types.Object");

    expect(failed?.text).toContain(
      "Blender's API reference could not be built: Blender ran out of memory.",
    );
    expect(read?.text).toContain("location");
    expect(blender.launches).toHaveLength(2);
  });

  it("knows no page it does not have", async () => {
    const { studio } = await setUp();
    const knowledge = studio().knowledge();

    expect(await knowledge.page("doc:3d-rendering/nothing")).toBeUndefined();
    expect(
      await knowledge.page("doc:blender/5.2/bpy.types.Nothing"),
    ).toBeUndefined();
  });
});

describe("a 3D tool's answer", () => {
  type Result = {
    isError?: boolean;
    content: { type: string; text?: string }[];
  };
  async function tools(script: (code: string) => Record<string, unknown>) {
    const set = await setUp((request) =>
      request.op === "script"
        ? script(String(request.args["code"]))
        : { ok: true, text: `did ${request.op}` },
    );
    const scenes = set.studio();
    const automation = sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => set.workspace,
      blender: async () => set.executable,
      directory: scenes.directory("first"),
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await automation.callTool(name, args)) as Result;
      return {
        ...result,
        said: result.content.map((c) => c.text ?? "").join("\n"),
      };
    };
    return { call };
  }

  it("to opening a scene names the skill that stages 3D work and the toolkits", async () => {
    const { call } = await tools(() => ({ ok: true, text: "" }));

    const opened = await call("blender_open_scene", {
      path: "scene.blend",
      create: true,
    });

    expect(opened.said).toContain(
      "The stages of 3D work and their checks: open skill:3d-rendering/scene-stages.",
    );
    expect(opened.said).toContain(
      "open toolkit:3d-rendering/modelling, toolkit:3d-rendering/surfacing, toolkit:3d-rendering/light-and-camera, toolkit:3d-rendering/motion, toolkit:3d-rendering/scatter, toolkit:3d-rendering/decals, toolkit:3d-rendering/unwrap, toolkit:3d-rendering/bake, toolkit:3d-rendering/measure, toolkit:3d-rendering/rig, toolkit:3d-rendering/simulate, toolkit:3d-rendering/output.",
    );
  });

  it("to a script that fails on what Blender 5.2 changed gives the new form and the pages to read", async () => {
    const { call } = await tools(() => ({
      ok: false,
      error:
        "AttributeError: 'Action' object has no attribute 'fcurves'\n  line 3: for curve in action.fcurves:",
    }));
    await call("blender_open_scene", { path: "scene.blend", create: true });

    const failed = await call("blender_run_script", {
      code: "action = bpy.data.actions[0]\nfor curve in action.fcurves:\n    pass",
    });

    expect(failed.isError).toBe(true);
    expect(failed.said).toContain(
      "AttributeError: 'Action' object has no attribute 'fcurves'",
    );
    expect(failed.said).toContain(
      "Blender 5.2 changed this. Instead of obj.animation_data.action.fcurves: from bpy_extras import anim_utils, then anim_utils.action_get_channelbag_for_slot(action, obj.animation_data.action_slot).fcurves",
    );
    expect(failed.said).toContain(
      "To read: open doc:blender/5.2/bpy_extras.anim_utils, doc:blender/5.2/bpy.types.ActionChannelbag, doc:blender/5.2/bpy.types.Action.",
    );
  });

  it("to a script whose error the session already answers with the new form adds only the pages to read", async () => {
    const { call } = await tools(() => ({
      ok: false,
      error:
        'TypeError: bpy_struct[key] = val: id properties not supported for this type\nIn Blender 5.2 a geometry-nodes modifier\'s inputs are not read or set by mod["Socket_1"]: set as mod.properties.inputs.Socket_1.value = …',
    }));
    await call("blender_open_scene", { path: "scene.blend", create: true });

    const failed = await call("blender_run_script", {
      code: 'mod["Socket_1"] = 0.02',
    });

    expect(failed.said).toContain(
      "To read: open doc:blender/5.2/bpy.types.NodesModifier.",
    );
    expect(failed.said).not.toContain("Blender 5.2 changed this.");
  });

  it("to a script that fails for any other reason says nothing of Blender 5.2", async () => {
    const { call } = await tools(() => ({
      ok: false,
      error: "NameError: name 'cube' is not defined",
    }));
    await call("blender_open_scene", { path: "scene.blend", create: true });

    const failed = await call("blender_run_script", {
      code: "cube.scale.x = 2",
    });

    expect(failed.said).toContain("NameError: name 'cube' is not defined");
    expect(failed.said).not.toContain("Blender 5.2");
    expect(failed.said).not.toContain("To read");
  });
});
