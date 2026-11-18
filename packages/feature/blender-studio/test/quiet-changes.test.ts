/**
 * What a script is read for before it runs: the changes in Blender's API that
 * Blender 5.2 runs through without an error, found in the script's own lines
 * and not in its comments, and the sheet that lists every change the studio
 * knows.
 */

import { describe, expect, it } from "vitest";
import { apiBreaks } from "../src/api-breaks.js";
import { quietChanges, quietSaid } from "../src/quiet-changes.js";
import { writtenPages } from "../src/written-pages.js";

describe("a script read for what Blender 5.2 runs in silence", () => {
  it("names the old blend method and use_nodes it sets, with what 5.2 does instead", () => {
    const said = quietSaid(
      "mat = bpy.data.materials.new('Glass')\nmat.use_nodes = True\nmat.blend_method = 'BLEND'",
    );

    expect(said.split("\n")).toEqual([
      "Blender 5.2 runs this script's material.blend_method without an error, but material.blend_method is kept only for old scripts: 'BLEND' sets material.surface_render_method to 'BLENDED', and 'OPAQUE', 'CLIP' and 'HASHED' all set 'DITHERED', so nothing clips alpha. Set surface_render_method to 'DITHERED' or 'BLENDED', and clip alpha with a Math node, Greater Than, between the alpha and the shader.",
      "Blender 5.2 runs this script's material.use_nodes without an error, but material.use_nodes and world.use_nodes always read True, and setting them does nothing (they are to go in 6.0): a new material already has its node tree, with a Principled BSDF in it. scene.use_nodes is the same; the compositor is scene.compositing_node_group.",
    ]);
  });

  it("says nothing of a name in a comment, a comparison of use_nodes, or a script without one", () => {
    expect(
      quietSaid(
        "# mat.blend_method = 'CLIP' was the old way\nif mat.use_nodes == True:\n    pass",
      ),
    ).toBe("");
    expect(quietSaid("print('hello')")).toBe("");
  });

  it("finds a test for the Glossy BSDF by its old names", () => {
    expect(
      quietSaid("glossy = [n for n in nodes if n.type == 'BSDF_ANISOTROPIC']"),
    ).toContain("test node.type == 'BSDF_GLOSSY'");
    expect(
      quietSaid("if node.bl_idname == 'ShaderNodeBsdfGlossy': pass"),
    ).toContain("a Glossy BSDF's bl_idname is ShaderNodeBsdfAnisotropic");
  });

  it("lists every change on one sheet, those that fail and those that run", () => {
    const sheet = writtenPages.find(
      (page) => page.id === "doc:3d-rendering/api-changes",
    );

    expect(sheet).toBeDefined();
    for (const change of apiBreaks)
      expect(sheet!.text).toContain(`- ${change.title}: ${change.wrong} → `);
    for (const change of quietChanges)
      expect(sheet!.text).toContain(`- ${change.title}: ${change.wrong} → `);
  });
});
