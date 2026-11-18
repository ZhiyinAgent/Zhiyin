import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionDetail } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { ConversationScenes, sceneAutomation } from "../src/index.js";
import { standInBlender } from "./stand-in-blender.js";

const folders = new TemporaryFolders();
const started: ConversationScenes[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((scenes) => scenes.closeAll()));
  await folders.removeAll();
});

type Sent = {
  readonly requirements: readonly { id: string; check: string }[];
  readonly out: string;
  readonly blockout?: string;
};
type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};

/**
 * A stand-in Blender that measures the spec it is sent as `measure` says,
 * writing the verdicts where it is told, and the block-out picture when
 * `blockout` says every size holds.
 */
async function setUp(
  measure: (sent: Sent) => unknown,
  blockout: () => boolean = () => false,
) {
  const root = await realpath(await folders.make("zhiyin-spec-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const blender = standInBlender(async (request) => {
    const sent = request.args["spec"] as Sent | undefined;
    if (sent) {
      await writeFile(sent.out, JSON.stringify(measure(sent)));
      if (sent.blockout && blockout())
        await writeFile(sent.blockout, "a small picture");
    }
    return { ok: true, text: `did ${request.op}` };
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
  const call = async (
    name: string,
    args: Record<string, unknown>,
    on = studio,
  ) => {
    const result = (await on.callTool(name, args)) as Result;
    const details = on.describeResult(name, args, {
      ok: true,
      value: result,
    }) as readonly ActionDetail[];
    return {
      result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
      image: result.content.find((c) => c.type === "image"),
      card: details.find((one) => one.kind === "checks"),
    };
  };
  const spec = (value: unknown, where = "requirements.json") =>
    writeFile(join(workspace, where), JSON.stringify(value));
  /** The spec each tool's command was sent, previews left out. */
  const sentSpecs = () =>
    blender.requests
      .filter((r) => r.op !== "preview")
      .map((r) => r.args["spec"] as Sent | undefined);
  await call("blender_open_scene", { path: "mug.blend", create: true });
  return { workspace, call, spec, sentSpecs, tools };
}

const mug = {
  object: "mug, 11 oz",
  requirements: [
    { id: "S1", check: "size", part: "Body", range: [[80, 85], [80, 85], 95] },
    {
      id: "T2",
      says: "Handle 8 to 10 mm thick",
      check: "thickness",
      part: "Handle",
      range: [8, 10],
    },
    { id: "H1", check: "hole", part: "Body", diameter: 6, tolerance: 0.1 },
  ],
};
const add = {
  objects: [{ name: "Body", kind: "cube", size: [0.08, 0.08, 0.095] }],
};

/** The handle as thick as `thick` mm, measured against 8 to 10 mm. */
const handle = (thick: number) => ({
  checked: [
    {
      id: "S1",
      holds: true,
      measured: "Body is 82 × 82 × 95 mm",
      margin: 2,
      unit: "mm",
    },
    {
      id: "T2",
      holds: thick <= 10,
      measured: `Handle is ${thick} mm thick`,
      margin: Math.min(thick - 8, 10 - thick),
      unit: "mm",
    },
  ],
});

describe("a scene measured against its spec", () => {
  it("answers a change with how many hold and only what does not, and shows the person every verdict", async () => {
    const { call, spec, sentSpecs } = await setUp(() => handle(20));
    await spec(mug);

    const changed = await call("blender_add_objects", add);

    expect(changed.result.isError).toBeUndefined();
    expect(changed.said).toContain("did add");
    expect(changed.said).toContain(
      [
        "Spec for mug, 11 oz: 1 of 2 checked holds, 1 not checked.",
        "- T2 (Handle 8 to 10 mm thick) fails: Handle is 20 mm thick; 10 mm past the limit.",
        "- H1 not checked: a hole requirement is measured in the CAD studio.",
      ].join("\n"),
    );
    expect(changed.said).not.toContain("S1");
    // Blender measures only what the 3D studio measures.
    expect(
      sentSpecs()
        .at(-1)
        ?.requirements.map((one) => one.id),
    ).toEqual(["S1", "T2"]);
    expect(changed.card).toEqual({
      kind: "checks",
      label: "Spec for mug, 11 oz",
      items: [
        {
          label: "S1",
          holds: true,
          note: "Body is 82 × 82 × 95 mm; 2 mm to spare",
        },
        {
          label: "T2 · Handle 8 to 10 mm thick",
          holds: false,
          note: "Handle is 20 mm thick; 10 mm past the limit",
        },
        {
          label: "H1",
          holds: null,
          note: "a hole requirement is measured in the CAD studio",
        },
      ],
    });
  });

  it("says how a margin moved since the last change, kept with the conversation for a studio started again", async () => {
    let thick = 20;
    const { call, spec, tools } = await setUp(() => handle(thick));
    await spec(mug);
    await call("blender_add_objects", add);

    thick = 12;
    const again = await call(
      "blender_edit_objects",
      {
        edits: [{ object: "Body", location: [0, 0, 0] }],
      },
      tools(),
    );

    expect(again.said).toContain(
      "- T2 (Handle 8 to 10 mm thick) fails, its margin up from -10 to -2 mm since the last change: Handle is 12 mm thick; 2 mm past the limit.",
    );
  });

  it("names once a requirement that failed and has left the spec", async () => {
    const { call, spec } = await setUp((sent) => ({
      checked: handle(20).checked.filter((one) =>
        sent.requirements.some((asked) => asked.id === one.id),
      ),
    }));
    await spec(mug);
    await call("blender_add_objects", add);
    await spec({ ...mug, requirements: mug.requirements.slice(0, 1) });

    const removed = await call("blender_edit_objects", {
      edits: [{ object: "Body", location: [0, 0, 0] }],
    });
    const after = await call("blender_edit_objects", {
      edits: [{ object: "Body", location: [0, 0, 0.01] }],
    });

    expect(removed.said).toContain(
      "T2 (Handle 8 to 10 mm thick) failed in the last change, 10 mm past its limit, and is no longer in requirements.json.",
    );
    expect(removed.card).toMatchObject({
      note: expect.stringContaining("T2 (Handle 8 to 10 mm thick) failed"),
    });
    expect(after.said).not.toContain("T2");
  });

  it("goes ahead with a change when the spec cannot be read, saying why", async () => {
    const { call, spec, sentSpecs } = await setUp(() => handle(10));
    await spec({
      requirements: [{ id: "T1", check: "thickness", part: "Handle" }],
    });

    const changed = await call("blender_add_objects", add);

    expect(changed.result.isError).toBeUndefined();
    expect(changed.said).toContain("did add");
    expect(changed.said).toContain(
      "No spec check was made: requirements.json: T1: a thickness check needs range. Fix the file, and the next change checks it.",
    );
    expect(sentSpecs().at(-1)).toBeUndefined();
    expect(changed.card).toEqual({
      kind: "checks",
      label: "Spec in requirements.json",
      items: [
        {
          label: "requirements.json",
          holds: null,
          note: "requirements.json: T1: a thickness check needs range.",
        },
      ],
    });
  });

  it("says when Blender could not measure the spec, and the change stands", async () => {
    const { call, spec } = await setUp(() => ({
      error: "MemoryError: out of memory",
    }));
    await spec(mug);

    const changed = await call("blender_add_objects", add);

    expect(changed.result.isError).toBeUndefined();
    expect(changed.said).toContain(
      "The spec in requirements.json could not be measured: MemoryError: out of memory.",
    );
  });

  it("shows the block-out the first time every size holds, and never again", async () => {
    const { call, spec, sentSpecs } = await setUp(
      () => handle(10),
      () => true,
    );
    await spec(mug);

    const first = await call("blender_add_objects", add);
    const second = await call("blender_edit_objects", {
      edits: [{ object: "Body", location: [0, 0, 0] }],
    });

    expect(first.image).toMatchObject({ type: "image" });
    expect(first.said).toContain(
      "Every size in the spec holds, so the person is shown this block-out and may step in to change its proportions; carry on unless they do.",
    );
    expect(first.card).toMatchObject({
      note: "Every size in the spec holds: below is the block-out, while changes are still cheap. Step in now to change its proportions; the work goes on unless you do.",
    });
    expect(second.image).toBeUndefined();
    expect(second.said).not.toContain("block-out");
    expect(sentSpecs().at(-1)?.blockout).toBeUndefined();
  });

  it("offers the block-out only after a change, not when the scene is described", async () => {
    const { call, spec, sentSpecs } = await setUp(
      () => handle(10),
      () => true,
    );
    await spec(mug);

    const described = await call("blender_describe_scene", {});

    expect(described.said).toContain(
      "Spec for mug, 11 oz: 2 of 2 checked hold",
    );
    expect(sentSpecs().at(-1)?.blockout).toBeUndefined();
    expect(described.said).not.toContain("block-out");
  });

  it("reads the spec beside the scene before the one at the workspace's top", async () => {
    const { call, spec, workspace } = await setUp(() => handle(10));
    await mkdir(join(workspace, "mugs"));
    await spec(mug);
    await spec({ ...mug, object: "espresso cup" }, "mugs/requirements.json");
    await call("blender_open_scene", { path: "mugs/cup.blend", create: true });

    const changed = await call("blender_add_objects", add);

    expect(changed.said).toContain("Spec for espresso cup:");
  });

  it("measures nothing and says nothing of a spec when there is none", async () => {
    const { call, sentSpecs } = await setUp(() => handle(10));

    const changed = await call("blender_add_objects", add);

    expect(changed.said).not.toContain("Spec");
    expect(changed.card).toBeUndefined();
    expect(sentSpecs().every((one) => one === undefined)).toBe(true);
  });
});
