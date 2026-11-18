import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  ConversationScenes,
  sceneAutomation,
  sceneReviews,
} from "../src/index.js";
import { standInBlender } from "./stand-in-blender.js";

const folders = new TemporaryFolders();
const started: ConversationScenes[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((scenes) => scenes.closeAll()));
  await folders.removeAll();
});

type Sent = { readonly out: string };

/** A stand-in Blender whose every spec holds, and that names each command. */
async function setUp() {
  const root = await realpath(await folders.make("zhiyin-review-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const blender = standInBlender(async (request) => {
    const sent = request.args["spec"] as Sent | undefined;
    if (sent)
      await writeFile(
        sent.out,
        JSON.stringify({
          checked: [
            { id: "S1", holds: false, margin: -3, unit: "mm" },
            { id: "T2", holds: true, margin: 1, unit: "mm" },
          ],
        }),
      );
    return {
      ok: true,
      text: `did ${request.op}${request.args["shading"] ? ` ${String(request.args["shading"])}` : ""}`,
    };
  });
  const scenes = new ConversationScenes({
    blender: async () => "C:/Blender/blender.exe",
    directory: join(root, "data"),
    launch: blender.launch,
    script: "C:/Zhiyin/blender-session/start.py",
    startTimeoutMs: 500,
  });
  started.push(scenes);
  const tools = () =>
    sceneAutomation(scenes.scene("first"), {
      workspaceRoot: () => workspace,
      blender: async () => "C:/Blender/blender.exe",
      directory: scenes.directory("first"),
    });
  const studio = tools();
  const call = (name: string, args: Record<string, unknown>) =>
    studio.callTool(name, args);
  const spec = (value: unknown) =>
    writeFile(join(workspace, "requirements.json"), JSON.stringify(value));
  const reviews = sceneReviews({
    directory: (id) => scenes.directory(id),
    tools: () => tools(),
    open: async () => scenes.scene("first").sceneIn(workspace),
  });
  await call("blender_open_scene", { path: "mug.blend", create: true });
  return { call, spec, reviews, blender, workspace };
}

const body = {
  id: "S1",
  check: "size",
  part: "Body",
  range: [[80, 85], [80, 85], 95],
};
const handle = {
  id: "T2",
  says: "Handle 8 to 10 mm thick",
  check: "thickness",
  part: "Handle",
  range: [8, 10],
};
const add = {
  objects: [{ name: "Body", kind: "cube", size: [0.08, 0.08, 0.095] }],
};

describe("a scene handed to its reviewer", () => {
  it("is the spec as first written, what was removed since, the latest measures and the scene as it is now", async () => {
    const { call, spec, reviews } = await setUp();
    const before = new Date(Date.now() - 1000);
    await spec({ object: "mug", requirements: [body, handle] });
    await call("blender_add_objects", add);
    // The failing handle requirement is dropped, and the work changed again.
    await spec({ object: "mug", requirements: [body] });
    await call("blender_edit_objects", {
      objects: [{ name: "Body", location: [0, 0, 0.05] }],
    });

    const [material, ...more] = await reviews.changedSince(
      "first",
      before,
      true,
    );

    expect(more).toEqual([]);
    expect(material).toMatchObject({
      reviewer: "3d-rendering/scene-reviewer",
      subject: "the scene mug.blend",
    });
    expect(material?.brief).toContain(
      [
        "## Spec for mug",
        "",
        "Each requirement as first written in this conversation, with its latest measure:",
        '- S1 (size), fails, 3 mm short: {"part":"Body","range":[[80,85],[80,85],95]}',
        '- T2 (thickness), removed since: "Handle 8 to 10 mm thick" {"part":"Handle","range":[8,10]}',
      ].join("\n"),
    );
    expect(material?.brief).toContain(
      "## The scene as described now\n\ndid describe",
    );
    expect(material?.brief).toContain(
      "## Each object's mesh, as counted now\n\ndid look",
    );
  });

  it("names the spec and the scene by their paths from the workspace's top, as read_file takes them", async () => {
    const { call, spec, reviews, workspace } = await setUp();
    await mkdir(join(workspace, "writing_desk"));
    await call("blender_open_scene", {
      path: "writing_desk/scene.blend",
      create: true,
    });
    const before = new Date(Date.now() - 1000);
    // The spec at the workspace's top, not beside the scene in its folder.
    await spec({ object: "desk", requirements: [body] });
    await call("blender_add_objects", add);

    const [material] = await reviews.changedSince("first", before, true);

    expect(material?.subject).toBe("the scene writing_desk/scene.blend");
    expect(material?.brief).toContain(
      "The spec is requirements.json, at the workspace's top, and the scene is writing_desk/scene.blend, each a path from the workspace's top as read_file takes it. The scene is a Blender file that read_file and read_document cannot read; the 3D tools look at it.",
    );
  });

  it("names a spec beside its scene by its folder", async () => {
    const { call, reviews, workspace } = await setUp();
    await mkdir(join(workspace, "writing_desk"));
    await call("blender_open_scene", {
      path: "writing_desk/scene.blend",
      create: true,
    });
    const before = new Date(Date.now() - 1000);
    await writeFile(
      join(workspace, "writing_desk", "requirements.json"),
      JSON.stringify({ object: "desk", requirements: [body] }),
    );
    await call("blender_add_objects", add);

    const [material] = await reviews.changedSince("first", before, true);

    expect(material?.brief).toContain(
      "The spec is writing_desk/requirements.json, beside the scene, and the scene is writing_desk/scene.blend,",
    );
  });

  it("is looked at in each of the three shadings for a model that sees pictures, and once for its counts otherwise", async () => {
    const { call, spec, reviews, blender } = await setUp();
    const before = new Date(Date.now() - 1000);
    await spec({ requirements: [body] });
    await call("blender_add_objects", add);
    const looks = () =>
      blender.requests
        .filter((request) => request.op === "look")
        .map((request) => request.args["shading"]);

    const closeUps = () =>
      blender.requests
        .filter((request) => request.op === "closeups")
        .map((request) => request.args["main"]);

    const [seen] = await reviews.changedSince("first", before, true);
    expect(looks()).toEqual(["shaded", "wireframe", "faces"]);
    // Then the objects the scene is mostly about, up close, few enough to stay large.
    expect(closeUps()).toEqual([4]);
    expect(seen?.brief).toContain(
      "## The objects the scene is mostly about, up close\n\ndid closeups",
    );

    await reviews.changedSince("first", before, false);
    expect(looks().slice(3)).toEqual(["shaded"]);
    expect(closeUps()).toHaveLength(1);
  });

  it("has nothing to hand over when nothing changed since, or the scene has no spec", async () => {
    const { call, spec, reviews } = await setUp();
    await call("blender_add_objects", add);
    expect(await reviews.changedSince("first", new Date(0), true)).toEqual([]);
    expect(await reviews.hasChangedSince("first", new Date(0))).toBe(false);

    await spec({ requirements: [body] });
    await call("blender_add_objects", add);
    const after = new Date(Date.now() + 1000);
    expect(await reviews.changedSince("first", after, true)).toEqual([]);
    expect(await reviews.hasChangedSince("first", after)).toBe(false);
    // Changed since a moment before, so a review will come.
    expect(await reviews.hasChangedSince("first", new Date(0))).toBe(true);
  });
});
