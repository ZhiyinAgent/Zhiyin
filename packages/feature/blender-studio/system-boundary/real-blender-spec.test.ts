/**
 * A scene measured against its spec by a real Blender: the mug from the 3D
 * overhaul, a handle 20 mm thick against one 10 mm thick, joined to the body
 * and below its rim; each of the 3D kinds with a requirement that holds and
 * one that fails; a spec that cannot be read; and a requirement removed.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-spec.test.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionDetail } from "@zhiyin/contract";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
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
type Item = { label: string; holds: boolean | null; note?: string };

/** A D-shaped handle of a radius in metres, its ends in the body's wall, its top 12 mm below the rim. */
const handle = (radius: number, shift = 0) => ({
  name: "Handle",
  kind: "tube",
  radius,
  points: [
    [0.039 + shift, 0, 0.072],
    [0.068 + shift, 0, 0.076],
    [0.076 + shift, 0, 0.05],
    [0.068 + shift, 0, 0.024],
    [0.039 + shift, 0, 0.028],
  ],
});

/** The mug from the overhaul, measured against a standard 11 oz mug. */
const mugSpec = {
  object: "mug, 11 oz",
  requirements: [
    { id: "S1", check: "size", part: "Body", range: [[80, 85], [80, 85], 95] },
    { id: "T1", check: "thickness", part: "Body", range: [4, 5] },
    { id: "T2", check: "thickness", part: "Handle", range: [8, 10] },
    { id: "R1", check: "reach", part: "Handle", from: "Body", range: [35, 45] },
    {
      id: "B1",
      check: "below",
      part: "Handle",
      other: "Body",
      sides: ["top", "top"],
      by: [10, 15],
    },
    { id: "J1", check: "joined", parts: ["Handle", "Body"] },
    { id: "F1", check: "rests_on", part: "Body" },
  ],
};

