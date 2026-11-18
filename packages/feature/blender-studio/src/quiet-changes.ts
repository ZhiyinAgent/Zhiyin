/**
 * What changed in Blender's Python API that a script written the old way
 * runs through without an error in Blender 5.2, doing nothing or something
 * other than it meant. No error names these, so a script is read for them
 * before it runs, and its answer says what each one does in 5.2 and the form
 * that works. The changes that raise an error are the API breaks, said from
 * the error.
 */

/** A change a script meets in silence. */
export type QuietChange = {
  /** `quiet:blender/5.2/<slug>`. */
  readonly id: string;
  readonly title: string;
  /** A regular expression's source, matched against the script's own lines. */
  readonly pattern: string;
  /** The form a model writes. */
  readonly wrong: string;
  /** What it does in 5.2, and the form that works. */
  readonly said: string;
};

export const quietChanges: readonly QuietChange[] = [
  {
    id: "quiet:blender/5.2/blend-method",
    title: "A material's blend method is its render method",
    pattern: "\\.blend_method\\b",
    wrong: "material.blend_method = 'CLIP'",
    said: "material.blend_method is kept only for old scripts: 'BLEND' sets material.surface_render_method to 'BLENDED', and 'OPAQUE', 'CLIP' and 'HASHED' all set 'DITHERED', so nothing clips alpha. Set surface_render_method to 'DITHERED' or 'BLENDED', and clip alpha with a Math node, Greater Than, between the alpha and the shader.",
  },
  {
    id: "quiet:blender/5.2/use-nodes",
    title: "Materials and worlds always use nodes",
    pattern: "\\.use_nodes\\s*=(?!=)",
    wrong: "material.use_nodes = True",
    said: "material.use_nodes and world.use_nodes always read True, and setting them does nothing (they are to go in 6.0): a new material already has its node tree, with a Principled BSDF in it. scene.use_nodes is the same; the compositor is scene.compositing_node_group.",
  },
  {
    id: "quiet:blender/5.2/transparency-overlap",
    title: "show_transparent_back is use_transparency_overlap",
    pattern: "\\.show_transparent_back\\b",
    wrong: "material.show_transparent_back = False",
    said: "material.show_transparent_back is still taken, under its 4.2 name material.use_transparency_overlap.",
  },
  {
    id: "quiet:blender/5.2/raytrace-refraction",
    title: "use_screen_refraction is use_raytrace_refraction",
    pattern: "\\.use_screen_refraction\\b",
    wrong: "material.use_screen_refraction = True",
    said: "material.use_screen_refraction is still taken, under its 4.2 name material.use_raytrace_refraction.",
  },
  {
    id: "quiet:blender/5.2/glossy-names",
    title: "A Glossy BSDF is named as the Anisotropic one",
    pattern:
      "bl_idname\\s*[!=]=\\s*['\"]ShaderNodeBsdfGlossy['\"]|['\"]BSDF_ANISOTROPIC['\"]",
    wrong: "node.bl_idname == 'ShaderNodeBsdfGlossy'",
    said: "a Glossy BSDF's bl_idname is ShaderNodeBsdfAnisotropic and its type BSDF_GLOSSY, so a test for bl_idname 'ShaderNodeBsdfGlossy' or type 'BSDF_ANISOTROPIC' never holds: test node.type == 'BSDF_GLOSSY'.",
  },
];

/** A script's lines, without what its comments say. */
function uncommented(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
}

/** The quiet changes a script meets. */
function quietChangesIn(code: string): readonly QuietChange[] {
  const lines = uncommented(code);
  return quietChanges.filter((change) =>
    new RegExp(change.pattern).test(lines),
  );
}

/** What a script's own lines meet that Blender 5.2 runs in silence, in words for the answer, or nothing. */
export function quietSaid(code: string): string {
  return quietChangesIn(code)
    .map(
      (change) =>
        `Blender 5.2 runs this script's ${change.wrong.split(" ")[0]} without an error, but ${change.said}`,
    )
    .join("\n");
}
