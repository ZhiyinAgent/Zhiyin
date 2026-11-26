/**
 * The zhiyin library's curves and node inputs, against a real Blender: a
 * curve made from points says its kind, length and extent; a Geometry Nodes
 * modifier's inputs are set by the names people see, read back, and an input
 * that does not exist or a value of the wrong kind is refused with the inputs
 * there are.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  content: { type: string; text?: string }[];
};

/** A triangle with a Geometry Nodes modifier whose group takes a size, a count and an object. */
const noded = [
  "import bpy",
  "for old in ('Base', 'Other'):",
  "    if bpy.data.objects.get(old): bpy.data.objects.remove(bpy.data.objects[old])",
  "for group in [g for g in bpy.data.node_groups if g.name.startswith('Grow')]:",
  "    bpy.data.node_groups.remove(group)",
  "mesh = bpy.data.meshes.new('Base')",
  "mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])",
  "obj = bpy.data.objects.new('Base', mesh)",
  "bpy.context.scene.collection.objects.link(obj)",
  "other = bpy.data.objects.new('Other', None)",
  "bpy.context.scene.collection.objects.link(other)",
  "tree = bpy.data.node_groups.new('Grow', 'GeometryNodeTree')",
  "tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')",
  "size = tree.interface.new_socket('Size', in_out='INPUT', socket_type='NodeSocketFloat')",
  "size.default_value, size.min_value, size.max_value = 1.0, 0.0, 10.0",
  "tree.interface.new_socket('Count', in_out='INPUT', socket_type='NodeSocketInt')",
  "tree.interface.new_socket('Target', in_out='INPUT', socket_type='NodeSocketObject')",
  "tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')",
  "given, out = tree.nodes.new('NodeGroupInput'), tree.nodes.new('NodeGroupOutput')",
  "tree.links.new(given.outputs[0], out.inputs[0])",
  "obj.modifiers.new('Grow', 'NODES').node_group = tree",
];