describe.runIf(blender)(
  "a real Blender, measuring a scene against its spec",
  () => {
    const folders = new TemporaryFolders();
    let workspace: string;
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await tools.callTool(name, args)) as Result;
      const details = tools.describeResult(name, args, {
        ok: true,
        value: result,
      }) as readonly ActionDetail[];
      const card = details.find((one) => one.kind === "checks");
      const items =
        card?.kind === "checks" ? (card.items as readonly Item[]) : [];
      return {
        ...result,
        said: result.content.map((c) => c.text ?? "").join("\n"),
        image: result.content.find((c) => c.type === "image"),
        card,
        verdict: (id: string) =>
          items.find(
            (one) => one.label === id || one.label.startsWith(`${id} ·`),
          ),
      };
    };
    const spec = (value: unknown) =>
      writeFile(join(workspace, "requirements.json"), JSON.stringify(value));
    const remake = async (objects: Record<string, unknown>[]) => {
      const names = objects.map((one) => one["name"] as string);
      await call("blender_run_script", {
        code: [
          "import bpy",
          `for name in ${JSON.stringify(names)}:`,
          "    if name in bpy.data.objects:",
          "        bpy.data.objects.remove(bpy.data.objects[name])",
        ].join("\n"),
      });
      return call("blender_add_objects", { objects });
    };

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-spec-");
      workspace = join(root, "workspace");
      await mkdir(workspace, { recursive: true });
      scenes = new ConversationScenes({
        blender: async () => blender,
        directory: join(root, "data"),
        launch: withKeptGlCache(containedSessionLaunch)(
          { open: openProcessContainer },
          { scripts: join(root, "session-scripts") },
        ),
        script: sessionScript,
      });
      tools = sceneAutomation(scenes.scene("spec"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("spec"),
      });
      await call("blender_open_scene", { path: "mug.blend", create: true });
      // An 11 oz mug's body, 82 mm across and 95 high with 4 mm walls and a
      // 6 mm floor, turned round its axis.
      const added = await call("blender_add_objects", {
        objects: [
          {
            name: "Body",
            kind: "revolve",
            profile: [
              [0, 0],
              [0.041, 0],
              [0.041, 0.095],
              [0.037, 0.095],
              [0.037, 0.006],
              [0, 0.006],
            ],
          },
        ],
      });
      expect(added.isError, added.said).toBeUndefined();
    }, 180_000);

    afterAll(async () => {
      await scenes.forget("spec");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("shows the block-out once, the first time every size holds", async () => {
      await spec(mugSpec);

      const first = await call("blender_edit_objects", {
        edits: [{ object: "Body", location: [0, 0, 0] }],
      });
      const second = await call("blender_edit_objects", {
        edits: [{ object: "Body", location: [0, 0, 0] }],
      });

      expect(first.verdict("S1")?.holds).toBe(true);
      expect(first.image?.data?.length).toBeGreaterThan(1000);
      expect(first.said).toContain(
        "Every size in the spec holds, so the person is shown this block-out",
      );
      expect(second.image).toBeUndefined();
    }, 120_000);

    it("fails a handle 20 mm thick by 10 mm, and holds one 10 mm thick, joined and below the rim", async () => {
      await spec(mugSpec);

      const thick = await remake([handle(0.01)]);

      expect(thick.isError, thick.said).toBeUndefined();
      expect(thick.said).toMatch(/Spec for mug, 11 oz: \d of 7 checked hold\./);
      expect(thick.said).toMatch(
        /- T2 fails: Handle is (19\.\d+|20) mm thick, from [\d.]+ to [\d.]+ over most of it, where 8 to 10 mm is asked; (9\.\d+|10) mm past the limit\./,
      );
      expect(thick.verdict("T2")?.holds).toBe(false);

      const right = await remake([handle(0.005)]);

      expect(right.said).toMatch(/Spec for mug, 11 oz: 7 of 7 checked hold\./);
      expect(right.said).not.toContain("T2");
      for (const id of ["S1", "T1", "T2", "R1", "B1", "J1", "F1"])
        expect(
          right.verdict(id)?.holds,
          `${id}: ${right.verdict(id)?.note}`,
        ).toBe(true);
      expect(right.verdict("S1")?.note).toMatch(/^Body is 82 × 82 × 95 mm/);
      expect(right.verdict("B1")?.note).toMatch(
        /^Handle's top is 1[0-4](\.\d+)? mm below Body's top/,
      );
      expect(right.verdict("J1")?.note).toBe(
        "Handle and Body hold together as one piece",
      );
      expect(right.verdict("F1")?.note).toMatch(
        /^Body's bottom is on the ground/,
      );
    }, 120_000);

    it("fails a handle that does not reach the body as two pieces apart", async () => {
      await spec(mugSpec);

      const apart = await remake([handle(0.005, 0.01)]);

      expect(apart.verdict("J1")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Handle and Body are in 2 pieces that do not touch: (Handle; Body|Body; Handle); [\d.]+ mm past the limit$/,
        ),
      });
      const back = await remake([handle(0.005)]);
      expect(back.isError, back.said).toBeUndefined();
    }, 120_000);

    it("measures each 3D kind, holding on a scene that meets it and failing on one that does not", async () => {
      const made = await call("blender_run_script", {
        code: [
          "import bpy, mathutils",
          "s = bpy.context.scene",
          "def box(name, size, at):",
          "    bpy.ops.mesh.primitive_cube_add(size=1, location=at)",
          "    o = bpy.context.object",
          "    o.name = name",
          "    o.scale = size",
          "    bpy.ops.object.transform_apply(scale=True)",
          "    return o",
          "box('Table', (0.4, 0.4, 0.02), (0.5, 0, 0.01))",
          "box('Book', (0.1, 0.15, 0.03), (0.45, 0, 0.035))",
          "box('Lamp', (0.05, 0.05, 0.1), (0.6, 0.1, 0.082))",
          "box('Spoon', (0.1, 0.01, 0.005), (0.04, 0, 0.06))",
          "for i in range(3):",
          "    box(f'Chair_{i}', (0.05, 0.05, 0.05), (1.0 + i * 0.1, 0, 0.025))",
          "bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.07, location=(0, 0, 0.041))",
          "bpy.context.object.name = 'Coffee'",
          "bpy.ops.mesh.primitive_cylinder_add(radius=0.004, depth=0.14, location=(0.02, 0, 0.08))",
          "bpy.context.object.name = 'Straw'",
          "cam = bpy.data.objects.new('Shot', bpy.data.cameras.new('Shot'))",
          "s.collection.objects.link(cam)",
          "cam.location = (0, -0.6, 0.05)",
          "cam.rotation_euler = (1.5708, 0, 0)",
          "s.camera = cam",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      await spec({
        requirements: [
          {
            id: "FI1",
            check: "fits",
            parts: ["Body", "Handle"],
            box: [140, 90, 100],
          },
          { id: "FI2", check: "fits", parts: ["Body"], box: [80, 80, 80] },
          { id: "W1", check: "wall", part: "Body", min: 3.9 },
          { id: "W2", check: "wall", part: "Body", min: 5 },
          { id: "WI1", check: "width", part: "Handle", range: [8, 12] },
          { id: "WI2", check: "width", part: "Handle", range: [12, 16] },
          {
            id: "R2",
            check: "reach",
            part: "Handle",
            from: "Body",
            range: [60, 70],
          },
          { id: "O1", check: "rests_on", part: "Book", on: "Table" },
          { id: "O2", check: "rests_on", part: "Lamp", on: "Table" },
          {
            id: "A1",
            check: "above",
            part: "Lamp",
            other: "Table",
            by: [10, 15],
          },
          {
            id: "A2",
            check: "above",
            part: "Book",
            other: "Table",
            by: [10, 15],
          },
          {
            id: "BE2",
            check: "below",
            part: "Handle",
            other: "Body",
            sides: ["top", "top"],
            by: [20, 30],
          },
          { id: "I1", check: "inside", part: "Coffee", of: "Body" },
          { id: "I2", check: "inside", part: "Straw", of: "Body" },
          { id: "C1", check: "count", part: "/Chair_.*/", range: [3, 4] },
          { id: "C2", check: "count", part: "/Chair_.*/", range: [4, 6] },
          { id: "FA1", check: "faces", parts: ["/Chair_.*/"], max: 100 },
          { id: "FA2", check: "faces", parts: ["/Chair_.*/"], max: 10 },
          { id: "V1", check: "in_view", parts: ["Body", "Handle"] },
          { id: "V2", check: "in_view", parts: ["Table"], camera: "Shot" },
          { id: "SE1", check: "separate", parts: ["Coffee", "Body"] },
          { id: "SE2", check: "separate", parts: ["Spoon", "Body"] },
          { id: "CL1", check: "clearance", between: ["Book", "Lamp"], min: 5 },
          {
            id: "CL2",
            check: "clearance",
            between: ["Book", "Lamp"],
            min: 100,
          },
          { id: "J2", check: "joined", parts: ["Book", "Table"] },
          { id: "J3", check: "joined", parts: ["Lamp", "Table"] },
        ],
      });

      const measured = await call("blender_describe_scene", {});

      expect(measured.isError, measured.said).toBeUndefined();
      const holding = [
        "FI1",
        "W1",
        "WI1",
        "O1",
        "A1",
        "I1",
        "C1",
        "FA1",
        "V1",
        "SE1",
        "CL1",
        "J2",
      ];
      const failing = [
        "FI2",
        "W2",
        "WI2",
        "R2",
        "O2",
        "A2",
        "BE2",
        "I2",
        "C2",
        "FA2",
        "V2",
        "SE2",
        "CL2",
        "J3",
      ];
      for (const id of holding)
        expect(
          measured.verdict(id)?.holds,
          `${id}: ${measured.verdict(id)?.note}`,
        ).toBe(true);
      for (const id of failing)
        expect(
          measured.verdict(id)?.holds,
          `${id}: ${measured.verdict(id)?.note}`,
        ).toBe(false);
      expect(measured.said).toContain(
        "Spec in requirements.json: 12 of 26 checked hold.",
      );
      expect(measured.verdict("O2")?.note).toMatch(
        /^Lamp's bottom is 12 mm above Table/,
      );
      expect(measured.verdict("I2")?.note).toMatch(
        /^Straw is partly outside Body: its farthest point out, at \([-\d., ]+\) mm, is 5\d(\.\d+)? mm from Body's surface/,
      );
      expect(measured.verdict("C2")?.note).toBe(
        "3 objects drawn match /Chair_.*/, where 4 to 6 are asked",
      );
      expect(measured.verdict("FA2")?.note).toMatch(
        /^\/Chair_\.\*\/ draw 18 faces, where at most 10 are asked; 8 faces past the limit$/,
      );
      expect(measured.verdict("V2")?.note).toMatch(
        /^Table reaches [\d.]+% of the frame past its right edge/,
      );
      expect(measured.verdict("SE2")?.note).toMatch(
        /^Spoon goes [\d.]+ mm into Body/,
      );
    }, 120_000);

    it("goes ahead with a change when the spec cannot be read, and names a failing requirement once taken out", async () => {
      await spec({
        requirements: [{ id: "T1", check: "thickness", part: "Body" }],
      });
      const unread = await call("blender_edit_objects", {
        edits: [{ object: "Coffee", location: [0, 0, 0.042] }],
      });
      expect(unread.isError, unread.said).toBeUndefined();
      expect(unread.said).toContain(
        "No spec check was made: requirements.json: T1: a thickness check needs range.",
      );

      await spec({
        requirements: [
          { id: "S1", check: "size", part: "Body", range: [null, null, 95] },
          {
            id: "T9",
            says: "Body walls 6 mm",
            check: "thickness",
            part: "Body",
            range: [6, 7],
          },
        ],
      });
      const failing = await call("blender_edit_objects", {
        edits: [{ object: "Coffee", location: [0, 0, 0.041] }],
      });
      expect(failing.said).toMatch(
        /- T9 \(Body walls 6 mm\) fails: Body is 4 mm thick/,
      );
      await spec({
        requirements: [
          { id: "S1", check: "size", part: "Body", range: [null, null, 95] },
        ],
      });

      const removed = await call("blender_edit_objects", {
        edits: [{ object: "Coffee", location: [0, 0, 0.042] }],
      });

      expect(removed.said).toMatch(
        /T9 \(Body walls 6 mm\) failed in the last change, 2(\.\d+)? mm past its limit, and is no longer in requirements\.json\./,
      );
    }, 120_000);

    it("counts an L-shaped room's notch as outside it, and a part in the room as inside", async () => {
      const l = [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2],
      ];
      const inner = [
        [0.05, 0.05],
        [1.95, 0.05],
        [1.95, 0.95],
        [0.95, 0.95],
        [0.95, 1.95],
        [0.05, 1.95],
      ];
      await call("blender_add_objects", {
        objects: [
          {
            name: "Room",
            kind: "outline",
            points: l,
            holes: [inner],
            height: 0.3,
            location: [3, 0, 0],
          },
          {
            name: "RoomFloor",
            kind: "outline",
            points: l,
            height: 0.02,
            location: [3, 0, 0],
          },
          {
            name: "Sofa",
            kind: "cube",
            size: [0.4, 0.4, 0.2],
            location: [3.5, 0.5, 0.15],
          },
          {
            name: "Plant",
            kind: "cube",
            size: [0.2, 0.2, 0.2],
            location: [4.5, 1.5, 0.15],
          },
        ],
      });
      // The floor and walls as one object, a room open at the top.
      const joined = await call("blender_run_script", {
        code: [
          "import bpy",
          "room, floor = bpy.data.objects['Room'], bpy.data.objects['RoomFloor']",
          "with bpy.context.temp_override(active_object=room, selected_editable_objects=[room, floor]):",
          "    bpy.ops.object.join()",
        ].join("\n"),
      });
      expect(joined.isError, joined.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "IN1", check: "inside", part: "Sofa", of: "Room" },
          { id: "IN2", check: "inside", part: "Plant", of: "Room" },
        ],
      });

      const measured = await call("blender_describe_scene", {});

      expect(measured.verdict("IN1")).toMatchObject({
        holds: true,
        note: expect.stringMatching(
          /^Sofa is inside Room, [\d.]+ mm within it at the nearest/,
        ),
      });
      expect(measured.verdict("IN2")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Plant is partly outside Room: its farthest point out, at \([-\d., ]+\) mm, is [\d.]+ mm from Room's surface/,
        ),
      });
    }, 120_000);

    it("counts the copies a collection places in count and faces", async () => {
      const made = await call("blender_run_script", {
        code: [
          "import bpy, bmesh",
          "rocks = bpy.data.collections.new('RockSet')",
          "mesh = bpy.data.meshes.new('Rock')",
          "b = bmesh.new()",
          "bmesh.ops.create_cube(b, size=0.05)",
          "b.to_mesh(mesh)",
          "b.free()",
          "rocks.objects.link(bpy.data.objects.new('Rock', mesh))",
          "for i in range(4):",
          "    e = bpy.data.objects.new(f'Rocks_{i}', None)",
          "    e.instance_type = 'COLLECTION'",
          "    e.instance_collection = rocks",
          "    e.location = (6 + i * 0.1, 0, 0.025)",
          "    bpy.context.scene.collection.objects.link(e)",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "N1", check: "count", part: "Rock", range: 4 },
          { id: "N2", check: "faces", parts: ["/Rocks_.*/"], max: 20 },
        ],
      });

      const measured = await call("blender_describe_scene", {});

      expect(measured.verdict("N1")).toMatchObject({
        holds: true,
        note: "4 objects drawn are named Rock, 4 of them instances, where 4 are asked",
      });
      expect(measured.verdict("N2")).toMatchObject({
        holds: false,
        note: "/Rocks_.*/ draw 24 faces, 24 of them in 4 instances, where at most 20 are asked; 4 faces past the limit",
      });
    }, 120_000);

    it("measures a mesh with half its faces turned inward as thick as one whose faces all point out", async () => {
      const made = await call("blender_run_script", {
        code: [
          "import bpy, bmesh",
          "body = bpy.data.objects['Body']",
          "turned = body.copy()",
          "turned.data = body.data.copy()",
          "turned.name = 'Turned'",
          "turned.location = (0, 0.3, 0)",
          "bpy.context.scene.collection.objects.link(turned)",
          "b = bmesh.new()",
          "b.from_mesh(turned.data)",
          "bmesh.ops.reverse_faces(b, faces=[f for f in b.faces if f.calc_center_median().x < 0])",
          "b.to_mesh(turned.data)",
          "b.free()",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "TT", check: "thickness", part: "Turned", range: [3.9, 5] },
          { id: "TW", check: "wall", part: "Turned", min: 3.9 },
        ],
      });

      const measured = await call("blender_describe_scene", {});

      expect(measured.verdict("TT")).toMatchObject({
        holds: true,
        note: expect.stringMatching(
          /^Turned is 4 mm thick, from [\d.]+ to [3-6](\.\d+)? over most of it/,
        ),
      });
      expect(measured.verdict("TW")?.holds, measured.verdict("TW")?.note).toBe(
        true,
      );
    }, 120_000);

    it("tells a part of a hundred pieces that touch from one with a gap", async () => {
      const made = await call("blender_run_script", {
        code: [
          "import bpy, bmesh, mathutils",
          "def beads(name, y, gap_after):",
          "    b = bmesh.new()",
          "    x = 0.0",
          "    for i in range(100):",
          "        bmesh.ops.create_cube(b, size=0.01, matrix=mathutils.Matrix.Translation((x, 0, 0)))",
          "        x += 0.01 + (0.005 if i == gap_after else 0)",
          "    mesh = bpy.data.meshes.new(name)",
          "    b.to_mesh(mesh)",
          "    b.free()",
          "    o = bpy.data.objects.new(name, mesh)",
          "    o.location = (0, y, 0.005)",
          "    bpy.context.scene.collection.objects.link(o)",
          "beads('Chain', 2, -1)",
          "beads('Broken', 2.1, 49)",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "JC", check: "joined", parts: ["Chain"] },
          { id: "JB", check: "joined", parts: ["Broken"] },
        ],
      });

      const measured = await call("blender_describe_scene", {});

      expect(measured.verdict("JC")).toMatchObject({
        holds: true,
        note: "Chain holds together as one piece",
      });
      expect(measured.verdict("JB")).toMatchObject({
        holds: false,
        note: "Broken is in 2 pieces that do not touch: Broken (50 pieces); Broken (50 pieces); 5 mm past the limit",
      });
    }, 120_000);

    it("rests a top on legs inset under it, a seat on its legs, a tray on two posts and a crate on slats, and says one raised or sunk", async () => {
      const legs = (
        name: string,
        size: number[],
        at: number[],
        spots: number[][],
      ) =>
        spots.map(([x, y], i) => ({
          name: `${name}_${i}`,
          kind: "cube",
          size,
          location: [at[0]! + x!, at[1]! + y!, size[2]! / 2],
        }));
      const added = await call("blender_add_objects", {
        objects: [
          {
            name: "Top",
            kind: "cube",
            size: [1.6, 0.9, 0.04],
            location: [20, 0, 0.73],
          },
          ...legs(
            "TLeg",
            [0.06, 0.06, 0.71],
            [20, 0],
            [
              [-0.72, -0.37],
              [0.72, -0.37],
              [-0.72, 0.37],
              [0.72, 0.37],
            ],
          ),
          {
            name: "Seat",
            kind: "cube",
            size: [0.45, 0.45, 0.04],
            location: [20, -1.5, 0.45],
          },
          ...legs(
            "SLeg",
            [0.035, 0.035, 0.43],
            [20, -1.5],
            [
              [-0.2, -0.2],
              [0.2, -0.2],
              [-0.2, 0.2],
              [0.2, 0.2],
            ],
          ),
          {
            name: "Tray",
            kind: "cube",
            size: [0.5, 0.3, 0.02],
            location: [22, 0, 0.31],
          },
          ...[-0.1, 0.1].map((x, i) => ({
            name: `Post_${i}`,
            kind: "cylinder",
            size: [0.05, 0.05, 0.3],
            location: [22 + x, 0, 0.15],
          })),
          {
            name: "Crate",
            kind: "cube",
            size: [0.6, 0.4, 0.4],
            location: [24, 0, 0.32],
          },
          ...legs(
            "Slat",
            [0.08, 0.3, 0.12],
            [24, 0],
            [
              [-0.2, 0],
              [0, 0],
              [0.2, 0],
            ],
          ),
        ],
      });
      expect(added.isError, added.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "R1", check: "rests_on", part: "Top", on: "/TLeg_.*/" },
          { id: "R2", check: "rests_on", part: "Seat", on: "/SLeg_.*/" },
          { id: "R3", check: "rests_on", part: "Tray", on: "/Post_.*/" },
          { id: "R4", check: "rests_on", part: "Crate", on: "/Slat_.*/" },
          { id: "R5", check: "rests_on", part: "TLeg_0" },
          { id: "R6", check: "rests_on", part: "Tray", on: "Crate" },
        ],
      });

      const sound = await call("blender_describe_scene", {
        objects: ["Top"],
      });

      for (const id of ["R1", "R2", "R3", "R4", "R5"])
        expect(
          sound.verdict(id)?.holds,
          `${id}: ${sound.verdict(id)?.note}`,
        ).toBe(true);
      expect(sound.verdict("R1")?.note).toBe(
        "Top's bottom is on /TLeg_.*/; 1 mm to spare",
      );
      expect(sound.verdict("R6")).toMatchObject({
        holds: false,
        note: "Tray is not over Crate",
      });

      const moved = await call("blender_edit_objects", {
        edits: [
          { object: "Seat", move_by: [0, 0, 0.01] },
          { object: "Top", move_by: [0, 0, -0.005] },
        ],
      });

      expect(moved.verdict("R2")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Seat's bottom is 10 mm above \/SLeg_\.\*\/, where it is to rest on it within 1 mm/,
        ),
      });
      expect(moved.verdict("R1")).toMatchObject({
        holds: false,
        note: expect.stringMatching(/^Top's bottom is 5 mm into \/TLeg_\.\*\//),
      });
    }, 120_000);

    it("measures how near two parts come surface to surface: crossed boards 10 mm apart, boards face to face, a shaft in its housing", async () => {
      const circle = (radius: number) =>
        Array.from({ length: 32 }, (_, i) => [
          radius * Math.cos((i * Math.PI) / 16),
          radius * Math.sin((i * Math.PI) / 16),
        ]);
      const added = await call("blender_add_objects", {
        objects: [
          {
            name: "Lower",
            kind: "cube",
            size: [1, 0.05, 0.05],
            location: [30, 0, 0.025],
          },
          {
            name: "Upper",
            kind: "cube",
            size: [0.05, 1, 0.05],
            location: [30, 0, 0.085],
          },
          {
            name: "Lower2",
            kind: "cube",
            size: [1, 0.05, 0.05],
            location: [32, 0, 0.025],
          },
          {
            name: "Upper2",
            kind: "cube",
            size: [0.05, 1, 0.05],
            location: [32, 0, 0.075],
          },
          {
            name: "Housing",
            kind: "outline",
            points: circle(0.02),
            holes: [circle(0.0105)],
            height: 0.03,
            location: [34, 0, 0],
          },
          {
            name: "Shaft",
            kind: "outline",
            points: circle(0.01),
            height: 0.1,
            location: [34, 0, 0],
          },
        ],
      });
      expect(added.isError, added.said).toBeUndefined();
      await spec({
        requirements: [
          {
            id: "G1",
            check: "clearance",
            between: ["Lower", "Upper"],
            min: 20,
          },
          { id: "G2", check: "clearance", between: ["Lower", "Upper"], min: 5 },
          { id: "G3", check: "joined", parts: ["Lower2", "Upper2"] },
          { id: "G4", check: "joined", parts: ["Lower", "Upper"] },
          {
            id: "G5",
            check: "clearance",
            between: ["Shaft", "Housing"],
            min: 0.4,
          },
        ],
      });

      const measured = await call("blender_describe_scene", {
        objects: ["Lower"],
      });

      expect(measured.verdict("G1")).toMatchObject({
        holds: false,
        note: "Lower comes 10 mm from Upper, where at least 20 mm is asked; 10 mm past the limit",
      });
      expect(measured.verdict("G2")?.holds).toBe(true);
      expect(measured.verdict("G3")).toMatchObject({
        holds: true,
        note: "Lower2 and Upper2 hold together as one piece",
      });
      expect(measured.verdict("G4")).toMatchObject({
        holds: false,
        note: "Lower and Upper are in 2 pieces that do not touch: Lower; Upper; 10 mm past the limit",
      });
      expect(measured.verdict("G5")).toMatchObject({
        holds: true,
        note: expect.stringMatching(
          /^Shaft comes 0\.(4[7-9]|5)\d* mm from Housing/,
        ),
      });
    }, 120_000);

    it("measures a part inside several parts together, as walls of one outline and a separate floor", async () => {
      const added = await call("blender_add_objects", {
        objects: [
          {
            name: "Walls",
            kind: "outline",
            points: [
              [-2, -1.5],
              [2, -1.5],
              [2, 1.5],
              [-2, 1.5],
            ],
            holes: [
              [
                [-1.9, -1.4],
                [1.9, -1.4],
                [1.9, 1.4],
                [-1.9, 1.4],
              ],
            ],
            height: 2.6,
            location: [40, 0, 0],
          },
          {
            name: "Floor",
            kind: "cube",
            size: [4, 3, 0.1],
            location: [40, 0, -0.05],
          },
          {
            name: "Couch",
            kind: "cube",
            size: [2, 0.9, 0.45],
            location: [40, 0.8, 0.225],
          },
          {
            name: "Outdoors",
            kind: "cube",
            size: [0.5, 0.5, 0.5],
            location: [44, 0, 0.25],
          },
        ],
      });
      expect(added.isError, added.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "U1", check: "inside", part: "Couch", of: ["Walls", "Floor"] },
          { id: "U2", check: "inside", part: "Couch", of: "/Walls|Floor/" },
          {
            id: "U3",
            check: "inside",
            part: "Outdoors",
            of: ["Walls", "Floor"],
          },
          { id: "U4", check: "inside", part: "Couch", of: "Walls" },
          {
            id: "U5",
            check: "below",
            part: "Couch",
            other: "Walls",
            sides: ["top", "top"],
            by: [2000, 2200],
          },
          { id: "U6", check: "rests_on", part: "Walls", on: "Floor" },
        ],
      });

      const measured = await call("blender_describe_scene", {
        objects: ["Couch"],
      });

      expect(measured.verdict("U1")).toMatchObject({
        holds: true,
        note: expect.stringMatching(
          /^Couch is inside Walls and Floor, [\d.]+ mm within them at the nearest/,
        ),
      });
      expect(measured.verdict("U2")?.holds, measured.verdict("U2")?.note).toBe(
        true,
      );
      expect(measured.verdict("U3")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Outdoors is partly outside Walls and Floor: its farthest point out, at \([-\d., ]+\) mm, is [\d.]+ mm from their surface/,
        ),
      });
      // Walls with no floor are open below, so nothing stands walled in by them.
      expect(measured.verdict("U4")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Couch is partly outside Walls: its farthest point out, at \([-\d., ]+\) mm, is [\d.]+ mm from Walls' surface/,
        ),
      });
      // A name ending in s owns with an apostrophe alone.
      expect(measured.verdict("U5")?.note).toMatch(
        /^Couch's top is 2150 mm below Walls' top/,
      );
      expect(measured.verdict("U6")?.note).toMatch(
        /^Walls' bottom is on Floor/,
      );
    }, 120_000);

    it("measures an overhang as a printer builds a part up from its bed: a plain block holds, a ledge fails unless bridged, a plate held at no edge fails", async () => {
      const made = await call("blender_run_script", {
        code: [
          "import bpy, bmesh",
          "s = bpy.context.scene",
          "def made(name, build, at):",
          "    b = bmesh.new()",
          "    build(b)",
          "    bmesh.ops.recalc_face_normals(b, faces=list(b.faces))",
          "    m = bpy.data.meshes.new(name)",
          "    b.to_mesh(m)",
          "    b.free()",
          "    o = bpy.data.objects.new(name, m)",
          "    o.location = at",
          "    s.collection.objects.link(o)",
          "def block(b):",
          "    bmesh.ops.create_cube(b, size=0.04)",
          "    bmesh.ops.translate(b, vec=(0, 0, 0.02), verts=b.verts)",
          // An L standing on its foot: a post 20 mm wide, 80 high, its top a
          // ledge 40 mm out, the ledge's underside held by the post's wall.
          "def ledge(b):",
          "    outline = [(0, 0), (0.02, 0), (0.02, 0.08), (0.06, 0.08), (0.06, 0.1), (0, 0.1)]",
          "    face = b.faces.new([b.verts.new((x, 0, z)) for x, z in outline])",
          "    grown = bmesh.ops.extrude_face_region(b, geom=[face])",
          "    bmesh.ops.translate(b, vec=(0, 0.02, 0), verts=[v for v in grown['geom'] if isinstance(v, bmesh.types.BMVert)])",
          "def plate(b):",
          "    own = bmesh.ops.create_cube(b, size=1)['verts']",
          "    bmesh.ops.scale(b, vec=(0.06, 0.06, 0.004), verts=own)",
          "    bmesh.ops.translate(b, vec=(0, 0, 0.05), verts=own)",
          "made('Plinth', block, (3, 0, 0))",
          "made('Ledge', ledge, (3.2, 0, 0))",
          "made('Shelf', lambda b: (block(b), plate(b)), (3.4, 0, 0))",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "OV1", check: "overhang", part: "Plinth", max: 45 },
          { id: "OV2", check: "overhang", part: "Ledge", max: 45 },
          { id: "OV3", check: "overhang", part: "Ledge", max: 45, bridge: 100 },
          { id: "OV4", check: "overhang", part: "Shelf", max: 45, bridge: 100 },
        ],
      });
      const measured = await call("blender_describe_scene", {});
      expect(
        measured.verdict("OV1")?.holds,
        measured.verdict("OV1")?.note,
      ).toBe(true);
      expect(measured.verdict("OV1")?.note).toBe(
        "Plinth overhangs at most 0° from upright, its bed below it; 45° to spare",
      );
      expect(measured.verdict("OV2")?.holds).toBe(false);
      expect(measured.verdict("OV2")?.note).toMatch(
        /^Ledge has a surface steeper than 45° from upright, 800 mm² at \([\d., ]+\), whose farthest point is 40(\.\d)? mm from an edge held up from below, where no bridge is asked/,
      );
      expect(
        measured.verdict("OV3")?.holds,
        measured.verdict("OV3")?.note,
      ).toBe(true);
      expect(measured.verdict("OV3")?.note).toMatch(
        /^Ledge's 1 surface steeper than 45° from upright is bridged, the farthest point 40(\.\d)? mm from an edge held up from below, where a bridge of 100 mm, 50 mm from either side, is asked/,
      );
      expect(measured.verdict("OV4")?.holds).toBe(false);
      expect(measured.verdict("OV4")?.note).toMatch(
        /^Shelf has a surface steeper than 45° from upright, 3600 mm² at \([\d., ]+\), held up from below at no edge/,
      );
    }, 120_000);
  },
);
