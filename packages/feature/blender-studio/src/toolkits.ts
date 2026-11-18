/**
 * The 3D studio's toolkits (ADR 0017): its tools for one kind of work, which
 * load when the model opens them. Opening a scene, describing it, looking
 * at it from four sides, running a script, rendering and looking up the API
 * are core tools, there whenever the plugin is.
 */

import type { ToolkitDeclaration } from "@zhiyin/contract";

/** The plugin the 3D studio belongs to. */
export const studioPlugin = "3d-rendering";

export const toolkits = {
  modelling: {
    id: "modelling",
    title: "3D modelling",
    summary:
      "Add objects to a scene, move, resize, attach and copy them, set them out in rows or settle them with physics, and cut, join, round, mirror and thicken their shapes; a form these do not give is modelled in blender_run_script with zhiyin's edits on picked faces, edges and loops.",
  },
  surfacing: {
    id: "surfacing",
    title: "3D materials",
    summary:
      "Give objects materials: colour, metal, wood, real finishes, wear and grime, glass, glow and pictures.",
  },
  lightAndCamera: {
    id: "light-and-camera",
    title: "3D camera and lighting",
    summary:
      "Frame and aim the camera, its lens, focus, exposure and tone; light the scene with presets, skies, surroundings or lights.",
  },
  motion: {
    id: "motion",
    title: "3D animation",
    summary:
      "Animate objects with keys, paths, aims, follows, belts and CAD motion, check the motion frame by frame and up close, and render a video.",
  },
  scatter: {
    id: "scatter",
    title: "3D scattering",
    summary:
      "Scatter objects over a surface by density and rules, none touching, as stones, plants or props.",
  },
  decals: {
    id: "decals",
    title: "3D decals",
    summary:
      "Put labels, logos, stickers and stitched or printed strips on objects' surfaces.",
  },
  unwrap: {
    id: "unwrap",
    title: "3D unwrapping",
    summary:
      "Lay objects' surfaces flat for textures: seams, unwrap methods, packing and texel density.",
  },
  bake: {
    id: "bake",
    title: "3D baking",
    summary:
      "Bake materials and shapes into texture maps, from the object itself or from a detailed copy.",
  },
  measure: {
    id: "measure",
    title: "3D measuring",
    summary:
      "Measure gaps, clearances and distances between objects' surfaces, and how far one shape strays from another.",
  },
  rig: {
    id: "rig",
    title: "3D rigging",
    summary:
      "Give a character or a mechanism bones, fit a ready rig to a body, bind its mesh to the bones and set reaching limbs.",
  },
  simulate: {
    id: "simulate",
    title: "3D simulation",
    summary:
      "Simulate rigid bodies, cloth and liquids, bake their motion, and keep where things come to rest.",
  },
  output: {
    id: "output",
    title: "3D model export",
    summary:
      "Export objects to a model file: .glb, .stl, .obj, .fbx, .usd or .ply.",
  },
} as const satisfies Record<string, ToolkitDeclaration>;

/** Every toolkit's declaration, as the catalog lists them. */
export const toolkitDeclarations: readonly ToolkitDeclaration[] =
  Object.values(toolkits);

/** What opening a scene adds to its answer: the skill that stages the work, and the toolkits it uses. */
export const sceneWork = `The stages of 3D work and their checks: open skill:${studioPlugin}/scene-stages. The tools for each kind of work load by toolkit: open ${toolkitDeclarations
  .map((toolkit) => `toolkit:${studioPlugin}/${toolkit.id}`)
  .join(", ")}.`;