describe.runIf(blender)(
  "the zhiyin library's curves and node inputs in a real Blender",
  () => {
    const folders = new TemporaryFolders();
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    const run = async (lines: string[]) => {
      const result = (await tools.callTool("blender_run_script", {
        code: lines.join("\n"),
      })) as Result;
      return {
        failed: result.isError === true,
        said: result.content.map((c) => c.text ?? "").join("\n"),
      };
    };

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-curves-");
      const workspace = join(root, "workspace");
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
      tools = sceneAutomation(scenes.scene("curves"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("curves"),
      });
      await tools.callTool("blender_open_scene", {
        path: "curves.blend",
        create: true,
      });
    });

    afterAll(async () => {
      await scenes.forget("curves");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("makes a poly curve through points and says its length and extent", async () => {
      const { failed, said } = await run([
        "zhiyin.curve('Rail', [[0, 0, 0], [1, 0, 0], [1, 1, 0]], kind='poly')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Made Rail, a poly curve through 3 points, open: 2 m long; x 0 mm to 1 m, y 0 mm to 1 m, z 0 mm; 1 sharp corner, at (1, 0, 0 m); it does not cross itself.",
      );
    });

    it("says where a curve crosses itself", async () => {
      const { failed, said } = await run([
        "zhiyin.curve('Bow', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0.5, -0.5, 0]], kind='poly')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "3 sharp corners, the first at (1, 0, 0 m); it crosses itself at 1 place, at (333.3, 0, 0 mm).",
      );
    });

    it("says a tube wider than its tightest bend folds there, and where it runs into itself", async () => {
      const { failed, said } = await run([
        "zhiyin.curve('Kink', [[0, 0, 0], [1, 0, 0], [1, 0.05, 0], [0, 0.05, 0]], depth=0.05)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /; a tube 100 mm across; its tightest bend is [\d.]+ mm in radius, at \(.+\); its tube, 50 mm in radius, is wider than that bend, so it folds into itself there; its tube runs into itself at \d+ places?, (at|the first at) \(.+\)\./,
      );
    });

    it("finds no crossing in a spring whose turns stand clear of each other", async () => {
      const { failed, said } = await run([
        "import math",
        "zhiyin.curve('Spring', [[0.1 * math.cos(t * 0.3), 0.1 * math.sin(t * 0.3), 0.004 * t] for t in range(60)], depth=0.01)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /its tightest bend is [\d.]+ mm in radius, at \(.+\); its tube does not run into itself\./,
      );
    });

    it("makes a closed tube from a bezier curve, saying how thick it is", async () => {
      const { said } = await run([
        "c = zhiyin.curve('Hoop', [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]], cyclic=True, depth=0.01)",
        "print(c.type, round(c.data.bevel_depth, 4))",
      ]);

      expect(said).toContain("CURVE 0.01");
      expect(said).toMatch(
        /- Made Hoop, a bezier curve through 4 points, closed: 6\.\d+ m long; x -1\.01 m to 1\.01 m, y -1\.01 m to 1\.01 m, z -10 mm to 10 mm; a tube 20 mm across; its tightest bend is 9\d\d(\.\d+)? mm in radius, at \(.+\); its tube does not run into itself\./,
      );
    });

    it("refuses a curve it cannot make as asked, saying why", async () => {
      const one = await run(["zhiyin.curve('Dot', [[0, 0, 0]])"]);
      const order = await run([
        "zhiyin.curve('Bent', [[0, 0, 0], [1, 0, 0]], kind='nurbs', order=4)",
      ]);

      expect(one.failed).toBe(true);
      expect(one.said).toContain(
        "A curve needs at least 2 points; this has 1.",
      );
      expect(order.failed).toBe(true);
      expect(order.said).toContain(
        "A NURBS curve of order 4 needs at least 4 points; this has 2.",
      );
    });

    it("sets a node group's inputs by the names people see, and says each value as read back", async () => {
      const { failed, said } = await run([
        ...noded,
        "zhiyin.set_inputs(obj, Size=3.5, Count=4, Target='Other')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Set Grow's inputs on Base: Size 3.5 (was 1), Count 4 (was 0), Target Other (was nothing). Its nodes give no warnings.",
      );
    });

    it("says when a value is past an input's own range, which Blender takes without a word", async () => {
      const { said } = await run([
        ...noded,
        "zhiyin.set_inputs('Base', Size=20)",
      ]);

      expect(said).toContain(
        "Size 20 (was 1), above its maximum of 10, which the group may not expect",
      );
    });

    it("reads an input from an attribute when given one", async () => {
      const { said } = await run([
        ...noded,
        "zhiyin.set_inputs(obj, Size={'attribute': 'height'})",
      ]);

      expect(said).toContain("Size from the attribute “height” (was 1)");
    });

    it("refuses an input the group does not have, or a value of the wrong kind, naming the inputs there are", async () => {
      const unknown = await run([...noded, "zhiyin.set_inputs(obj, Width=2)"]);
      const kind = await run([...noded, "zhiyin.set_inputs(obj, Count=2.5)"]);

      expect(unknown.failed).toBe(true);
      expect(unknown.said).toContain(
        "Grow on Base has no input named “Width”. Its inputs: Size (a number), Count (a whole number), Target (an object).",
      );
      expect(kind.failed).toBe(true);
      expect(kind.said).toContain("Count takes a whole number, not 2.5.");
    });

    /** A grid of cones: Count points a side on a 2 m grid, a cone on each, and each point's height written out as Up. */
    const field = [
      "spec = {",
      "  'inputs': {'Count': {'kind': 'int', 'default': 3, 'min': 1, 'max': 50}, 'Height': 0.2},",
      "  'outputs': {'Up': 'float'},",
      "  'nodes': {",
      "    'grid': ['GeometryNodeMeshGrid', {'Size X': 2, 'Size Y': 2}],",
      "    'cone': ['MeshCone', {'Depth': 0.2}],",
      "    'place': 'InstanceOnPoints',",
      "    'pos': 'InputPosition',",
      "    'split': 'ShaderNodeSeparateXYZ',",
      "  },",
      "  'links': [",
      "    ['input.Count', 'grid.Vertices X'], ['input.Count', 'grid.Vertices Y'],",
      "    ['grid.Mesh', 'place.Points'], ['cone.Mesh', 'place.Instance'],",
      "    ['place.Instances', 'output.Geometry'], ['pos.Position', 'split.Vector'], ['split.Z', 'output.Up'],",
      "  ],",
      "}",
    ];

    it("builds a node tree from a description and says what it evaluates to, instances included", async () => {
      const { failed, said } = await run([
        "import bpy",
        "old = bpy.data.objects.get('Field')",
        "if old: bpy.data.objects.remove(old)",
        ...field,
        "mod = zhiyin.nodes('Field', spec, values={'Count': 5})",
        "print('up', getattr(mod.properties.outputs, mod.node_group.interface.items_tree['Up'].identifier).attribute_name)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Made the mesh object Field and built Field nodes, 5 nodes and 7 links, as the modifier Field nodes on Field; inputs Count 5, Height 0.2; writes the attribute Up: it makes 25 instances, at x -2 m to 2 m, y -2 m to 2 m, z 0 mm to 200 mm. Its nodes give no warnings.",
      );
      expect(said).toContain("up Up\n");
    });

    it("rebuilds a modifier's tree in its place, and says a value past an input's range", async () => {
      const { failed, said } = await run([
        ...field,
        "zhiyin.nodes('Field', spec, name='Field nodes', values={'Count': 100})",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Built Field nodes, 5 nodes and 7 links, in place of the tree of the modifier Field nodes on Field; inputs Count 100, above its maximum of 50, which the group may not expect, Height 0.2;",
      );
      expect(said).toContain("it makes 10,000 instances");
    });

    it("says what a tree's nodes warn of", async () => {
      const { failed, said } = await run([
        "zhiyin.nodes('Dots', {'nodes': {'grid': 'MeshGrid', 'points': 'MeshToPoints', 'split': 'SubdivideMesh'},",
        "  'links': [['grid.Mesh', 'points.Mesh'], ['points.Points', 'split.Mesh'], ['split.Mesh', 'output.Geometry']]}, name='Warned')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "it makes 9 loose points, at x -550 mm to 550 mm, y -550 mm to 550 mm, z -50 mm to 50 mm. Its nodes warn: Input geometry has unsupported type: Point Cloud.",
      );
    });

    it("refuses a node type, socket or link Blender does not have, naming what there is", async () => {
      const type = await run([
        "zhiyin.nodes('Field', {'nodes': {'grid': 'MeshGridd'}, 'links': [['grid.Mesh', 'output.Geometry']]})",
      ]);
      const socket = await run([
        "zhiyin.nodes('Field', {'nodes': {'grid': 'MeshGrid'}, 'links': [['grid.Mesh', 'output.Rotation']]})",
      ]);
      const link = await run([
        "zhiyin.nodes('Field', {'nodes': {'grid': 'MeshGrid', 'cone': 'MeshCone'}, 'links': [['grid.UV Map', 'cone.Vertices'], ['grid.Mesh', 'output.Geometry']]})",
      ]);

      expect(type.failed).toBe(true);
      expect(type.said).toContain(
        "There is no node type “MeshGridd”. Nearest: GeometryNodeMeshGrid,",
      );
      expect(socket.failed).toBe(true);
      expect(socket.said).toContain(
        "output (NodeGroupOutput) has no input named “Rotation”. Its inputs: Geometry.",
      );
      expect(link.failed).toBe(true);
      expect(link.said).toContain(
        "grid.UV Map (vector) cannot feed cone.Vertices (int): Blender marks the link invalid.",
      );
    });
  },
);
